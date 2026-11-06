import Combine
import Foundation

/// One authorized directory projection. Up to four branches are retained,
/// each holding at most the same four 64-node windows as the regular Browser.
struct XDriveIOSNativeFilesInlineBranch {
    let folder: XDriveIOSNativeFilesNode
    let owner: XDriveNativeOwnerRoot
    var entries: [XDriveIOSNativeFilesNode] = []
    var startOffset = 0
    var total = 0
    var loading = true
    var loadingAdjacent = false
    var verified = false
    var error: String?
}

/// Flattening belongs to the bounded data model, not to recursive
/// SwiftUI generic View builders. Each row has a stable immutable identity.
struct XDriveIOSNativeFilesInlineDisplayRow: Identifiable {
    let id: String
    let node: XDriveIOSNativeFilesNode?
    let folderID: UInt64
    let depth: Int
    let message: String?
    let retryable: Bool
}

@MainActor
final class XDriveIOSNativeFilesInlineFolderStore: ObservableObject {
    static let maximumExpandedFolders = XDriveIOSNativeFilesInlinePolicy.maximumBranches
    static let maximumInlineDepth = XDriveIOSNativeFilesInlinePolicy.maximumDepth

    @Published private(set) var branches: [UInt64: XDriveIOSNativeFilesInlineBranch] = [:]
    @Published private(set) var status: String?

    private var jobs: [UInt64: Task<Void, Never>] = [:]
    private var tickets: [UInt64: UUID] = [:]

    func branch(for folder: XDriveIOSNativeFilesNode,
                owner: XDriveNativeOwnerRoot?) -> XDriveIOSNativeFilesInlineBranch? {
        guard let owner, let branch = branches[folder.id],
              branch.folder == folder,
              XDriveIOSNativePhotoOwnerScope.matches(owner, branch.owner)
        else { return nil }
        return branch
    }

    /// A row may be disclosed only when each expanded ancestor still belongs
    /// to this exact Owner; roots and nonexpanded ancestors add no depth.
    private func expandedDepth(for folder: XDriveIOSNativeFilesNode,
                               owner: XDriveNativeOwnerRoot) -> Int {
        var depth = 1
        var parentID = folder.parent_id
        var visited = Set<UInt64>()
        while let id = parentID, !visited.contains(id),
              let parent = branches[id],
              XDriveIOSNativePhotoOwnerScope.matches(owner, parent.owner) {
            visited.insert(id)
            depth += 1
            if depth > Self.maximumInlineDepth { return depth }
            parentID = parent.folder.parent_id
        }
        return depth
    }

    func allowsDisclosure(_ folder: XDriveIOSNativeFilesNode,
                          owner: XDriveNativeOwnerRoot?) -> Bool {
        guard let owner, XDriveIOSNativeFilesInlinePolicy.validParent(folder)
        else { return false }
        return expandedDepth(for: folder, owner: owner) <= Self.maximumInlineDepth
    }

    func containsVerified(_ node: XDriveIOSNativeFilesNode,
                          owner: XDriveNativeOwnerRoot?) -> Bool {
        guard let owner else { return false }
        return branches.values.contains { branch in
            branch.verified &&
                XDriveIOSNativePhotoOwnerScope.matches(owner, branch.owner) &&
                branch.entries.contains(node)
        }
    }

    /// At most 4 branches x 256 cached rows. Nested expansion is bounded
    /// to three levels; no child page is synthesized from folder names.
    func visibleRows(for root: XDriveIOSNativeFilesNode,
                     owner: XDriveNativeOwnerRoot?) -> [XDriveIOSNativeFilesInlineDisplayRow] {
        guard let owner, root.isDirectory else { return [] }
        var output: [XDriveIOSNativeFilesInlineDisplayRow] = []
        func collect(_ folder: XDriveIOSNativeFilesNode, depth: Int) {
            guard depth <= Self.maximumInlineDepth,
                  let branch = branch(for: folder, owner: owner) else { return }
            if branch.loading && branch.entries.isEmpty {
                output.append(.init(id: "loading-\(folder.id)", node: nil,
                                    folderID: folder.id, depth: depth,
                                    message: "正在展开文件夹…", retryable: false))
            }
            if let error = branch.error {
                output.append(.init(id: "error-\(folder.id)", node: nil,
                                    folderID: folder.id, depth: depth,
                                    message: error, retryable: true))
            }
            if branch.verified && branch.total == 0 {
                output.append(.init(id: "empty-\(folder.id)", node: nil,
                                    folderID: folder.id, depth: depth,
                                    message: "空文件夹", retryable: false))
            }
            for node in branch.entries {
                output.append(.init(id: "node-\(node.id)", node: node,
                                    folderID: folder.id, depth: depth,
                                    message: nil, retryable: false))
                if node.isDirectory && depth < Self.maximumInlineDepth {
                    collect(node, depth: depth + 1)
                }
            }
            if branch.loadingAdjacent {
                output.append(.init(id: "next-\(folder.id)", node: nil,
                                    folderID: folder.id, depth: depth,
                                    message: "正在继续加载文件夹…", retryable: false))
            }
        }
        collect(root, depth: 1)
        return output
    }

