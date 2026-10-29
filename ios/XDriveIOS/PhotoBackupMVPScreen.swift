import Photos
import SwiftUI

/// First practical iOS Photos backup surface. This stays inside the existing
/// native diagnostic account and writes only Owner-authorized cloud files.
/// The canonical PWA Files/Gallery app and its Cookie session are untouched.
struct XDriveIOSPhotoBackupMVPScreen: View {
    @ObservedObject var model: LoginViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var allowICloudOriginals = false
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var runTask: Task<Void, Never>?

    private var hasPhotoPermission: Bool {
        authorization == .authorized || authorization == .limited
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Label("iOS 相册备份到云端文件", systemImage: "icloud.and.arrow.up")
                        .font(.title3.weight(.semibold))
                    Text("首个前台最小可用版本：每轮扫描最近最多 256 个已授权项目，每次最多新增 20 张普通照片。再次运行会通过原始 SHA-256、加密账本与当前 Server 文件回读，核验并跳过已备份的照片。")
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)

                    if authorization == .limited {
                        Label("目前只有 iOS 允许的部分照片能参与备份。", systemImage: "lock.shield")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if !hasPhotoPermission {
                        Text("开始前需要授权访问系统相册。当前未授权时不会读取照片或上传任何内容。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if authorization == .notDetermined {
                            Button("允许访问系统相册") {
                                PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                                    Task { @MainActor in
                                        authorization = status
                                    }
                                }
                            }
                            .buttonStyle(.borderedProminent)
                        } else if let settings = URL(string: UIApplication.openSettingsURLString) {
                            Link("前往 iOS 设置调整照片权限", destination: settings)
                        }
                    }

                    Toggle("允许从 iCloud 下载当前照片原件", isOn: $allowICloudOriginals)
                        .disabled(model.photoBackupBusy)
                    Text("默认关闭。iCloud 原件缺失的照片会被记录为未完成，不会使用低清预览代替。原件仅暂存在本机受保护目录，上传后立即清理。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Divider()
                    if let progress = model.photoBackupProgress {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(progress.stage).font(.subheadline.weight(.medium))
                            let total = max(1, min(progress.totalVisible,
                                                   XDriveIOSForegroundPhotoBackupMVP.maxScannedAssets))
                            ProgressView(
                                value: Double(min(progress.scanned, total)),
                                total: Double(total)
                            )
                                .accessibilityIdentifier("native-photo-backup-progress")
                            Text("已扫描 \(progress.scanned) / \(min(progress.totalVisible, XDriveIOSForegroundPhotoBackupMVP.maxScannedAssets))")
                                .font(.footnote)
                                .monospacedDigit()

                            HStack(spacing: 12) {
                                resultBadge("新增保存", count: progress.uploaded)
                                resultBadge("核验跳过", count: progress.verifiedAlready)
                            }
                            HStack(spacing: 12) {
                                resultBadge("Live 未支持", count: progress.liveNotSupported)
                                resultBadge("视频未支持", count: progress.videosNotSupported)
                            }
                            HStack(spacing: 12) {
                                resultBadge("原件不可用", count: progress.unavailable)
                                resultBadge("需人工核对", count: progress.needsReview)
                            }
                            if progress.isLimited {
                                Text("统计仅对应已授权子集，不是整机相册。")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    if let message = model.photoBackupMessage {
                        Text(message)
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("native-photo-backup-result")
                    }

                    if model.photoBackupBusy {
                        ProgressView("正在备份原件，请保持 App 处于前台…")
                        Button("取消本轮备份") { runTask?.cancel() }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("native-photo-backup-cancel")
                    } else {
                        Button {
                            runTask?.cancel()
                            runTask = Task {
                                await model.runForegroundPhotoBackup(
                                    allowICloudOriginals: allowICloudOriginals
                                )
                                runTask = nil
                            }
                        } label: {
                            Label("开始本轮照片备份", systemImage: "arrow.up.doc")
                                .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!hasPhotoPermission || model.verifiedOwner == nil ||
                                  model.isLoading || model.manualUploadBusy)
                        .accessibilityIdentifier("native-photo-backup-start")
                    }

                    Divider()
                    Text("首版只确认普通照片原始文件上传。Live Photo 必须等静态图与动态视频有权威配对收据后才算完成；视频、超过扫描范围的项目、授权外照片均明确排除。不会删除手机或云端照片，也不会在退出 App 后假装后台继续备份。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
                .frame(maxWidth: 600, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("照片备份")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                        .disabled(model.photoBackupBusy)
                }
            }
        }
        .interactiveDismissDisabled(model.photoBackupBusy)
        .onChange(of: scenePhase) { phase in
            if phase != .active {
                runTask?.cancel()
            } else {
                authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            }
        }
        .onDisappear { runTask?.cancel() }
    }

    private func resultBadge(_ name: String, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name).font(.caption).foregroundStyle(.secondary)
            Text(count.formatted()).font(.title3.weight(.semibold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
    }
}
