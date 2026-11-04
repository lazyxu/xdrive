import Foundation
import SwiftUI

/// A destination is only a navigation hint until its own current Owner page
/// has been verified. No destination from a previous Owner is reusable.
struct XDriveIOSNativeFilesDestination: Hashable, Identifiable {
    let id: UInt64
    let name: String
}


struct XDriveIOSNativeFilesDestinationPicker: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let originalOwner: XDriveNativeOwnerRoot
    let selected: XDriveIOSNativeFilesNode
    // Default keeps existing single-node callers source-compatible.
    var selectedItems: [XDriveIOSNativeFilesNode] = []
    let kind: XDriveIOSNativeFilesDestinationKind
    let onChoose: (XDriveIOSNativeFilesDestination) -> Void

    @State private var path: [XDriveIOSNativeFilesDestination] = []

    var body: some View {
        NavigationStack(path: $path) {
            XDriveIOSNativeFilesDestinationPage(
                login: login, originalOwner: originalOwner,
                folder: .init(id: originalOwner.rootNodeID, name: "云端根目录"),
                selected: selected, selectedItems: selectedItems,
                kind: kind, onChoose: onChoose,
                onCreated: { destination in path.append(destination) }
            )
        }
    }
}

/// A real 64-item counted directory Range is the ONLY source of target folders.
/// Every pushed page owns a separate native navigation state and cancels on exit.
private struct XDriveIOSNativeFilesDestinationPage: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let originalOwner: XDriveNativeOwnerRoot
    let folder: XDriveIOSNativeFilesDestination
    let selected: XDriveIOSNativeFilesNode
    // Default keeps existing single-node callers source-compatible.
    var selectedItems: [XDriveIOSNativeFilesNode] = []
    let kind: XDriveIOSNativeFilesDestinationKind
    let onChoose: (XDriveIOSNativeFilesDestination) -> Void
    let onCreated: (XDriveIOSNativeFilesDestination) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var page: XDriveIOSNativeFilesRange?
    @State private var offset = 0
    @State private var visibleNodes: [XDriveIOSNativeFilesNode] = []
    @State private var startOffset = 0
    @State private var totalCount = 0
    @State private var loadingAdjacent = false
    @State private var adjacentFailure: String?
    @State private var failedDirection: XDriveIOSNativeFilesContinuousWindowPolicy.Direction?
    @State private var adjacentTicket = UUID()
    @State private var adjacentWork: Task<Void, Never>?
    @State private var lastAutoRequestedFolderID: UInt64?
    @State private var busy = false
    @State private var failure: String?
    @State private var epoch = UUID()
    @State private var work: Task<Void, Never>?
    @State private var showingCreate = false
    @State private var folderDraft = ""
    @State private var creating = false
    @State private var createStatus: String?
    @State private var creationEpoch = UUID()
    @State private var creationTask: Task<Void, Never>?

    private var allSelected: [XDriveIOSNativeFilesNode] {
        selectedItems.isEmpty ? [selected] : selectedItems
    }

    private var canUseTarget: Bool {
        page != nil && !busy && failure == nil && !creating && !loadingAdjacent &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner) &&
            !allSelected.contains(where: { $0.isDirectory && $0.id == folder.id }) &&
            !(kind == .move && allSelected.contains(where: { $0.parent_id == folder.id }))
    }

    private var canCreateFolder: Bool {
        page != nil && !busy && failure == nil && !creating && !loadingAdjacent &&
            XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
    }

    private var canLoadNext: Bool {
        XDriveIOSNativeFilesContinuousWindowPolicy.requestedOffset(
            direction: .next, startOffset: startOffset,
            loadedCount: visibleNodes.count, total: totalCount
        ) != nil
    }

    private var canLoadPrevious: Bool {
        XDriveIOSNativeFilesContinuousWindowPolicy.requestedOffset(
            direction: .previous, startOffset: startOffset,
            loadedCount: visibleNodes.count, total: totalCount
        ) != nil
    }

    var body: some View {
        List {
            Section("当前目标目录") {
                Label(folder.name, systemImage: "folder")
                    .font(.headline)
                Button(kind.confirmLabel) {
                    guard canUseTarget else { return }
                    onChoose(folder)
                }
                .disabled(!canUseTarget)
                .frame(minHeight: 44)
                .accessibilityIdentifier("native-ios-files-destination-confirm")
                if kind == .move && allSelected.contains(where: { $0.parent_id == folder.id }) {
                    Text("文件已在这个目录，不能重复移动。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if creating {
                    ProgressView("正在创建文件夹…")
                }
                if let createStatus {
                    Text(createStatus).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-files-destination-create-status")
                }
            }
            Section("子文件夹") {
                if busy {
                    ProgressView("正在验证目录…")
                } else if let failure {
                    Text(failure).foregroundStyle(.secondary)
                    Button("重试") { load() }
                } else if page != nil {
                    if canLoadPrevious {
                        Button("加载前面的文件夹") { requestAdjacent(.previous) }
                            .disabled(loadingAdjacent || creating)
                            .accessibilityIdentifier("native-ios-files-destination-load-previous")
                    }
                    ForEach(visibleNodes.filter(\.isDirectory)) { entry in
                        NavigationLink(value: XDriveIOSNativeFilesDestination(
                            id: entry.id, name: entry.name
                        )) {
                            Label(entry.name, systemImage: "folder.fill")
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .disabled(creating ||
                            allSelected.contains(where: { $0.isDirectory && $0.id == entry.id }))
                        .onAppear { requestNextIfAtEnd(of: entry.id) }
                    }
                    if !visibleNodes.contains(where: \.isDirectory) {
                        Text(totalCount == 0 ? "这里没有子文件夹" : "已加载范围没有子文件夹")
                            .foregroundStyle(.secondary)
                    }
                    if loadingAdjacent {
                        ProgressView("正在继续查找子文件夹…")
                    }
                    if let adjacentFailure {
                        Text(adjacentFailure).font(.footnote).foregroundStyle(.secondary)
                        Button("重试加载") {
                            let direction = failedDirection ?? .next
                            self.adjacentFailure = nil
                            self.failedDirection = nil
                            requestAdjacent(direction)
                        }
                        .disabled(loadingAdjacent || creating)
                    } else if canLoadNext {
                        // Sparse folders need explicit continuation; never scan
                        // a large file-only directory in an unbounded loop.
                        Button("继续查找子文件夹") { requestAdjacent(.next) }
                            .disabled(loadingAdjacent || creating)
                            .accessibilityIdentifier("native-ios-files-destination-load-next")
                    }
                    if totalCount > 0 {
                        Text("已读取 \(startOffset + visibleNodes.count) / \(totalCount) 项")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("尚未验证当前目录").foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: XDriveIOSNativeFilesDestination.self) { target in
            XDriveIOSNativeFilesDestinationPage(
                login: login, originalOwner: originalOwner,
                folder: target, selected: selected, selectedItems: selectedItems,
                kind: kind, onChoose: onChoose, onCreated: onCreated
            )
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        folderDraft = ""
                        createStatus = nil
                        showingCreate = true
                    } label: {
                        Label("新建文件夹", systemImage: "folder.badge.plus")
                    }
                    .disabled(!canCreateFolder)
                    .accessibilityIdentifier("native-ios-files-destination-create")
                    Button { load() } label: {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }
                    .disabled(busy || creating)
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
            }
        }
        .alert("新建文件夹", isPresented: $showingCreate) {
            TextField("文件夹名称", text: $folderDraft)
            Button("创建") { createFolder() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("在当前目标目录新建文件夹；创建后进入新目录，再选择复制或移动。")
        }
        .onAppear { load() }
        .onDisappear { invalidate() }
        .onChange(of: login.owner) { _ in invalidate() }
    }

    /// Do not reuse an unverified folder or issue a copy/move automatically:
    /// navigate to the created ID only after the actual Server 201 receipt,
    /// and let the next page verify its children before enabling confirmation.
    private func createFolder() {
        guard canCreateFolder else { return }
        guard let name = XDriveIOSNativeFilesFolderNamePolicy.normalized(folderDraft) else {
            createStatus = "文件夹名称不符合规范，请修改后重试。"
            return
        }

        let ticket = UUID()
        creationEpoch = ticket
        creating = true
        createStatus = nil
        creationTask = Task { @MainActor in
            defer {
                if creationEpoch == ticket {
                    creating = false
                    creationTask = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard creationEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, originalOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }

                let createdID = try await XDriveIOSNativeFilesDirectoryCreator(
                    owner: auth.owner, accessToken: auth.accessToken
                ).create(parentID: folder.id, name: name)
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard creationEpoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, originalOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }
                onCreated(XDriveIOSNativeFilesDestination(id: createdID, name: name))
            } catch is CancellationError {
                if creationEpoch == ticket {
                    createStatus = "创建可能已提交，请先刷新目录核对，不要重复提交。"
                }
            } catch {
                guard creationEpoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesCreateError {
                    switch failure {
                    case .server(409):
                        createStatus = "同名文件夹已存在，请更换名称。"
                    case .server(401), .server(403), .server(404), .invalidOwner:
                        createStatus = "账户或目录已变化，无法确认创建。"
                    default:
                        createStatus = "创建结果未确认，请先刷新目录核对，勿盲目重试。"
                    }
                } else {
                    createStatus = "创建结果未确认，请先刷新目录核对，勿盲目重试。"
                }
            }
        }
    }

    private func invalidate() {
        epoch = UUID()
        work?.cancel()
        work = nil
        adjacentTicket = UUID()
        adjacentWork?.cancel()
        adjacentWork = nil
        loadingAdjacent = false
        adjacentFailure = nil
        failedDirection = nil
        lastAutoRequestedFolderID = nil
        visibleNodes = []
        startOffset = 0
        totalCount = 0
        creationEpoch = UUID()
        creationTask?.cancel()
        creationTask = nil
        showingCreate = false
        creating = false
        createStatus = nil
        page = nil
        busy = false
        failure = nil
    }

    /// Prefetch one next Range when the last visible folder appears.
    /// File-only Ranges never trigger recursive automatic scans.
    private func requestNextIfAtEnd(of id: UInt64) {
        guard !busy, !loadingAdjacent, !creating, canLoadNext,
              visibleNodes.last(where: { $0.isDirectory })?.id == id,
              lastAutoRequestedFolderID != id else { return }
        lastAutoRequestedFolderID = id
        requestAdjacent(.next)
    }

    /// Keep at most four contiguous, verified 64-node Server Ranges.
    private func requestAdjacent(
        _ direction: XDriveIOSNativeFilesContinuousWindowPolicy.Direction
    ) {
        guard !busy, !creating, !loadingAdjacent, adjacentFailure == nil,
              page != nil, failure == nil,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
        else { return }
        let oldNodes = visibleNodes
        let oldIDs = oldNodes.map(\.id)
        let oldStart = startOffset
        let oldTotal = totalCount
        guard let requestedOffset = XDriveIOSNativeFilesContinuousWindowPolicy.requestedOffset(
            direction: direction, startOffset: oldStart,
            loadedCount: oldNodes.count, total: oldTotal
        ) else { return }

        let ticket = UUID()
        adjacentTicket = ticket
        let parentTicket = epoch
        loadingAdjacent = true
        failedDirection = nil
        adjacentWork = Task { @MainActor in
            defer {
                if epoch == parentTicket && adjacentTicket == ticket {
                    loadingAdjacent = false
                    adjacentWork = nil
                }
            }
            do {
                let credentials = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == parentTicket, adjacentTicket == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        credentials.owner, originalOwner
                      ), XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, originalOwner
                      ) else { return }
                let reader = XDriveIOSNativeFilesReader(
                    owner: credentials.owner, accessToken: credentials.accessToken
                )
                let response = try await reader.children(
                    parentID: folder.id, offset: requestedOffset, sort: "name", order: "asc"
                )
                try Task.checkCancellation()
                guard epoch == parentTicket, adjacentTicket == ticket,
                      startOffset == oldStart, totalCount == oldTotal,
                      visibleNodes.map(\.id) == oldIDs,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }
                guard let plan = XDriveIOSNativeFilesContinuousWindowPolicy.mergePlan(
                    direction: direction, startOffset: oldStart,
                    currentIDs: oldIDs, incomingIDs: response.items.map(\.id),
                    pageOffset: response.offset, total: oldTotal,
                    returnedTotal: response.total_count
                ) else {
                    adjacentFailure = "目录内容发生变化，请刷新后重新选择目标。"
                    failedDirection = direction
                    return
                }
                var merged = direction == .next
                    ? oldNodes + response.items : response.items + oldNodes
                if plan.dropFromFront > 0 { merged.removeFirst(plan.dropFromFront) }
                if plan.dropFromBack > 0 { merged.removeLast(plan.dropFromBack) }
                visibleNodes = merged
                startOffset = plan.startOffset
                offset = plan.startOffset
                page = response
                adjacentFailure = nil
            } catch is CancellationError {
                // Owner changes and navigation retire obsolete reads.
            } catch {
                guard epoch == parentTicket, adjacentTicket == ticket else { return }
                adjacentFailure = "无法继续验证子文件夹，请重试或刷新当前目录。"
                failedDirection = direction
            }
        }
    }

    private func load() {
        invalidate()
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner) else {
            failure = "当前账户已变化，请关闭后重新选择目标目录。"
            return
        }
        let ticket = epoch
        busy = true
        work = Task { @MainActor in
            defer { if epoch == ticket { busy = false; work = nil } }
            do {
                let credentials = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        credentials.owner, originalOwner
                      ), XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, originalOwner
                      ) else { return }
                let reader = XDriveIOSNativeFilesReader(
                    owner: credentials.owner, accessToken: credentials.accessToken
                )
                let response = try await reader.children(
                    parentID: folder.id, offset: offset, sort: "name", order: "asc"
                )
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, originalOwner)
                else { return }
                page = response
                visibleNodes = response.items
                startOffset = response.offset
                totalCount = response.total_count
            } catch is CancellationError {
            } catch {
                guard epoch == ticket else { return }
                page = nil
                failure = "无法验证目标目录或其权限，请返回上一层或重试。"
            }
        }
    }
}