    func siblings(of node: XDriveIOSNativeFilesNode,
                  owner: XDriveNativeOwnerRoot?) -> [XDriveIOSNativeFilesNode]? {
        guard let owner, node.parent_id != nil else { return nil }
        return branches.values.first { branch in
            branch.verified && branch.folder.id == node.parent_id &&
                XDriveIOSNativePhotoOwnerScope.matches(owner, branch.owner) &&
                branch.entries.contains(node)
        }?.entries
    }

    func invalidate() {
        for job in jobs.values { job.cancel() }
        jobs = [:]
        tickets = [:]
        branches = [:]
        status = nil
    }

    /// The parent NavigationLink must retain its source row on push. Stop
    /// obsolete I/O without dropping already Owner-verified child rows.
    func suspendForNavigation() {
        for job in jobs.values { job.cancel() }
        jobs = [:]
        tickets = [:]
        for key in Array(branches.keys) {
            guard var branch = branches[key] else { continue }
            if branch.loading && !branch.verified {
                branch.error = "展开读取已取消，请重新展开。"
            }
            branch.loading = false
            branch.loadingAdjacent = false
            branches[key] = branch
        }
    }

    private func removeSubtree(_ rootID: UInt64, keepingRoot: Bool = false) {
        var removed: Set<UInt64> = [rootID]
        var changed = true
        while changed {
            changed = false
            for (id, branch) in branches where
                !removed.contains(id) && branch.folder.parent_id.map(removed.contains) == true {
                removed.insert(id)
                changed = true
            }
        }
        for id in removed where !(keepingRoot && id == rootID) {
            jobs[id]?.cancel()
            jobs.removeValue(forKey: id)
            tickets.removeValue(forKey: id)
            branches.removeValue(forKey: id)
        }
    }

    func toggle(_ folder: XDriveIOSNativeFilesNode,
                login: XDriveIOSNativeOwnerLoginModel) {
        guard XDriveIOSNativeFilesInlinePolicy.validParent(folder),
              let owner = login.owner else { return }
        status = nil
        if branches[folder.id] != nil {
            removeSubtree(folder.id)
            return
        }
        let depth = expandedDepth(for: folder, owner: owner)
        guard depth <= Self.maximumInlineDepth else {
            status = "原地展开最多支持 3 级；仍可点击名称进入文件夹。"
            return
        }
        guard XDriveIOSNativeFilesInlinePolicy.canExpand(
            activeBranches: branches.count, depth: depth
        ) else {
            status = "同时最多展开 4 个文件夹，请先收起一个。"
            return
        }
        branches[folder.id] = XDriveIOSNativeFilesInlineBranch(
            folder: folder, owner: owner
        )
        loadFirst(folder.id, login: login)
    }

    func retry(_ folderID: UInt64, login: XDriveIOSNativeOwnerLoginModel) {
        guard var branch = branches[folderID],
              !branch.loading && !branch.loadingAdjacent,
              let owner = login.owner,
              XDriveIOSNativePhotoOwnerScope.matches(owner, branch.owner) else { return }
        // A retried parent may now contain different children. Never keep
        // previously authorized descendant rows after the parent refresh.
        removeSubtree(folderID, keepingRoot: true)
        branch.error = nil
        branch.entries = []
        branch.total = 0
        branch.startOffset = 0
        branch.verified = false
        branch.loading = true
        branches[folderID] = branch
        loadFirst(folderID, login: login)
    }

