import SwiftUI

/// Owner-scoped local PhotoKit queue status. Lifecycle and refresh ownership
/// live here so the large backup settings form does not inherit extra state
/// and modifiers. Counts are discovery telemetry, never cloud coverage.
struct XDriveIOSPhotoQueueSummarySection: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    @StateObject private var queueSummary = XDriveIOSNativePhotoQueueSummaryModel()
    @Environment(\.scenePhase) private var phase

    private var enabled: Bool {
        controller.schedule?.enabled == true &&
            controller.schedule?.backupStartRule == .onlyNew
    }

    private func refreshIfEnabled() {
        guard enabled, phase == .active else { return }
        queueSummary.refresh(login: login)
    }

    @ViewBuilder
    var body: some View {
        if enabled {
            Section("本机新增照片变更队列") {
                Button("刷新变更队列数量") {
                    queueSummary.refresh(login: login)
                }
                .disabled(queueSummary.busy || login.owner == nil)
                .accessibilityIdentifier("native-ios-photo-change-queue-refresh")
                if queueSummary.busy {
                    ProgressView("读取当前账户的持久化变更队列…")
                }
                if let counts = queueSummary.counts {
                    Text("待处理 \(counts.pending) · 失败 \(counts.failed) · 已确认处理 \(counts.confirmed) · 本机已删除 \(counts.missingLocal)")
                        .monospacedDigit()
                        .accessibilityIdentifier("native-ios-photo-change-queue-counts")
                    if counts.failed > 0 {
                        Text("失败候选仍需核对当前账户的真实收据，不能直接认定可安全重新上传。")
                            .font(.footnote).foregroundStyle(.orange)
                    }
                } else if !queueSummary.busy && queueSummary.errorMessage == nil {
                    Text("尚无可读取的变更队列基准；这不代表没有待备份照片。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error = queueSummary.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.orange)
                        .accessibilityIdentifier("native-ios-photo-change-queue-error")
                }
                Text("这些只是启用“仅备份新照片”后本机已捕获的 PhotoKit 变更状态，不包含此前的全部库存，也不能当作服务器备份覆盖率。实际上传成功必须核验当前受管目录的原件收据。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .onAppear { refreshIfEnabled() }
            .onDisappear { queueSummary.cancel() }
            .onChange(of: login.owner) { _ in
                queueSummary.cancel()
                refreshIfEnabled()
            }
            .onChange(of: phase) { state in
                if state == .active { refreshIfEnabled() }
                else { queueSummary.cancel() }
            }
            .onChange(of: controller.busy) { busy in
                if !busy { refreshIfEnabled() }
            }
            .onChange(of: enabled) { active in
                if active { refreshIfEnabled() }
                else { queueSummary.cancel() }
            }
        }
    }
}
