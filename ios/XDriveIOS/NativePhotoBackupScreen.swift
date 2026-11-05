import Photos
import PhotosUI
import SwiftUI

/// Native opt-in for bounded still/video/Live originals, not a WebView bridge.
struct XDriveIOSNativePhotoBackupScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    let onShowCloudOriginals: () -> Void
    @StateObject private var receipts = XDriveIOSNativePhotoReceiptReviewController()
    @StateObject private var background = XDriveIOSNativeBackgroundPhotoControls()
    @StateObject private var coverage = XDriveIOSNativePhotoCoverageModel()
    @StateObject private var originalProof = XDriveIOSNativeCurrentPhotoReceiptModel()
    @StateObject private var destination = XDriveIOSNativePhotoBackupDestinationModel()
    @State private var selectedOriginalToVerify: PhotosPickerItem?
    @State private var selectedOriginalIdentifier: String?
    @State private var checkICloudOriginal = false
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var interval = 60
    @State private var photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var allowICloud = false
    @State private var autoAllowICloud = false
    @State private var autoStartRule: XDriveIOSPhotoAutoStartRule = .everything
    @State private var showAutoConsent = false
    @State private var showManualConsent = false
    @State private var showFocusedConsent = false
    @State private var showResumeConsent = false
    @State private var showCatchUpConsent = false
    @State private var showBackgroundEnableConsent = false
    @State private var showBackgroundDisableConsent = false
    @State private var showBackgroundResumeConsent = false
    @State private var showBackgroundRenewConsent = false
    @State private var backgroundResumeOwner: XDriveNativeOwnerRoot?
    @State private var backgroundRenewOwner: XDriveNativeOwnerRoot?
    @State private var backgroundEnableOwner: XDriveNativeOwnerRoot?
    @State private var backgroundDisableOwner: XDriveNativeOwnerRoot?
    @State private var catchUpConsentOwner: XDriveNativeOwnerRoot?
    // Capture the exact verified Owner and settings BEFORE any native consent
    // dialog; a late confirmation must never authorize another Server.
    @State private var manualConsentOwner: XDriveNativeOwnerRoot?
    @State private var manualConsentAllowICloud = false
    @State private var focusedConsentOwner: XDriveNativeOwnerRoot?
    @State private var focusedConsentAllowICloud = false
    @State private var autoConsentOwner: XDriveNativeOwnerRoot?
    @State private var autoConsentMinutes = 60
    @State private var autoConsentAllowICloud = false
    @State private var autoConsentStartRule: XDriveIOSPhotoAutoStartRule = .everything
    @State private var autoConsentEnabledAt = Date()
    @State private var resumeConsentOwner: XDriveNativeOwnerRoot?
    @State private var consentError: String?
    // Focused Backup is explicit foreground-only work. The display lease is
    // local to this visible screen and never authorizes an upload or BG task.
    @State private var focusedDimmed = false
    @State private var focusedWakeCounter = 0
    @State private var focusedLastInteractionAt = Date.distantPast
    @State private var previousIdleTimerDisabled: Bool?

    private var focusedPresentationActive: Bool {
        controller.busy && (controller.focusedSummary?.totalWindows ?? 0) > 0 &&
            phase == .active && login.owner != nil
    }

    private func noteFocusedUserActivity() {
        guard focusedPresentationActive, !focusedDimmed else { return }
        let now = Date()
        // During a long drag, throttle state writes to at most once a second.
        guard now.timeIntervalSince(focusedLastInteractionAt) >= 1 else { return }
        focusedLastInteractionAt = now
        focusedWakeCounter &+= 1
    }

    private func updateFocusedIdleTimer(active: Bool) {
        if active {
            guard previousIdleTimerDisabled == nil else { return }
            previousIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
        } else if let previousIdleTimerDisabled {
            UIApplication.shared.isIdleTimerDisabled = previousIdleTimerDisabled
            self.previousIdleTimerDisabled = nil
        }
    }

    var body: some View {
        GeometryReader { viewport in
            // Measured safe-area width and height, not the iPhone size class.
            // The parent owns all consent, Owner verification and task state;
            // rotating reflows sections only, never starts another uploader.
            if viewport.size.width >= 760 &&
                viewport.size.height < 500 &&
                !dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: 0) {
                    Form { backupStatusSections }
                        .frame(width: viewport.size.width * 0.48)
                        .accessibilityIdentifier("native-ios-backup-landscape-status")
                    Divider()
                    Form { backupSettingsSections }
                        .accessibilityIdentifier("native-ios-backup-landscape-settings")
                }
            } else {
                Form {
                    backupSettingsSections
                    backupStatusSections
                }
                .accessibilityIdentifier("native-ios-backup-portrait-form")
            }
        }
        // An active user's taps or scrolls reset the 10-second idle window.
        // Simultaneous gestures preserve Form scroll and Button interactions.
        .simultaneousGesture(
            TapGesture().onEnded { noteFocusedUserActivity() }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 4)
                .onChanged { _ in noteFocusedUserActivity() }
        )
        // Synology-style focused display: dark, not locked. A tap wakes the
        // native status screen without cancelling or restarting the uploader.
        .overlay {
            if focusedPresentationActive && focusedDimmed {
                Button {
                    focusedDimmed = false
                    focusedLastInteractionAt = Date()
                    focusedWakeCounter &+= 1
                } label: {
                    ZStack {
                        Color.black.ignoresSafeArea()
                        VStack(spacing: 16) {
                            Image(systemName: "moon.stars.fill")
                                .font(.title2)
                            Text("集中备份正在运行")
                                .font(.headline)
                            if let focused = controller.focusedSummary {
                                Text("已扫描 \(focused.completedWindows)/\(focused.totalWindows) 段")
                                Text("本次确认新增 \(focused.confirmedNew) 个原件")
                            }
                            Text("保持 App 在前台 · 轻点屏幕查看进度或停止")
                                .font(.footnote)
                                .foregroundStyle(.white.opacity(0.72))
                        }
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                        .padding(24)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("唤醒集中备份显示")
                .accessibilityHint("继续备份并显示详细进度和停止按钮")
                .accessibilityIdentifier("native-ios-photos-focused-dim-overlay")
            }
        }
        .task(id: "\(focusedPresentationActive)-\(focusedWakeCounter)") {
            focusedDimmed = false
            guard focusedPresentationActive else { return }
            // A lifecycle-cancellable wait; no retained timer or BG writer.
            do {
                try await Task.sleep(nanoseconds: 10_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled && focusedPresentationActive else { return }
            focusedDimmed = true
        }
        .onChange(of: focusedPresentationActive) { active in
            updateFocusedIdleTimer(active: active)
            if !active {
                focusedDimmed = false
                focusedLastInteractionAt = .distantPast
            }
        }
        .navigationTitle("相册备份")
        .confirmationDialog("确认开始上传已授权的照片/视频/Live 原件？",
                            isPresented: $showManualConsent, titleVisibility: .visible) {
            Button("确认备份到已核验的云端账户") {
                guard let expected = manualConsentOwner,
                      destination.confirmedForCurrentName,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    consentError = "服务器或账户已变化，本次确认失效；没有上传文件。"
                    return
                }
                controller.startManual(
                    login: login, expectedOwner: expected,
                    allowICloud: manualConsentAllowICloud
                )
            }
        } message: {
            Text("服务器：\(manualConsentOwner?.origin.host ?? "未验证") · Owner：\(manualConsentOwner?.username ?? "未验证")。本轮最多新增 20 个原件。\(manualConsentAllowICloud ? "允许按需下载 iCloud 原件。" : "不会下载 iCloud 原件。")")
        }
        .confirmationDialog(
            "开始前台集中备份当前授权的全部媒体？",
            isPresented: $showFocusedConsent, titleVisibility: .visible
        ) {
            Button("确认连续备份到当前云端 Owner") {
                guard let expected = focusedConsentOwner,
                      destination.confirmedForCurrentName,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    consentError = "服务器或账户已变化，集中备份授权失效；未上传文件。"
                    return
                }
                focusedConsentOwner = nil
                controller.startFocused(
                    login: login, expectedOwner: expected,
                    allowICloud: focusedConsentAllowICloud
                )
            }
            .accessibilityIdentifier("native-ios-photos-focused-confirm")
        } message: {
            Text("服务器：\(focusedConsentOwner?.origin.host ?? "未验证") · Owner：\(focusedConsentOwner?.username ?? "未验证")。仅 App 前台连续扫描，每个 256 项窗口最多新增 20 个原件；离开 App、图库变化或用户取消都会停止。\(focusedConsentAllowICloud ? "允许按需下载 iCloud 原件。" : "不会下载 iCloud 原件。") 未知上传收据将暂停，不能当作整库已备份。")
        }
        .confirmationDialog("开启自动原件备份？",
                            isPresented: $showAutoConsent, titleVisibility: .visible) {
            Button("确认启用") {
                guard let expected = autoConsentOwner,
                      destination.confirmedForCurrentName,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    consentError = "服务器或账户已变化，自动备份授权失效；未开启计划。"
                    return
                }
                Task {
                    await controller.configure(
                        login: login, expectedOwner: expected,
                        minutes: autoConsentMinutes,
                        allowICloud: autoConsentAllowICloud,
                        startRule: autoConsentStartRule,
                        enabledAt: autoConsentEnabledAt
                    )
                }
            }
        } message: {
            Text("服务器：\(autoConsentOwner?.origin.host ?? "未验证") · Owner：\(autoConsentOwner?.username ?? "未验证")。\(autoConsentStartRule == .onlyNew ? "仅自动备份启用后拍摄或编辑的照片；无法判断拍摄和修改日期的项目仍标记不可用。" : "自动检查所有已授权的照片和视频。") 首次积压未扫完时仅在前台约每分钟继续一轮，完成扫描后恢复每 \(autoConsentMinutes) 分钟检查；每轮最多新增 20 个原件。不保证锁屏或强制退出后执行。")
        }
        .confirmationDialog("确认恢复当前 Owner 的前台自动备份？",
                            isPresented: $showResumeConsent, titleVisibility: .visible) {
            Button("核验账本后恢复计划") {
                guard let expected = resumeConsentOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    consentError = "服务器或账户已变化，未恢复旧账户的自动计划。"
                    return
                }
                receipts.resumePausedAuto(login: login, expectedOwner: expected)
                // A completed trusted read updates the visible schedule.
                controller.refresh(owner: login.owner)
            }
        } message: {
            Text("只在全部待核对记录已获 Server 确认、当前原生 Owner 未变、相册权限有效时恢复。若校验失败则继续保持暂停。")
        }
        .confirmationDialog("允许当前账户加速积压备份？",
                            isPresented: $showCatchUpConsent,
                            titleVisibility: .visible) {
            Button("确认：仅在前台约每分钟继续") {
                guard let selected = catchUpConsentOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                else {
                    consentError = "服务器或账户已变化，积压加速授权失效。"
                    return
                }
                let stopVersion = XDriveIOSPhotoAutoScheduleStore.shared.localStopGeneration
                Task { @MainActor in
                    do {
                        let proof = try await login.verifiedAuthorization()
                        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                              XDriveIOSNativePhotoOwnerScope.matches(proof.owner, selected),
                              XDriveIOSPhotoAutoScheduleStore.shared.localStopGeneration == stopVersion,
                              phase == .active,
                              [.authorized, .limited].contains(
                                PHPhotoLibrary.authorizationStatus(for: .readWrite)
                              ) else {
                            throw XDriveIOSNativeSessionError.staleSession
                        }
                        _ = try XDriveIOSPhotoAutoScheduleStore.shared
                            .setCatchUp(owner: selected, enabled: true)
                        controller.refresh(owner: selected)
                    } catch {
                        consentError = "未能重新验证当前账户或安全保存加速设置；维持原自动计划。"
                    }
                }
            }
        } message: {
            Text("仅当前服务器和 Owner。积压未完成时每轮最多新增 20 个原件，约 60 秒后再尝试；完成整库一次扫描后恢复原间隔。不启用后台权限，未知收据继续暂停。")
        }
        .confirmationDialog(
            "为当前账户授权系统后台原件备份？",
            isPresented: $showBackgroundEnableConsent,
            titleVisibility: .visible
        ) {
            Button("确认注册本机并申请受限后台授权") {
                guard let selected = backgroundEnableOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                else {
                    consentError = "服务器或账户已变化，后台授权确认失效。"
                    return
                }
                backgroundEnableOwner = nil
                guard destination.confirmedForCurrentName else {
                    consentError = "请先保存并核验当前 iPhone 的受管备份目的地。"
                    return
                }
                background.enable(login: login, expectedOwner: selected)
            }
        } message: {
            Text("服务器：\(backgroundEnableOwner?.origin.host ?? "未验证")，Owner：\(backgroundEnableOwner?.username ?? "未验证")。系统会获得当前设备与 Owner 根目录的可撤销授权，后台任务仍受 iOS 调度和原件保护限制；不会保证锁屏或强制退出后备份。")
        }
        .confirmationDialog(
            "续期当前设备的系统后台备份授权？",
            isPresented: $showBackgroundRenewConsent,
            titleVisibility: .visible
        ) {
            Button("确认：验证 Owner 与收据后轮换授权") {
                guard let selected = backgroundRenewOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                else {
                    consentError = "服务器或账户已变化，续期确认失效。"
                    return
                }
                backgroundRenewOwner = nil
                background.renew(login: login, expectedOwner: selected)
            }
            .accessibilityIdentifier("native-ios-photo-background-renew-confirm")
        } message: {
            Text("仅在当前 Owner、设备、根目录授权仍有效且距离到期不足 72 小时、全部旧收据已核对后才续期。若轮换的服务器响应丢失，不会盲目重复申请；本机紧急停止仍优先。iOS 不保证后台执行时间。")
        }
        .confirmationDialog(
            "确认恢复当前 Owner 的系统后台原件备份？",
            isPresented: $showBackgroundResumeConsent,
            titleVisibility: .visible
        ) {
            Button("重新核对账本和后台授权，安排下次系统任务") {
                guard let expected = backgroundResumeOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    consentError = "服务器或账户已变化；后台计划继续暂停。"
                    return
                }
                backgroundResumeOwner = nil
                receipts.resumePausedBackground(
                    login: login, expectedOwner: expected
                )
            }
            .accessibilityIdentifier("native-ios-photo-background-receipts-resume-confirm")
        } message: {
            Text("只在当前服务器、Owner、根目录及后台设备授权再次验证，且加密账本无任何待核对收据时恢复。保留既有照片扫描游标和原件记录；下次执行由 iOS 决定。")
        }
        .confirmationDialog(
            "停止本机后台备份并尝试撤销远端授权？",
            isPresented: $showBackgroundDisableConsent,
            titleVisibility: .visible
        ) {
            Button("本机立即停止，撤销当前 Owner 授权", role: .destructive) {
                guard let selected = backgroundDisableOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                else {
                    consentError = "服务器或账户已变化，拒绝操作其他账户授权。"
                    return
                }
                backgroundDisableOwner = nil
                background.disable(login: login, expectedOwner: selected)
            }
        } message: {
            Text("会优先停用本机后台授权，即使网络不可达；远端撤销需要服务器确认。已上传原件和加密收据不会删除，不影响前台自动计划。")
        }
        .onAppear {
            photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            syncSavedAutomaticSettings()
            destination.refresh(login: login)
            receipts.refresh(login: login)
            background.refresh(login: login)
            updateFocusedIdleTimer(active: focusedPresentationActive)
        }
        .onDisappear {
            destination.cancel()
            // Restore the exact prior global idle timer setting on navigation.
            updateFocusedIdleTimer(active: false)
            focusedDimmed = false
            originalProof.cancel()
            selectedOriginalIdentifier = nil
            selectedOriginalToVerify = nil
            coverage.cancel()
            receipts.cancel()
            background.invalidateRead()
            showBackgroundEnableConsent = false
            showBackgroundDisableConsent = false
            showBackgroundResumeConsent = false
            showBackgroundRenewConsent = false
            backgroundResumeOwner = nil
            backgroundRenewOwner = nil
            backgroundEnableOwner = nil
            backgroundDisableOwner = nil
            showManualConsent = false
            showFocusedConsent = false
            focusedConsentOwner = nil
            showAutoConsent = false
            showResumeConsent = false
            showCatchUpConsent = false
            catchUpConsentOwner = nil
            manualConsentOwner = nil
            autoConsentOwner = nil
            resumeConsentOwner = nil
        }
        .onChange(of: receipts.mode) { mode in
            if mode == .idle {
                controller.refresh(owner: login.owner)
                background.refresh(login: login)
            }
        }
        .onChange(of: receipts.confirmedReadback) { readback in
            guard let readback else { return }
            // This is an already-confirmed historical ACK, not a new upload
            // or permission to resume a paused schedule. Gallery re-verifies
            // the current Owner and defers refresh while Viewer is active.
            controller.signalConfirmedReceiptReadback(
                owner: readback.owner, login: login
            )
            // Historical counts may have changed after receipt review.
            coverage.cancel()
            originalProof.cancel()
        }
        .onChange(of: controller.confirmedOriginalUpdate) { _ in
            coverage.cancel()
            originalProof.cancel()
        }
        .onChange(of: phase) { state in
            if state != .active {
                coverage.cancel()
                originalProof.cancel()
            }
            if state == .active {
                photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                // BGProcessing or Settings may change state while this view is mounted.
                controller.refresh(owner: login.owner)
            }
        }
        .onChange(of: selectedOriginalToVerify) { item in
            guard let id = item?.itemIdentifier else {
                selectedOriginalIdentifier = nil
                if item != nil { originalProof.unsupportedPickerItem() }
                return
            }
            selectedOriginalIdentifier = id
            originalProof.verify(
                localIdentifier: id, login: login,
                allowICloudOriginals: checkICloudOriginal
            )
        }
        .onChange(of: login.owner) { _ in
            destination.reset()
            destination.refresh(login: login)
            originalProof.cancel()
            selectedOriginalToVerify = nil
            selectedOriginalIdentifier = nil
            coverage.cancel()
            photoAuthorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            // Invalidate any consent that was opened for the previous Owner.
            background.invalidateRead()
            showBackgroundEnableConsent = false
            showBackgroundDisableConsent = false
            showBackgroundResumeConsent = false
            showBackgroundRenewConsent = false
            backgroundResumeOwner = nil
            backgroundRenewOwner = nil
            backgroundEnableOwner = nil
            backgroundDisableOwner = nil
            background.refresh(login: login)
            showManualConsent = false
            showFocusedConsent = false
            focusedConsentOwner = nil
            showAutoConsent = false
            showResumeConsent = false
            showCatchUpConsent = false
            catchUpConsentOwner = nil
            manualConsentOwner = nil
            autoConsentOwner = nil
            resumeConsentOwner = nil
            receipts.cancel()
            // Per-Owner input state never flows to a replacement account.
            allowICloud = false
            autoAllowICloud = false
            autoStartRule = .everything
            interval = 60
            syncSavedAutomaticSettings()
            receipts.refresh(login: login)
        }
    }

    // Native Form Sections are authored exactly once and reused by both
    // portrait and the two independently scrolling short-landscape groups.
    // Never duplicate mutable consent controls in parallel view trees.
    @ViewBuilder
    private var backupSettingsSections: some View {
            Section("备份目的地（必选）") {
                Text("输入一个文件夹名称，默认使用本机设备名称；不输入云端完整路径。服务器按 Push/Pull 的受管目录规则自动创建实际目标。")
                    .font(.footnote).foregroundStyle(.secondary)
                TextField("备份文件夹名称", text: $destination.folderName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(destination.busy || controller.busy)
                    .accessibilityIdentifier("native-ios-photos-destination-name")
                if destination.needsDeviceRegistration {
                    Text("当前 iPhone 尚未注册到此 Owner，必须先明确注册设备。")
                        .font(.footnote).foregroundStyle(.orange)
                    Button("注册当前 iPhone") {
                        destination.registerDevice(login: login)
                    }
                    .disabled(destination.busy || controller.busy || login.owner == nil)
                    .accessibilityIdentifier("native-ios-photos-destination-device-register")
                }
                HStack {
                    Button("保存并核验目标目录") {
                        destination.save(login: login)
                    }
                    .disabled(!destination.canSave || controller.busy || login.owner == nil)
                    .accessibilityIdentifier("native-ios-photos-destination-save")
                    Button("刷新已绑定目录") {
                        destination.refresh(login: login)
                    }
                    .disabled(destination.busy || login.owner == nil)
                    .accessibilityIdentifier("native-ios-photos-destination-refresh")
                }
                if destination.busy {
                    ProgressView("正在核验当前 Owner、设备和受管目标…")
                }
                if let verified = destination.confirmed {
                    Label(destination.confirmedForCurrentName
                          ? "服务器已确认备份目标" : "文件夹名已修改，请重新保存后再备份",
                          systemImage: destination.confirmedForCurrentName
                              ? "checkmark.circle" : "exclamationmark.triangle")
                    Text(verified.targetPath)
                        .font(.footnote).textSelection(.enabled)
                        .accessibilityIdentifier("native-ios-photos-destination-target-path")
                    Text("受管目标 ID：\(verified.targetNodeID)。此 ID 仅用于核验，不由 iPhone 拼接或选择完整云端路径。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text(destination.message)
                    .font(.caption).foregroundStyle(.secondary)
                if let failure = destination.errorMessage {
                    Text(failure).font(.footnote).foregroundStyle(.red)
                        .accessibilityIdentifier("native-ios-photos-destination-error")
                }
                Text("已绑定目标的前台手动、集中和自动备份使用受管 UploadSession 与真实 Node 收据；系统后台权限仍需单独完成受管目标绑定，不能将旧根目录收据当作新目录完成记录。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("备份范围") {
                Text("当前账户：\(login.owner?.username ?? "未登录")")
                Text("照片、视频和 Live Photo ZIP 的前台原件备份须先保存上方受管目录，写入时再次验证当前 Owner、设备与 Node；历史 Owner 根目录原件仍保留。")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("手动备份允许下载 iCloud 原件", isOn: $allowICloud)
                    .disabled(controller.busy)
                Text("此开关只用于手动备份；前台自动备份的 iCloud 选项在下方独立保存。关闭时只备份本机可读取的原件，不降低原件质量。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("手动备份") {
                Text("下一次手动扫描：第 \(controller.manualNextWindow + 1) 段。每段最多 256 项；达到 20 项新增上限会重复当前段，完成后才进入下一段。重启 App、切换账户或相册变化会重新从头检查。")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-photos-manual-window")
                if photoAuthorization != .authorized && photoAuthorization != .limited {
                    Text("照片访问权限不可用，无法启动手动原件备份。请先在本机相册授权，或在 iOS 设置中恢复照片访问。")
                        .font(.footnote).foregroundStyle(.orange)
                        .accessibilityIdentifier("native-ios-photos-manual-permission-blocked")
                }
                Button("开始一轮原件备份") {
                    consentError = nil
                    manualConsentOwner = login.owner
                    manualConsentAllowICloud = allowICloud
                    showManualConsent = manualConsentOwner != nil
                }
                    .disabled(controller.busy || background.busy || login.owner == nil ||
                              !destination.confirmedForCurrentName ||
                              (photoAuthorization != .authorized && photoAuthorization != .limited))
                    .accessibilityIdentifier("native-ios-photos-manual-start")
                Button("集中备份授权照片（仅前台连续）") {
                    consentError = nil
                    focusedConsentOwner = login.owner
                    focusedConsentAllowICloud = allowICloud
                    showFocusedConsent = focusedConsentOwner != nil
                }
                .disabled(controller.busy || background.busy || login.owner == nil ||
                          !destination.confirmedForCurrentName ||
                          (photoAuthorization != .authorized && photoAuthorization != .limited))
                .accessibilityIdentifier("native-ios-photos-focused-start")
                Text("适用于首次大量备份：连续处理已授权的分段，每段最多新增 20 个原件。停止或重启后可从已完整扫描的分段继续，但必须重新验证当前账户、相册版本、授权范围和 iCloud 设置；不确定收据仍须先核对。扫描进度不代表全部云端原件已备份。")
                Text("本页面运行集中备份时暂时阻止自动锁屏，约 10 秒后进入深色专注显示；轻点恢复，离开页面、进入后台或任务停止即恢复原有锁屏设置。")
                    .font(.caption).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-photos-focused-display-guidance")
                    .font(.caption).foregroundStyle(.secondary)
                if let focused = controller.focusedSummary {
                    if focused.resumedFromWindow > 0 {
                        Text("本次已从第 \(focused.resumedFromWindow + 1) 段恢复；此前完成的是扫描位置，不代表相应照片已经全部备份。")
                            .font(.caption).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-photos-focused-resumed-window")
                    }
                    Text("集中备份进度：已完整扫描 \(focused.completedWindows)/\(focused.totalWindows) 个分段 · 当前第 \(focused.currentWindow + 1) 段 · 本次确认新增 \(focused.confirmedNew) 个原件")
                        .monospacedDigit()
                        .accessibilityIdentifier("native-ios-photos-focused-progress")
                    if focused.pausedForReview {
                        Label("待核对上传收据；集中备份已暂停", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    } else if focused.finishedScan {
                        Label("当前授权媒体已完成一次扫描；不代表远端全部原件已逐张核验",
                              systemImage: "checkmark.circle")
                    } else if !controller.busy {
                        Label("集中备份已中断或停止；下次会重新扫描、核验已确认原件",
                              systemImage: "info.circle")
                    }
                    if focused.hadUnavailable {
                        Text("扫描中发现原件不可用或格式不支持；这些项目不计作备份成功。")
                            .font(.footnote).foregroundStyle(.orange)
                    }
                    if focused.limitedAuthorization {
                        Text("仅扫描当前 iOS 授权的照片，不代表设备完整相册。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if controller.busy {
                    ProgressView("正在验证并备份原件…")
                    if controller.focusedSummary != nil {
                        Button("停止集中备份") { controller.cancel() }
                            .accessibilityIdentifier("native-ios-photos-cancel")
                    } else {
                        Button("取消本轮") { controller.cancel() }
                            .accessibilityIdentifier("native-ios-photos-cancel")
                    }
                }
                if let result = controller.progress {
                    Text(result.stage)
                    Text("本轮第 \(result.startOffset / 256 + 1) 段 · 当前已授权 \(result.totalVisible) 项（不代表全部已备份）")
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-photos-manual-coverage")
                    Text("当前段已扫描 \(result.scanned) · 新增 \(result.uploaded) · 已验证 \(result.verifiedAlready)")
                        .monospacedDigit()
                    if result.changeQueueProcessed > 0 {
                        Text("优先增量队列：处理 \(result.changeQueueProcessed) · 新增 \(result.changeQueueUploaded) · 已验证 \(result.changeQueueVerified) · 失败 \(result.changeQueueFailed)")
                            .font(.footnote).monospacedDigit()
                            .accessibilityIdentifier("native-ios-photo-change-queue-progress")
                    }
                    Text("视频新增 \(result.videoUploaded)，Live ZIP 新增 \(result.liveBundleUploaded)，待核对 \(result.needsReview)，不可用 \(result.unavailable)")
                        .font(.footnote)
                    if result.skippedBeforeBaseline > 0 {
                        Text("仅备份新照片：本段排除启用前且未编辑的 \(result.skippedBeforeBaseline) 项；不代表这些原件已经备份。")
                            .font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-photo-auto-older-skipped")
                    }
                    if result.issues.total > 0 {
                        Text("本次扫描分段发现 \(result.issues.total) 项不可用或不支持；按扫描位置显示，位置会随图库变化，不是固定照片编号。")
                            .font(.caption).foregroundStyle(.orange)
                            .accessibilityIdentifier("native-ios-photo-window-issue-count")
                        ForEach(result.issues.entries) { item in
                            Label("第 \(item.position) 项 · \(item.mediaLabel)：\(item.reason.displayText)",
                                  systemImage: "exclamationmark.triangle")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if result.issues.additionalCount > 0 {
                            Text("另有 \(result.issues.additionalCount) 项未展开；重新扫描将重新检查，未被当作备份成功。")
                                .font(.caption).foregroundStyle(.secondary)
                                .accessibilityIdentifier("native-ios-photo-window-issue-overflow")
                        }
                    }
                    // This fraction counts only slots read in THIS 256-item
                    // window. It is not a remote backup coverage percentage.
                    if let window = XDriveIOSNativeBackupWindowReadProgress.current(
                        totalVisible: result.totalVisible,
                        startOffset: result.startOffset, scanned: result.scanned,
                        uploaded: result.uploaded,
                        verifiedAlready: result.verifiedAlready,
                        unavailable: result.unavailable,
                        needsReview: result.needsReview,
                        unsupported: result.videosNotSupported
                    ) {
                        ProgressView(value: window.fractionScanned)
                            .accessibilityLabel("本轮分段已扫描比例")
                            .accessibilityIdentifier("native-ios-photo-window-scanned-progress")
                        Text("当前分段已检查 \(window.scanned)/\(window.capacity) 项，尚未扫描 \(window.remaining) 项；已确认 \(window.confirmed) 项，待核对 \(window.needsReview) 项，不可用 \(window.unavailable) 项。")
                            .font(.caption).monospacedDigit()
                            .accessibilityIdentifier("native-ios-photo-window-read-count")
                        Text("仅表示当前分段的读取进度，不代表整库已备份；已扫描不等于已成功备份，仍需逐张核验当前云端原件。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("前台自动增量") {
                if photoAuthorization != .authorized && photoAuthorization != .limited {
                    Label("照片访问权限不可用：已保存的前台自动计划不会执行。请在 iOS 设置中恢复照片访问。",
                          systemImage: "exclamationmark.triangle")
                        .font(.footnote).foregroundStyle(.orange)
                        .accessibilityIdentifier("native-ios-photos-auto-permission-blocked")
                } else if photoAuthorization == .limited {
                    Label("当前仅授权部分照片：自动增量只处理系统允许读取的项目，不代表整机照片已备份。",
                          systemImage: "info.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-photos-auto-permission-limited")
                }
                Picker("检查间隔", selection: $interval) {
                    Text("15 分钟").tag(15)
                    Text("1 小时").tag(60)
                    Text("6 小时").tag(360)
                    Text("24 小时").tag(1440)
                }
                .disabled(controller.busy || controller.schedule?.enabled == true)
                Picker("前台自动备份范围", selection: $autoStartRule) {
                    Text("扫描并备份全部照片").tag(XDriveIOSPhotoAutoStartRule.everything)
                    Text("仅备份新照片").tag(XDriveIOSPhotoAutoStartRule.onlyNew)
                }
                .disabled(controller.busy || controller.schedule?.enabled == true)
                .accessibilityIdentifier("native-ios-photo-auto-start-rule")
                Text("“仅备份新照片”按启用时刻与 PhotoKit 拍摄／修改日期初步判断，也核验之后编辑的旧照片；历史导入、日期变更仍待变更队列完善。只影响前台自动计划，手动／集中备份和独立 BGProcessing 仍会扫描全部已授权原件。")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("前台自动备份允许下载 iCloud 原件", isOn: $autoAllowICloud)
                    .disabled(controller.busy || controller.schedule?.enabled == true)
                    .accessibilityIdentifier("native-ios-photos-auto-icloud")
                if let active = controller.schedule, active.enabled {
                    Text("当前已保存：\(active.backupStartRule == .onlyNew ? "仅备份新照片（含启用后编辑）" : "扫描并备份全部照片")；每 \(active.intervalMinutes) 分钟检查；iCloud 原件 \(active.allowICloudOriginals ? "允许下载" : "仅限本机已下载")。")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-photos-auto-saved-settings")
                    if active.pausedForReview {
                        Label("已暂停：需核对收据", systemImage: "exclamationmark.triangle")
                    } else if photoAuthorization != .authorized && photoAuthorization != .limited {
                        Label("备份计划已保存：照片权限不可用", systemImage: "exclamationmark.triangle")
                    } else if photoAuthorization == .limited {
                        Label("前台自动备份：仅处理已授权照片", systemImage: "info.circle")
                    } else {
                        Label("前台自动备份已开启", systemImage: "checkmark.circle")
                    }
                    Text("下次允许检查：\(active.nextDueAt.formatted(date: .abbreviated, time: .shortened))")
                    if active.catchUpWhenBehind == true {
                        Label("积压加速已开启：前台约每分钟最多一轮",
                              systemImage: "bolt.circle")
                        Button("关闭积压加速，保留常规自动备份") {
                            guard let selected = login.owner else { return }
                            Task { @MainActor in
                                // Local stop never needs Server connectivity.
                                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                                else { return }
                                do {
                                    _ = try XDriveIOSPhotoAutoScheduleStore.shared
                                        .setCatchUp(owner: selected, enabled: false)
                                    controller.refresh(owner: selected)
                                } catch {
                                    consentError = "无法保存加速关闭设置，请检查本机计划状态。"
                                }
                            }
                        }.accessibilityIdentifier("native-ios-photos-catchup-disable")
                    } else if !active.pausedForReview {
                        Button("加速处理首次积压备份（需单独确认）") {
                            consentError = nil
                            catchUpConsentOwner = login.owner
                            showCatchUpConsent = catchUpConsentOwner != nil
                        }
                        .disabled(login.owner == nil)
                        .accessibilityIdentifier("native-ios-photos-catchup-enable")
                    }
                    Text("新启用的前台自动备份默认加速首次积压；既有计划保留此前的加速选择。仅 App 前台且收据正常时，每轮最多新增 20 个原件；未扫描完时约 60 秒后继续，完成整库一遍扫描后恢复所选间隔。")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("关闭当前账户自动备份", role: .destructive) {
                        controller.disable(owner: login.owner)
                    }.accessibilityIdentifier("native-ios-photos-auto-disable")
                } else {
                    Button("启用前台自动备份") {
                        consentError = nil
                        autoConsentOwner = login.owner
                        autoConsentMinutes = interval
                        autoConsentAllowICloud = autoAllowICloud
                        autoConsentStartRule = autoStartRule
                        autoConsentEnabledAt = Date()
                        showAutoConsent = autoConsentOwner != nil
                    }
                        .disabled(controller.busy || background.busy || login.owner == nil ||
                                  !destination.confirmedForCurrentName ||
                                  (photoAuthorization != .authorized && photoAuthorization != .limited))
                        .accessibilityIdentifier("native-ios-photos-auto-enable")
                }
                Text("自动计划采用启用时确认的备份范围、检查间隔、iCloud 设置和首次积压策略；修改设置需先停用再重新确认。手动备份的开关不会改变自动计划。仅 App 前台、Owner 重新验证后检查，iOS 不保证锁屏或强制退出后定时执行。系统 BGProcessing 需另行授权。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
    }

    @ViewBuilder
    private var backupStatusSections: some View {
            XDriveIOSPhotoQueueSummarySection(login: login, controller: controller)
            Section("当前图库与历史原件收据") {
                Button("只读统计当前图库和既有收据") {
                    coverage.refresh(login: login)
                }
                .disabled(coverage.busy || controller.busy || login.owner == nil ||
                          (photoAuthorization != .authorized &&
                           photoAuthorization != .limited))
                .accessibilityIdentifier("native-ios-photo-coverage-refresh")
                if coverage.busy {
                    ProgressView("正在读取已授权图库和历史收据…")
                    Button("取消读取") { coverage.cancel() }
                        .accessibilityIdentifier("native-ios-photo-coverage-cancel")
                }
                if let snapshot = coverage.snapshot {
                    Text("当前已授权媒体：\(snapshot.currentAuthorizedMedia) 项（照片 \(snapshot.localImages)，视频 \(snapshot.localVideos)）")
                        .monospacedDigit()
                        .accessibilityIdentifier("native-ios-photo-coverage-local-total")
                    if snapshot.limitedAuthorization {
                        Text("当前为 iOS 部分照片授权；此数量不是手机全部照片。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let tally = snapshot.historicLedger {
                        Text("当前账户既有账本：历史已确认 \(tally.historicallyConfirmed) 项 · 待核对 \(tally.uncertain) 项")
                            .monospacedDigit()
                            .accessibilityIdentifier("native-ios-photo-coverage-receipts")
                        Text("尚未上传 \(tally.preparedOnly) 项 · 收据不完整 \(tally.incompleteReceipt) 项 · 合计记录 \(tally.totalOperations) 项")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text("此设备当前账户尚无既有备份账本身份；历史收据数未知，不代表从未备份。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Text("统计时间：\(snapshot.checkedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                } else if !coverage.busy {
                    Text("尚未读取当前授权图库和历史收据。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Text("整库是否已经备份：尚未逐张核验。历史收据数量不是当前照片数量，也不能证明远端原件今天仍存在。不能以两者相除显示完成百分比。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-photo-coverage-no-false-completion")
                if let error = coverage.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.red)
                        .accessibilityIdentifier("native-ios-photo-coverage-error")
                }
            }
            Section("逐照片当前云端原件核验") {
                Text("显式选择一张当前授权的普通照片或视频；会重新读取原件 SHA-256，并只读核对当前 Owner 账本和服务器文件 Node。历史确认记录单独不能证明现在仍有备份。")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("核验时允许按需下载 iCloud 原件", isOn: $checkICloudOriginal)
                    .disabled(originalProof.busy)
                PhotosPicker(selection: $selectedOriginalToVerify,
                             matching: .any(of: [.images, .videos])) {
                    Label("选择一张照片或视频核验", systemImage: "checkmark.shield")
                }
                .disabled(originalProof.busy || login.owner == nil ||
                          (photoAuthorization != .authorized &&
                           photoAuthorization != .limited))
                .accessibilityIdentifier("native-ios-photo-current-receipt-picker")
                if selectedOriginalIdentifier != nil {
                    Button("重新核验已选原件") {
                        guard let id = selectedOriginalIdentifier else { return }
                        originalProof.verify(
                            localIdentifier: id, login: login,
                            allowICloudOriginals: checkICloudOriginal
                        )
                    }
                    .disabled(originalProof.busy)
                    .accessibilityIdentifier("native-ios-photo-current-receipt-recheck")
                }
                if originalProof.busy {
                    ProgressView("正在核实当前原件与服务器 Node…")
                    Button("取消单张核验") { originalProof.cancel() }
                        .accessibilityIdentifier("native-ios-photo-current-receipt-cancel")
                }
                if originalProof.currentNodeVerified,
                   let checked = originalProof.verifiedAt {
                    Label("当前云端原件已核验（截至 \(checked.formatted(date: .abbreviated, time: .shortened))）",
                          systemImage: "checkmark.shield")
                        .accessibilityIdentifier("native-ios-photo-current-receipt-verified")
                }
                Text(originalProof.message)
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-photo-current-receipt-message")
                Text("只核验当前选择的普通照片或视频；Live Photo 需要同时核验静态图、动态视频和完整 ZIP 清单。此结果仅代表核验时刻，不能据此宣布全部照片已备份。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("可选系统后台原件备份") {
                Text("前台自动备份与系统 BGProcessing 相互独立。必须先保存并核验受管备份目的地，后台再单独授权当前 iPhone、Owner 和对应 Source/Node；iOS 决定执行时机，首次约 6 小时后才可尝试，每次最多新增 \(XDriveIOSBGOriginalWindowStore.maximumNewOriginalsPerRun) 个原件。锁屏时若原件或加密账本不可读就安全退出；强制退出后不保证运行。")
                    .font(.footnote).foregroundStyle(.secondary)
                if background.checking {
                    ProgressView("正在验证本机后台授权…")
                }
                if let state = background.status {
                    if state.revokePending {
                        Label("本机后台已停止，远端撤销待确认",
                              systemImage: "exclamationmark.shield")
                            .foregroundStyle(.orange)
                    } else if state.enabled && background.pausedForReview {
                        Label("后台原件备份已暂停：需核对不确定收据",
                              systemImage: "exclamationmark.shield")
                            .foregroundStyle(.orange)
                    } else if state.enabled && background.serverVerified {
                        Label("当前服务器已确认后台授权", systemImage: "checkmark.shield")
                    } else if state.enabled {
                        Label("本机存在后台凭据，服务器授权尚未确认",
                              systemImage: "exclamationmark.shield")
                            .foregroundStyle(.orange)
                    } else {
                        Label(state.enrolled ? "后台授权已过期或不可用" : "尚未启用系统后台备份",
                              systemImage: "icloud.slash")
                    }
                    if state.enabled && background.pausedForReview {
                        if receipts.pending == 0 && receipts.hasLedgerScope && !receipts.busy {
                            Button("收据已核对，确认恢复系统后台备份") {
                                backgroundResumeOwner = login.owner
                                showBackgroundResumeConsent = backgroundResumeOwner != nil
                            }
                            .disabled(background.busy || background.checking ||
                                      controller.busy || login.owner == nil)
                            .accessibilityIdentifier("native-ios-photo-background-receipts-resume")
                        } else {
                            Text("后台计划保持暂停。先在下方只读核对全部不确定收据，再明确确认恢复；不会盲目重复上传。")
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    if let expiry = state.expiresAt {
                        Text("本机记录的授权到期时间：\(expiry.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if state.enabled && background.serverVerified &&
                       !background.pausedForReview &&
                       XDriveIOSPhotoBackgroundGrantPolicy.mayOfferRenewal(
                        expiresAt: state.expiresAt
                       ) {
                        Label("后台授权将在 72 小时内到期，可在本机前台续期",
                              systemImage: "clock.badge.exclamationmark")
                            .font(.footnote).foregroundStyle(.orange)
                        Button("续期系统后台备份授权") {
                            backgroundRenewOwner = login.owner
                            showBackgroundRenewConsent = backgroundRenewOwner != nil
                        }
                        .disabled(background.busy || background.checking ||
                                  controller.busy || login.owner == nil)
                        .accessibilityIdentifier("native-ios-photo-background-renew")
                    } else if state.enrolled && !state.enabled && !state.revokePending {
                        Text("此授权已经过期或不可用，不能直接续期；请先停用、核对远端撤销后再重新申请。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if state.enrolled {
                        Button(state.revokePending ? "重试撤销服务器授权" : "停止本机后台备份并撤销授权",
                               role: .destructive) {
                            backgroundDisableOwner = login.owner
                            showBackgroundDisableConsent = backgroundDisableOwner != nil
                        }
                        .disabled(background.busy || background.checking || controller.busy)
                        .accessibilityIdentifier("native-ios-photo-background-disable")
                    } else {
                        Button("单独申请系统后台备份授权") {
                            backgroundEnableOwner = login.owner
                            showBackgroundEnableConsent = backgroundEnableOwner != nil
                        }
                        .disabled(background.busy || background.checking || controller.busy ||
                                  login.owner == nil || !destination.confirmedForCurrentName)
                        .accessibilityIdentifier("native-ios-photo-background-enable")
                    }
                } else if !background.checking {
                    Text("当前账户后台授权状态未验证；不会假定已开启。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if background.busy { ProgressView("正在安全处理后台授权…") }
                Button("刷新后台授权状态") { background.refresh(login: login) }
                    .disabled(background.busy || background.checking)
                    .accessibilityIdentifier("native-ios-photo-background-status")
                if let note = background.notice {
                    Text(note).font(.footnote).foregroundStyle(.secondary)
                }
                if let error = background.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.red)
                        .accessibilityIdentifier("native-ios-photo-background-error")
                }
            }
            Section("不确定收据核对") {
                Text("如果上传完成确认丢失，自动备份会暂停。以下功能只检查既有 Server 会话和文件收据，不重新上传、不删除账本。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let pending = receipts.pending {
                    Label("待核对 \(pending) 项",
                          systemImage: pending == 0 ? "checkmark.shield" : "exclamationmark.shield")
                        .accessibilityIdentifier("native-ios-photo-receipts-pending")
                } else {
                    Text("待核对数量尚未验证")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if receipts.busy {
                    ProgressView("正在安全核对收据…")
                    Button("取消核对") { receipts.cancel() }
                        .accessibilityIdentifier("native-ios-photo-receipts-cancel")
                } else {
                    Button("刷新当前 Owner 的账本状态") {
                        receipts.refresh(login: login)
                    }
                    .accessibilityIdentifier("native-ios-photo-receipts-status")
                    Button("只读核对最多 20 项") {
                        receipts.reconcile(login: login)
                    }
                    .disabled(!receipts.hasLedgerScope || (receipts.pending ?? 0) == 0)
                    .accessibilityIdentifier("native-ios-photo-receipts-review")
                }
                if let report = receipts.summary {
                    Text("本轮检查 \(report.checked) · 已确认 \(report.confirmed) · 进行中但未确认 \(report.activeUnverified)")
                        .monospacedDigit()
                    Text("无会话证据 \(report.noEvidence) · 已过期 \(report.expired) · 存在歧义 \(report.ambiguous)")
                        .font(.footnote)
                }
                if controller.schedule?.pausedForReview == true {
                    Text("当前自动计划因不确定上传结果暂停。")
                        .font(.footnote).foregroundStyle(.orange)
                    if receipts.pending == 0 && receipts.hasLedgerScope && !receipts.busy {
                        Button("确认无待核对收据后恢复前台计划") {
                            consentError = nil
                            resumeConsentOwner = login.owner
                            showResumeConsent = resumeConsentOwner != nil
                        }
                        .accessibilityIdentifier("native-ios-photo-receipts-resume")
                    } else {
                        Text("必须先核对并证实当前 Owner 的所有不确定收据，才能重新开启计划。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let notice = receipts.notice {
                    Text(notice).font(.footnote).foregroundStyle(.secondary)
                }
                if let failure = receipts.errorMessage {
                    Text(failure).font(.footnote).foregroundStyle(.red)
                }
            }
            Section("查看已备份原件") {
                Button {
                    // The destination performs a fresh native Owner/root proof;
                    // this shortcut neither interprets ACKs nor uploads bytes.
                    guard login.owner != nil else { return }
                    onShowCloudOriginals()
                } label: {
                    Label("打开当前账户云端备份原件", systemImage: "icloud")
                }
                .disabled(login.owner == nil)
                .accessibilityIdentifier("native-ios-photos-cloud-originals")
                Text("只读查看当前 Owner 根目录中已写入的备份文件。待核对收据不代表上传成功；Live ZIP 通过双资源校验后可在 Viewer 中播放原生实况，也可查看静态原件和独立视频回退。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("执行结果") {
                if let consentError {
                    Text(consentError).foregroundStyle(.red)
                        .accessibilityIdentifier("native-ios-photos-consent-error")
                }
                Text(controller.message)
                if let error = controller.errorMessage {
                    Text(error).foregroundStyle(.red)
                        .accessibilityIdentifier("native-ios-photos-backup-error")
                }
                Text("未知 ACK 将保留在加密账本中，不能直接重试或宣称已经备份。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
    }

    private func syncSavedAutomaticSettings() {
        controller.refresh(owner: login.owner)
        if let active = controller.schedule, active.enabled {
            interval = active.intervalMinutes
            autoAllowICloud = active.allowICloudOriginals
            autoStartRule = active.backupStartRule ?? .everything
        }
    }
}