    private func loadFirst(_ folderID: UInt64,
                           login: XDriveIOSNativeOwnerLoginModel) {
        guard var branch = branches[folderID], branch.loading,
              let expected = login.owner,
              XDriveIOSNativePhotoOwnerScope.matches(expected, branch.owner) else { return }
        let ticket = UUID()
        tickets[folderID] = ticket
        let folder = branch.folder
        branch.error = nil
        branches[folderID] = branch
        jobs[folderID] = Task { @MainActor [weak self] in
            defer {
                if let self, self.tickets[folderID] == ticket {
                    self.jobs.removeValue(forKey: folderID)
                    if var current = self.branches[folderID] {
                        current.loading = false
                        self.branches[folderID] = current
                    }
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { return }
                let page = try await XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).children(parentID: folderID, offset: 0, sort: "name", order: "asc")
                try Task.checkCancellation()
                guard let self, self.tickets[folderID] == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      var current = self.branches[folderID],
                      current.folder == folder else { return }
                guard XDriveIOSNativeFilesInlinePolicy.validWindow(
                    page.items, parentID: folderID, startOffset: 0,
                    total: page.total_count
                ) else { throw XDriveIOSNativeFilesInlineError.invalidRange }
                current.entries = page.items
                current.total = page.total_count
                current.startOffset = 0
                current.loading = false
                current.verified = true
                current.error = nil
                self.branches[folderID] = current
            } catch is CancellationError {
            } catch {
                guard let self, self.tickets[folderID] == ticket,
                      var current = self.branches[folderID] else { return }
                current.loading = false
                current.verified = false
                current.error = "无法验证此文件夹内容，请重试展开。"
                self.branches[folderID] = current
            }
        }
    }

    /// Each branch loads a single neighboring 64-row Server range on
    /// approach to the front/back edge. Both directions retain a 256-row cap.
    func loadNeighborIfNeeded(folderID: UInt64, visibleNodeID: UInt64,
                              login: XDriveIOSNativeOwnerLoginModel) {
        guard var branch = branches[folderID],
              branch.verified && !branch.loading && !branch.loadingAdjacent,
              branch.error == nil, let expected = login.owner,
              XDriveIOSNativePhotoOwnerScope.matches(expected, branch.owner),
              let visibleIndex = branch.entries.firstIndex(where: {
                $0.id == visibleNodeID
              }) else { return }
        let direction: XDriveIOSNativeFilesContinuousWindowPolicy.Direction
        if visibleIndex >= branch.entries.count - 8 {
            direction = .next
        } else if visibleIndex < 8 {
            direction = .previous
        } else {
            return
        }
        guard let nextOffset = XDriveIOSNativeFilesContinuousWindowPolicy.requestedOffset(
            direction: direction, startOffset: branch.startOffset,
            loadedCount: branch.entries.count, total: branch.total
        ) else { return }
        let oldIDs = branch.entries.map(\.id)
        let oldOffset = branch.startOffset
        let oldTotal = branch.total
        let ticket = UUID()
        tickets[folderID] = ticket
        branch.loadingAdjacent = true
        branches[folderID] = branch
        jobs[folderID] = Task { @MainActor [weak self] in
            defer {
                if let self, self.tickets[folderID] == ticket {
                    self.jobs.removeValue(forKey: folderID)
                    if var current = self.branches[folderID] {
                        current.loadingAdjacent = false
                        self.branches[folderID] = current
                    }
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { return }
                let page = try await XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).children(parentID: folderID, offset: nextOffset,
                           sort: "name", order: "asc")
                try Task.checkCancellation()
                guard let self, self.tickets[folderID] == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      var current = self.branches[folderID],
                      current.entries.map(\.id) == oldIDs,
                      current.startOffset == oldOffset,
                      current.total == oldTotal else { return }
                guard let plan = XDriveIOSNativeFilesContinuousWindowPolicy.mergePlan(
                    direction: direction, startOffset: oldOffset,
                    currentIDs: oldIDs, incomingIDs: page.items.map(\.id),
                    pageOffset: page.offset, total: oldTotal,
                    returnedTotal: page.total_count
                ) else { throw XDriveIOSNativeFilesInlineError.invalidRange }
                var updated = direction == .next
                    ? current.entries + page.items : page.items + current.entries
                if plan.dropFromFront > 0 {
                    updated.removeFirst(plan.dropFromFront)
                }
                if plan.dropFromBack > 0 {
                    updated.removeLast(plan.dropFromBack)
                }
                guard XDriveIOSNativeFilesInlinePolicy.validWindow(
                    updated, parentID: folderID, startOffset: plan.startOffset,
                    total: page.total_count
                ) else { throw XDriveIOSNativeFilesInlineError.invalidRange }
                current.entries = updated
                current.startOffset = plan.startOffset
                current.loadingAdjacent = false
                current.error = nil
                self.branches[folderID] = current
            } catch is CancellationError {
            } catch {
                guard let self, self.tickets[folderID] == ticket,
                      var current = self.branches[folderID] else { return }
                current.loadingAdjacent = false
                current.error = "文件夹内容已变化或加载失败，请收起后重试。"
                self.branches[folderID] = current
            }
        }
    }
}

private enum XDriveIOSNativeFilesInlineError: Error {
    case invalidRange
}
