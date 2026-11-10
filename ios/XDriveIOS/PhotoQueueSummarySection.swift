import SwiftUI
import Photos
import UIKit

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
                    Text("待处理 \(counts.pending) · 等待 iCloud \(counts.waitingICloud) · 失败 \(counts.failed) · 已确认处理 \(counts.confirmed) · 本机已删除 \(counts.missingLocal)")
                        .monospacedDigit()
                        .accessibilityIdentifier("native-ios-photo-change-queue-counts")
                    if counts.waitingICloud > 0 {
                        Text("系统后台不会下载 iCloud 原件。这些项目未备份；只有已明确允许下载 iCloud 原件的前台自动计划，才会每轮最多重新尝试 4 项，并重新核验云端收据。")
                            .font(.footnote).foregroundStyle(.orange)
                            .accessibilityIdentifier("native-ios-photo-change-queue-icloud-waiting")
                    }
                    if counts.failed > 0 {
                        Text("失败候选仅包含已证明没有不确定服务器写入的项目；未知 ACK 不在此队列。")
                            .font(.footnote).foregroundStyle(.orange)
                        if let reasons = queueSummary.failedReasonDescription {
                            Text("失败原因（仅本机当前变更版本）：\(reasons)")
                                .font(.footnote).foregroundStyle(.secondary)
                                .accessibilityIdentifier("native-ios-photo-change-queue-failure-reasons")
                        }
                        Button("重新排队失败项（最多 64 项）") {
                            queueSummary.retryFailed(login: login)
                        }
                        .disabled(queueSummary.busy ||
                                  controller.schedule?.pausedForReview == true)
                        .accessibilityIdentifier("native-ios-photo-change-queue-retry")
                        if controller.schedule?.pausedForReview == true {
                            Text("自动备份因上传收据待核对而暂停；先完成收据核对，不能通过此按钮绕过暂停。")
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    if let notice = queueSummary.notice {
                        Text(notice).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-photo-change-queue-notice")
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


/// A visible-only 56px thumbnail, never a full-resolution PhotoKit export.
/// An iCloud-only item stays a neutral placeholder until explicitly reviewed.
private struct XDriveIOSNativePhotoTaskThumbnail: View {
    let localIdentifier: String
    @StateObject private var loader = XDriveIOSPhotoImageLoader()

    var body: some View {
        Group {
            if let image = loader.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
                    .overlay {
                        Image(systemName: loader.isLoading ? "clock" : "photo")
                            .foregroundStyle(.secondary)
                    }
            }
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: localIdentifier) {
            loader.load(localIdentifier, size: CGSize(width: 128, height: 128),
                        allowICloud: false)
        }
        .onDisappear { loader.cancel() }
    }
}

/// Shared native task-sheet for the Gallery and Backup screen. Change-queue
/// pages are exact-revision SQLite metadata; Library pages are read-only
/// PhotoKit windows. Neither mode can label an unverified Node as backed up.
struct XDriveIOSNativePhotoBackupTaskList: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @ObservedObject var controller: XDriveIOSNativePhotoBackupController
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativePhotoTaskListModel()
    @State private var mode = XDriveIOSNativePhotoTaskListModel.Mode.changes
    @State private var filter = XDriveIOSNativePhotoTaskListModel.Filter.all
    @State private var allowICloud = false
    @State private var showPriorityConsent = false
    @State private var priorityOwner: XDriveNativeOwnerRoot?
    @State private var priorityID: String?
    @State private var priorityWasFailure = false

    private func refresh() {
        guard phase == .active else { return }
        model.reload(login: login, mode: mode, filter: filter)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Picker("任务来源", selection: $mode) {
                    ForEach(XDriveIOSNativePhotoTaskListModel.Mode.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12)
                if mode == .changes {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            ForEach(XDriveIOSNativePhotoTaskListModel.Filter.allCases) { option in
                                Button(option.title) { filter = option }
                                    .buttonStyle(.bordered)
                                    .tint(filter == option ? Color.accentColor : Color.gray)
                            }
                        }
                        .padding(.horizontal, 12)
                    }
                }
                if let totals = model.counts, mode == .changes {
                    Text("待处理 \(totals.pending) · iCloud \(totals.waitingICloud) · 失败 \(totals.failed) · 曾确认 \(totals.confirmed) · 已删除 \(totals.missingLocal)")
                        .font(.caption).monospacedDigit()
                        .padding(.horizontal, 12)
                } else if let total = model.libraryTotal, mode == .library {
                    Text("当前授权图库 \(total) 项 · 以下均为只读待核验状态")
                        .font(.caption).monospacedDigit()
                        .padding(.horizontal, 12)
                }
                if let notice = model.notice {
                    Text(notice).font(.footnote).foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                }
                if let error = model.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.orange)
                        .padding(.horizontal, 12)
                }
                if model.loading {
                    ProgressView("正在读取当前账户的任务页…")
                }
                List {
                    ForEach(model.rows) { item in
                        HStack(alignment: .center, spacing: 10) {
                            if item.localAvailable {
                                XDriveIOSNativePhotoTaskThumbnail(localIdentifier: item.id)
                            } else {
                                Image(systemName: "photo.badge.exclamationmark")
                                    .frame(width: 56, height: 56)
                                    .foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.typeLabel)
                                if let date = item.date {
                                    Text(date.formatted(date: .abbreviated, time: .shortened))
                                        .font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("拍摄时间未知").font(.caption).foregroundStyle(.secondary)
                                }
                                if let badge = XDriveIOSNativeVisiblePhotoQueueBadgePolicy.badge(
                                    for: model.verifiedPageIDs.contains(item.id) ? "matched" : item.state,
                                    failureReasonCode: item.failureReasonCode
                                ) {
                                    Label(badge.title, systemImage: badge.symbol)
                                        .font(.caption)
                                        .accessibilityHint(Text(badge.explanation))
                                } else if item.state == "missingLocal" {
                                    Label("本机已删除", systemImage: "trash")
                                        .font(.caption)
                                }
                            }
                            Spacer(minLength: 4)
                            if item.localAvailable &&
                               !controller.busy && !model.verifyingPage {
                                Button(item.state == "failed" ? "核对并重试" : "优先处理") {
                                    priorityOwner = login.owner
                                    priorityID = item.id
                                    priorityWasFailure = item.state == "failed"
                                    showPriorityConsent = priorityOwner != nil
                                }
                                .buttonStyle(.bordered)
                                .disabled(model.loading)
                                .accessibilityIdentifier("native-ios-photo-task-item-priority")
                            }
                        }
                        .accessibilityElement(children: .contain)
                    }
                }
                .listStyle(.plain)
                HStack {
                    Button("上一页") { model.previous(login: login, mode: mode, filter: filter) }
                        .disabled(model.offset == 0 || model.loading)
                    Spacer()
                    Text("第 \(model.offset + 1) 项起")
                        .font(.caption).monospacedDigit()
                    Spacer()
                    Button("下一页") { model.next(login: login, mode: mode, filter: filter) }
                        .disabled(!model.hasNext || model.loading)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                if mode == .library {
                    HStack {
                        Button("只读核验本页接下来的 8 项") {
                            model.verifyNextPageBatch(
                                login: login, allowICloudOriginals: allowICloud
                            )
                        }
                        .disabled(model.loading || model.verifyingPage ||
                                  model.pageChecked >= model.rows.count || login.owner == nil)
                        .accessibilityIdentifier("native-ios-photo-library-page-proof-next")
                        if model.verifyingPage { ProgressView("正在核验…") }
                    }
                    .padding(.horizontal, 16)
                    Text("本页当前已核验 \(model.pageChecked)/\(model.rows.count) 项 · 云端 Node 通过 \(model.verifiedPageIDs.count) 项；结果仅在当前页面与 PhotoKit 版本有效。")
                        .font(.caption)
                        .padding(.horizontal, 16)
                    Text("核验会读取原件、SHA-256 和当前服务器 Node，不会上传或删除；失败／未核验项不能推断云端覆盖。")
                        .font(.caption).foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                }
                Toggle("单张优先备份允许下载 iCloud 原件", isOn: $allowICloud)
                    .font(.caption)
                    .padding(.horizontal, 16)
                Text("优先操作沿用唯一原件上传与收据链；未知 ACK 必须先核对。显示的队列“曾确认”不证明现在仍有云端原件。")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            }
            .navigationTitle("相册备份任务")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("完成") { dismiss() }
                        .accessibilityIdentifier("native-ios-photo-task-list-done")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("刷新") { refresh() }.disabled(model.loading)
                }
            }
            .confirmationDialog(
                priorityWasFailure ? "核对并安全重试该失败原件？" : "优先核验或备份此原件？",
                isPresented: $showPriorityConsent, titleVisibility: .visible
            ) {
                Button("确认处理所选原件") {
                    guard let owner = priorityOwner, let id = priorityID,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                          PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized,
                          phase == .active else { return }
                    controller.startSingle(
                        login: login, expectedOwner: owner,
                        localIdentifier: id, allowICloud: allowICloud
                    )
                    priorityOwner = nil
                    priorityID = nil
                }
            } message: {
                Text("仅当前 Owner 的这一项；重新验证照片身份、受管目标、上传账本及服务器原件收据，绝不绕过待核对 ACK。")
            }
            .onAppear {
                mode = controller.schedule?.backupStartRule == .onlyNew ? .changes : .library
                refresh()
            }
            .onChange(of: mode) { _ in refresh() }
            .onChange(of: filter) { _ in refresh() }
            .onChange(of: controller.busy) { busy in
                if !busy && phase == .active {
                    model.refreshCurrent(login: login, mode: mode, filter: filter)
                }
            }
            .onChange(of: login.owner) { _ in
                priorityOwner = nil
                priorityID = nil
                showPriorityConsent = false
                refresh()
            }
            .onChange(of: phase) { state in
                if state == .active { refresh() }
                else { model.reset(); showPriorityConsent = false }
            }
            .onDisappear {
                model.reset()
                showPriorityConsent = false
                priorityOwner = nil
                priorityID = nil
            }
        }
    }
}
