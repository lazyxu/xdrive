import Photos
import SwiftUI

/// Native opt-in for bounded still/video/Live originals, not a WebView bridge.
struct XDriveIOSNativePhotoBackupScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    let onShowCloudOriginals: () -> Void
    @StateObject private var receipts = XDriveIOSNativePhotoReceiptReviewController()
    @StateObject private var background = XDriveIOSNativeBackgroundPhotoControls()
    @Environment(\.scenePhase) private var phase
    @State private var interval = 60
    @State private var allowICloud = false
    @State private var showAutoConsent = false
    @State private var showManualConsent = false
    @State private var showResumeConsent = false
    @State private var showCatchUpConsent = false
    @State private var showBackgroundEnableConsent = false
    @State private var showBackgroundDisableConsent = false
    @State private var backgroundEnableOwner: XDriveNativeOwnerRoot?
    @State private var backgroundDisableOwner: XDriveNativeOwnerRoot?
    @State private var catchUpConsentOwner: XDriveNativeOwnerRoot?
    // Capture the exact verified Owner and settings BEFORE any native consent
    // dialog; a late confirmation must never authorize another Server.
    @State private var manualConsentOwner: XDriveNativeOwnerRoot?
    @State private var manualConsentAllowICloud = false
    @State private var autoConsentOwner: XDriveNativeOwnerRoot?
    @State private var autoConsentMinutes = 60
    @State private var autoConsentAllowICloud = false
    @State private var resumeConsentOwner: XDriveNativeOwnerRoot?
    @State private var consentError: String?

    var body: some View {
        Form {
            Section("备份范围") {
                Text("当前账户：\(login.owner?.username ?? "未登录")")
                Text("照片、视频与 Live Photo 双原件 ZIP 会保存到当前 Owner 云端根目录。每轮最多检查 256 项、新增 20 个原件；上传前后核验身份与收据。")
                    .font(.footnote).foregroundStyle(.secondary)
                Toggle("允许下载 iCloud 原件", isOn: $allowICloud)
                    .disabled(controller.busy)
                Text("关闭时只备份设备上可读取的原件；不为节省流量而降低文件质量。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("手动备份") {
                Button("开始一轮原件备份") {
                    consentError = nil
                    manualConsentOwner = login.owner
                    manualConsentAllowICloud = allowICloud
                    showManualConsent = manualConsentOwner != nil
                }
                    .disabled(controller.busy || background.busy || login.owner == nil)
                    .accessibilityIdentifier("native-ios-photos-manual-start")
                if controller.busy {
                    ProgressView("正在验证并备份原件…")
                    Button("取消本轮") { controller.cancel() }
                        .accessibilityIdentifier("native-ios-photos-cancel")
                }
                if let result = controller.progress {
                    Text(result.stage)
                    Text("当前段已扫描 \(result.scanned) · 新增 \(result.uploaded) · 已验证 \(result.verifiedAlready)")
                        .monospacedDigit()
                    Text("视频新增 \(result.videoUploaded)，Live ZIP 新增 \(result.liveBundleUploaded)，待核对 \(result.needsReview)，不可用 \(result.unavailable)")
                        .font(.footnote)
                }
            }
            Section("前台自动增量") {
                Picker("检查间隔", selection: $interval) {
                    Text("15 分钟").tag(15)
                    Text("1 小时").tag(60)
                    Text("6 小时").tag(360)
                    Text("24 小时").tag(1440)
                }
                .disabled(controller.busy || controller.schedule?.enabled == true)
                if let active = controller.schedule, active.enabled {
                    Label(active.pausedForReview ? "已暂停：需核对收据" : "前台自动备份已开启",
                          systemImage: active.pausedForReview ? "exclamationmark.triangle" : "checkmark.circle")
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
                    Text("积压加速默认关闭。手动同意后，仅 App 前台且收据正常时，每轮最多新增 20 个原件；有积压时约 60 秒后尝试下一轮。扫描完一遍后恢复所选间隔。")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("关闭当前账户自动备份", role: .destructive) {
                        controller.disable(owner: login.owner)
                    }.accessibilityIdentifier("native-ios-photos-auto-disable")
                } else {
                    Button("启用前台自动备份") {
                        consentError = nil
                        autoConsentOwner = login.owner
                        autoConsentMinutes = interval
                        autoConsentAllowICloud = allowICloud
                        showAutoConsent = autoConsentOwner != nil
                    }
                        .disabled(controller.busy || background.busy || login.owner == nil)
                        .accessibilityIdentifier("native-ios-photos-auto-enable")
                }
                Text("只在 App 处于前台且当前原生账户已重新验证时运行。独立的系统 BGProcessing 授权不会因此自动开启；iOS 不保证强制退出或锁屏后按时运行。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("可选系统后台原件备份") {
                Text("前台自动备份与系统 BGProcessing 相互独立。后台需要单独授权当前设备及 Owner 根目录；iOS 决定执行时机，首次约 6 小时后才可尝试，每次最多新增 1 个原件。锁屏时若原件或加密账本不可读就安全退出；强制退出后不保证运行。")
                    .font(.footnote).foregroundStyle(.secondary)
                if background.checking {
                    ProgressView("正在验证本机后台授权…")
                }
                if let state = background.status {
                    if state.revokePending {
                        Label("本机后台已停止，远端撤销待确认",
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
                    if let expiry = state.expiresAt {
                        Text("本机记录的授权到期时间：\(expiry.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
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
                                  login.owner == nil)
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
                Text("只读查看当前 Owner 根目录中已写入的备份文件。待核对收据不代表上传成功；Live 双原件 ZIP 尚不支持云端动态播放。")
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
        .navigationTitle("相册备份")
        .confirmationDialog("确认开始上传已授权的照片/视频/Live 原件？",
                            isPresented: $showManualConsent, titleVisibility: .visible) {
            Button("确认备份到已核验的云端账户") {
                guard let expected = manualConsentOwner,
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
        .confirmationDialog("开启自动原件备份？",
                            isPresented: $showAutoConsent, titleVisibility: .visible) {
            Button("确认启用") {
                guard let expected = autoConsentOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    consentError = "服务器或账户已变化，自动备份授权失效；未开启计划。"
                    return
                }
                Task {
                    await controller.configure(
                        login: login, expectedOwner: expected,
                        minutes: autoConsentMinutes,
                        allowICloud: autoConsentAllowICloud
                    )
                }
            }
        } message: {
            Text("服务器：\(autoConsentOwner?.origin.host ?? "未验证") · Owner：\(autoConsentOwner?.username ?? "未验证")。仅前台运行，每 \(autoConsentMinutes) 分钟检查授权相册；每轮最多新增 20 个原件。")
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
                background.enable(login: login, expectedOwner: selected)
            }
        } message: {
            Text("服务器：\(backgroundEnableOwner?.origin.host ?? "未验证")，Owner：\(backgroundEnableOwner?.username ?? "未验证")。系统会获得当前设备与 Owner 根目录的可撤销授权，后台任务仍受 iOS 调度和原件保护限制；不会保证锁屏或强制退出后备份。")
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
            controller.refresh(owner: login.owner)
            receipts.refresh(login: login)
            background.refresh(login: login)
        }
        .onDisappear {
            receipts.cancel()
            background.invalidateRead()
            showBackgroundEnableConsent = false
            showBackgroundDisableConsent = false
            backgroundEnableOwner = nil
            backgroundDisableOwner = nil
            showManualConsent = false
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
            }
        }
        .onChange(of: login.owner) { _ in
            // Invalidate any consent that was opened for the previous Owner.
            background.invalidateRead()
            showBackgroundEnableConsent = false
            showBackgroundDisableConsent = false
            backgroundEnableOwner = nil
            backgroundDisableOwner = nil
            background.refresh(login: login)
            showManualConsent = false
            showAutoConsent = false
            showResumeConsent = false
            showCatchUpConsent = false
            catchUpConsentOwner = nil
            manualConsentOwner = nil
            autoConsentOwner = nil
            resumeConsentOwner = nil
            receipts.cancel()
            controller.refresh(owner: login.owner)
            receipts.refresh(login: login)
        }
    }
}
