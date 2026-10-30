import Photos
import SwiftUI

/// Native opt-in for bounded still/video/Live originals, not a WebView bridge.
struct XDriveIOSNativePhotoBackupScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    @StateObject private var receipts = XDriveIOSNativePhotoReceiptReviewController()
    @State private var interval = 60
    @State private var allowICloud = false
    @State private var showAutoConsent = false
    @State private var showManualConsent = false
    @State private var showResumeConsent = false
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
                    .disabled(controller.busy || login.owner == nil)
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
                        .disabled(controller.busy || login.owner == nil)
                        .accessibilityIdentifier("native-ios-photos-auto-enable")
                }
                Text("只在 App 处于前台且当前原生账户已重新验证时运行。独立的系统 BGProcessing 授权不会因此自动开启；iOS 不保证强制退出或锁屏后按时运行。")
                    .font(.footnote).foregroundStyle(.secondary)
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
        .onAppear {
            controller.refresh(owner: login.owner)
            receipts.refresh(login: login)
        }
        .onDisappear {
            receipts.cancel()
            showManualConsent = false
            showAutoConsent = false
            showResumeConsent = false
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
            showManualConsent = false
            showAutoConsent = false
            showResumeConsent = false
            manualConsentOwner = nil
            autoConsentOwner = nil
            resumeConsentOwner = nil
            receipts.cancel()
            controller.refresh(owner: login.owner)
            receipts.refresh(login: login)
        }
    }
}
