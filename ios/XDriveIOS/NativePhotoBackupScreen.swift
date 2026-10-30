import Photos
import SwiftUI

/// Native opt-in for bounded still/video/Live originals, not a WebView bridge.
struct XDriveIOSNativePhotoBackupScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    @State private var interval = 60
    @State private var allowICloud = false
    @State private var showAutoConsent = false
    @State private var showManualConsent = false

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
                Button("开始一轮原件备份") { showManualConsent = true }
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
                    Button("启用前台自动备份") { showAutoConsent = true }
                        .disabled(controller.busy || login.owner == nil)
                        .accessibilityIdentifier("native-ios-photos-auto-enable")
                }
                Text("只在 App 处于前台且当前原生账户已重新验证时运行。独立的系统 BGProcessing 授权不会因此自动开启；iOS 不保证强制退出或锁屏后按时运行。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("执行结果") {
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
            Button("确认备份到当前云端账户") {
                controller.startManual(login: login, allowICloud: allowICloud)
            }
        } message: {
            Text("仅本轮执行，最多新增 20 个文件。\(allowICloud ? "允许按需下载 iCloud 原件。" : "不会下载 iCloud 原件。")")
        }
        .confirmationDialog("开启自动原件备份？",
                            isPresented: $showAutoConsent, titleVisibility: .visible) {
            Button("确认启用") {
                Task { await controller.configure(login: login, minutes: interval,
                                                  allowICloud: allowICloud) }
            }
        } message: {
            Text("仅前台运行，每 \(interval) 分钟检查授权相册；每轮最多新增 20 个原件，上传至当前登录的服务器与 Owner。")
        }
        .onAppear { controller.refresh(owner: login.owner) }
    }
}
