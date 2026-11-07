import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesReadError: Error {
    case invalidScope
    case invalidPage
    case server(Int)
    case malformed
}

private final class XDriveIOSNativeFilesRejectRedirects: XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Read-only use of the existing Server Node and Search endpoints. Each page
/// uses a short-lived, in-memory native Owner bearer; no alternate writer,
/// WebView cookie or implicit File Provider rights are introduced.
struct XDriveIOSNativeFilesReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    // Owner identity stays in the per-request bearer. The shared ephemeral
    // transport never stores cookies or file data and refuses redirects.
    private static let client: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 25
        return URLSession(configuration: configuration,
                          delegate: XDriveIOSNativeFilesRejectRedirects(),
                          delegateQueue: nil)
    }()

    private func endpoint(_ path: String, query: [URLQueryItem]) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin, path.hasPrefix("/api/v1/"),
              !path.contains("?"), !path.contains("#"),
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesReadError.invalidScope
        }
        parts.path = path
        parts.queryItems = query
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesReadError.invalidScope
        }
        return url
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await Self.client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesReadError.malformed
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesReadError.server(http.statusCode)
        }
        guard data.count <= 2 * 1_048_576 else {
            throw XDriveIOSNativeFilesReadError.malformed
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// A single exact-name lookup for each path component. Server filtering
    /// avoids scanning 100k-directory pages or using unverified local names.
    func namedDirectory(parentID: UInt64, name: String) async throws
        -> XDriveIOSNativeFilesNode? {
        guard parentID > 0, !name.isEmpty, name.utf8.count <= 255 else {
            throw XDriveIOSNativeFilesReadError.invalidPage
        }
        // Server intentionally refuses name + offset. Use the cursor-page
        // response with an exact one-item name filter, just like Web/PWA.
        let url = try endpoint("/api/v1/nodes/\(parentID)/children", query: [
            URLQueryItem(name: "limit", value: "1"),
            URLQueryItem(name: "sort", value: "name"),
            URLQueryItem(name: "order", value: "asc"),
            URLQueryItem(name: "name", value: name)
        ])
        let page: XDriveIOSNativeFilesNamedPage = try await get(url)
        guard XDriveIOSNativeFilesPathPolicy.validNamedChild(
            page, parentID: parentID, exactName: name
        ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        return page.items.first
    }

    func searchSources() async throws -> [XDriveIOSNativeFilesSearchSourceOption] {
        let url = try endpoint("/api/v1/sources", query: [])
        let items: [XDriveIOSNativeFilesSearchSourceOption] = try await get(url)
        guard XDriveIOSNativeFilesPagePolicy.validSearchSources(items) else {
            throw XDriveIOSNativeFilesReadError.malformed
        }
        return items
    }

    func searchTags() async throws -> [XDriveIOSNativeFilesSearchTagOption] {
        let url = try endpoint("/api/v1/file-tags", query: [])
        let items: [XDriveIOSNativeFilesSearchTagOption] = try await get(url)
        guard XDriveIOSNativeFilesPagePolicy.validSearchTags(items) else {
            throw XDriveIOSNativeFilesReadError.malformed
        }
        return items
    }

    func children(parentID: UInt64, offset: Int,
                  sort: String, order: String,
                  grouping: String = "none",
                  foldersFirst: Bool = true) async throws -> XDriveIOSNativeFilesRange {
        guard parentID > 0,
              XDriveIOSNativeFilesPagePolicy.validOffset(offset),
              XDriveIOSNativeFilesPagePolicy.validOrder(sort: sort, order: order),
              XDriveIOSNativeFilesGroupingPolicy.validGrouping(grouping)
        else { throw XDriveIOSNativeFilesReadError.invalidPage }
        var queryItems = [
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "limit", value: String(XDriveIOSNativeFilesPagePolicy.pageSize)),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order)
        ]
        if grouping != "none" {
            queryItems.append(URLQueryItem(name: "group", value: grouping))
        }
        if !foldersFirst {
            queryItems.append(URLQueryItem(name: "folders_first", value: "false"))
        }
        let url = try endpoint("/api/v1/nodes/\(parentID)/children", query: queryItems)
        let page: XDriveIOSNativeFilesRange = try await get(url)
        guard XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parentID, offset: offset, sort: sort, order: order
        ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        if grouping != "none" && offset == 0 {
            // Server omits an empty group array for a genuinely empty
            // directory. Nonempty directories must return authoritative
            // indexes; never infer them from the first 64 Nodes.
            let groups = page.groups ?? []
            guard (page.groups != nil || page.total_count == 0),
                  XDriveIOSNativeFilesGroupingPolicy.validIndexes(
                    groups, total: page.total_count
                  ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        }
        return page
    }

    /// A middle page carries no group indexes. Ask Go for exactly one
    /// authenticated first-page row, retaining the whole-folder index only.
    func groupIndexProbe(parentID: UInt64, sort: String, order: String,
                         grouping: String, foldersFirst: Bool) async throws
        -> (total: Int, indexes: [XDriveIOSNativeFilesGroupIndex]) {
        guard parentID > 0, grouping != "none",
              XDriveIOSNativeFilesGroupingPolicy.validGrouping(grouping),
              XDriveIOSNativeFilesPagePolicy.validOrder(
                sort: sort, order: order
              ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        let url = try endpoint("/api/v1/nodes/\(parentID)/children", query: [
            URLQueryItem(name: "offset", value: "0"),
            URLQueryItem(name: "limit", value: "1"),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order),
            URLQueryItem(name: "group", value: grouping),
            URLQueryItem(name: "folders_first", value: foldersFirst ? "true" : "false")
        ])
        let page: XDriveIOSNativeFilesRange = try await get(url)
        guard XDriveIOSNativeFilesGroupingPolicy.validFirstPageProbe(
            page, parentID: parentID, sort: sort, order: order
        ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        return (page.total_count, page.groups ?? [])
    }

    func search(_ query: String, offset: Int,
                sort: String, order: String,
                filters: XDriveIOSNativeFilesSearchFilterState) async throws -> XDriveIOSNativeFilesSearchRange {
        guard XDriveIOSNativeFilesPagePolicy.validSearchRequest(query: query, filters: filters),
              XDriveIOSNativeFilesPagePolicy.validOffset(offset),
              XDriveIOSNativeFilesPagePolicy.validOrder(sort: sort, order: order)
        else { throw XDriveIOSNativeFilesReadError.invalidPage }
        var queryItems = [
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "limit", value: String(XDriveIOSNativeFilesPagePolicy.pageSize)),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order)
        ]
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedQuery.isEmpty {
            queryItems.append(URLQueryItem(name: "q", value: trimmedQuery))
        }
        if filters.kind != "all" {
            queryItems.append(URLQueryItem(name: "kind", value: filters.kind))
        }
        if let modifiedFrom = filters.modifiedFrom {
            queryItems.append(URLQueryItem(name: "modified_from", value: modifiedFrom))
        }
        if let modifiedTo = filters.modifiedTo {
            queryItems.append(URLQueryItem(name: "modified_to", value: modifiedTo))
        }
        if let minSize = filters.minSize {
            queryItems.append(URLQueryItem(name: "min_size", value: String(minSize)))
        }
        if let maxSize = filters.maxSize {
            queryItems.append(URLQueryItem(name: "max_size", value: String(maxSize)))
        }
        if let sourceID = filters.sourceID {
            queryItems.append(URLQueryItem(name: "source_id", value: String(sourceID)))
        }
        if let tagID = filters.tagID {
            queryItems.append(URLQueryItem(name: "tag_id", value: String(tagID)))
        }
        let url = try endpoint("/api/v1/search", query: queryItems)
        let page: XDriveIOSNativeFilesSearchRange = try await get(url)
        guard XDriveIOSNativeFilesPagePolicy.validResults(
            page, offset: offset, sort: sort, order: order
        ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        return page
    }
}

private struct XDriveIOSNativeFilesEntry: Identifiable {
    let node: XDriveIOSNativeFilesNode
    let path: String?
    var id: UInt64 { node.id }
}

private struct XDriveIOSNativeFilesDropIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let original: XDriveIOSNativeFilesNode
    let destination: XDriveIOSNativeFilesNode
}

private struct XDriveIOSNativeFilesVisibleGroup: Identifiable {
    let id: String
    let heading: String?
    var entries: [XDriveIOSNativeFilesEntry]
}

@MainActor
private final class XDriveIOSNativeFilesPageModel: ObservableObject {
    @Published private(set) var entries: [XDriveIOSNativeFilesEntry] = []
    @Published private(set) var total = 0
    @Published private(set) var startOffset = 0
    @Published private(set) var loading = false
    @Published private(set) var slowLoading = false
    @Published private(set) var loadingAdjacent = false
    @Published private(set) var verifiedPage = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var adjacentError: String?
    @Published private(set) var groupIndexes: [XDriveIOSNativeFilesGroupIndex] = []

    private var epoch = UUID()
    private var adjacentTicket = UUID()
    private var job: Task<Void, Never>?
    private var feedbackJob: Task<Void, Never>?
    private var adjacentJob: Task<Void, Never>?
    // A restored navigation page may only reuse rows from the exact Owner
    // and directory/search scope that the Server previously verified.
    private var verifiedOwner: XDriveNativeOwnerRoot?
    private var verifiedFolderID: UInt64?
    private var verifiedQuery: String?
    private var verifiedFilters: XDriveIOSNativeFilesSearchFilterState?
    private var verifiedSort: String?
    private var verifiedOrder: String?
    private var verifiedGrouping: String?
    private var verifiedFoldersFirst: Bool?

    /// Real global group boundaries are supplied by Go, never inferred from
    /// only the current 256 SwiftUI rows.
    var visibleGroups: [XDriveIOSNativeFilesVisibleGroup] {
        guard !entries.isEmpty else { return [] }
        guard let grouping = verifiedGrouping, grouping != "none",
              !groupIndexes.isEmpty else {
            return [XDriveIOSNativeFilesVisibleGroup(
                id: "all", heading: nil, entries: entries
            )]
        }
        var result: [XDriveIOSNativeFilesVisibleGroup] = []
        for (index, entry) in entries.enumerated() {
            guard let g = XDriveIOSNativeFilesGroupingPolicy.group(
                at: startOffset + index, indexes: groupIndexes
            ) else { return [] }
            let key = g.key + ":" + String(g.start_index)
            if let last = result.indices.last, result[last].id == key {
                result[last].entries.append(entry)
            } else {
                let label = XDriveIOSNativeFilesGroupingPolicy.title(g, grouping: grouping)
                result.append(XDriveIOSNativeFilesVisibleGroup(
                    id: key, heading: label + " · " + String(g.item_count),
                    entries: [entry]
                ))
            }
        }
        return result
    }

    func canResume(owner: XDriveNativeOwnerRoot?, folderID: UInt64,
                   query: String, filters: XDriveIOSNativeFilesSearchFilterState,
                   sort: String, order: String,
                   grouping: String = "none", foldersFirst: Bool = true) -> Bool {
        guard let owner, let verifiedOwner else { return false }
        return XDriveIOSNativeFilesNavigationPolicy.canResume(
            verified: verifiedPage, loading: loading,
            sameOwner: XDriveIOSNativePhotoOwnerScope.matches(owner, verifiedOwner),
            sameFolder: verifiedFolderID == folderID,
            sameQuery: verifiedQuery == query, sameFilters: verifiedFilters == filters,
            sameSort: verifiedSort == sort, sameOrder: verifiedOrder == order
        ) && verifiedGrouping == grouping && verifiedFoldersFirst == foldersFirst
    }

    /// Removing NavigationLink source rows while a SwiftUI push is in
    /// progress can pop straight back to the parent directory. Cancel I/O,
    /// not the already authenticated visible rows or their identity.
    func suspendForNavigation() {
        epoch = UUID()
        job?.cancel()
        job = nil
        feedbackJob?.cancel()
        feedbackJob = nil
        slowLoading = false
        cancelAdjacent()
        loading = false
    }

    func cancelAdjacent() {
        adjacentTicket = UUID()
        adjacentJob?.cancel()
        adjacentJob = nil
        loadingAdjacent = false
    }

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        feedbackJob?.cancel()
        feedbackJob = nil
        slowLoading = false
        cancelAdjacent()
        verifiedOwner = nil
        verifiedFolderID = nil
        verifiedQuery = nil
        verifiedFilters = nil
        verifiedSort = nil
        verifiedOrder = nil
        verifiedGrouping = nil
        verifiedFoldersFirst = nil
        groupIndexes = []
        entries = []
        total = 0
        startOffset = 0
        verifiedPage = false
        loading = false
        errorMessage = nil
        adjacentError = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel, folderID: UInt64,
              offset: Int, query: String,
              filters: XDriveIOSNativeFilesSearchFilterState,
              sort: String, order: String,
              grouping: String = "none", foldersFirst: Bool = true) {
        let expectedOwner = login.owner
        // Retain a previously committed page while refreshing only the
        // presentation (sort/order/group) of the exact same Owner/directory
        // and search scope. Inputs remain disabled until the first verified
        // Server range commits. Never show rows from another Owner or query.
        let sameBrowseScope = expectedOwner.map { current in
            verifiedPage &&
                verifiedOwner.map {
                    XDriveIOSNativePhotoOwnerScope.matches($0, current)
                } == true &&
                verifiedFolderID == folderID && verifiedQuery == query &&
                verifiedFilters == filters
        } ?? false
        if sameBrowseScope {
            epoch = UUID()
            job?.cancel()
            job = nil
            feedbackJob?.cancel()
            feedbackJob = nil
            slowLoading = false
            cancelAdjacent()
            errorMessage = nil
            adjacentError = nil
            loading = false
        } else {
            invalidate()
        }
        guard let expected = expectedOwner else {
            errorMessage = "请先验证原生服务器账户。"
            return
        }
        let ticket = epoch
        loading = true
        // Quiet refresh: no transient busy row for fast responses.
        feedbackJob = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self,
                  self.epoch == ticket && self.loading else { return }
            self.slowLoading = true
        }
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.feedbackJob?.cancel()
                    self?.feedbackJob = nil
                    self?.slowLoading = false
                    self?.loading = false
                    self?.job = nil
                }
            }
            do {
                // Prove the same Owner/root on every directory/search read.
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesReadError.invalidScope
                }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let found: [XDriveIOSNativeFilesEntry]
                let count: Int
                var fetchedGroups: [XDriveIOSNativeFilesGroupIndex] = []
                if query.isEmpty && !filters.hasActiveFilters {
                    let page = try await reader.children(
                        parentID: folderID, offset: offset, sort: sort, order: order,
                        grouping: grouping, foldersFirst: foldersFirst
                    )
                    found = page.items.map { XDriveIOSNativeFilesEntry(node: $0, path: nil) }
                    count = page.total_count
                    if grouping != "none" {
                        if offset == 0 {
                            fetchedGroups = page.groups ?? []
                        } else {
                            let probe = try await reader.groupIndexProbe(
                                parentID: folderID, sort: sort, order: order,
                                grouping: grouping, foldersFirst: foldersFirst
                            )
                            guard probe.total == count else {
                                throw XDriveIOSNativeFilesReadError.invalidPage
                            }
                            fetchedGroups = probe.indexes
                        }
                    }
                } else {
                    let page = try await reader.search(
                        query, offset: offset, sort: sort, order: order, filters: filters
                    )
                    found = page.items.map {
                        XDriveIOSNativeFilesEntry(node: $0.node, path: $0.path)
                    }
                    count = page.total_count
                }
                try Task.checkCancellation()
                guard self?.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                // Publish grouping metadata before rows so one SwiftUI
                // transaction cannot briefly present a flat layout while a
                // grouped first Range is committed.
                self?.total = count
                self?.startOffset = offset
                self?.verifiedOwner = expected
                self?.verifiedFolderID = folderID
                self?.verifiedQuery = query
                self?.verifiedFilters = filters
                self?.verifiedSort = sort
                self?.verifiedOrder = order
                self?.verifiedGrouping = grouping
                self?.verifiedFoldersFirst = foldersFirst
                self?.groupIndexes = fetchedGroups
                self?.entries = found
                self?.verifiedPage = true
                self?.errorMessage = nil
            } catch is CancellationError {
                // Navigation, owner changes and refresh cancel obsolete reads.
            } catch {
                guard self?.epoch == ticket else { return }
                self?.entries = []
                self?.total = 0
                self?.startOffset = 0
                self?.verifiedPage = false
                if let failure = error as? XDriveIOSNativeFilesReadError {
                    switch failure {
                    case .server(401), .server(403), .server(404), .invalidScope:
                        self?.errorMessage = "账户、目录或文件访问权限已变化，已清除旧列表。"
                    case .server(429), .server(503):
                        self?.errorMessage = "服务器暂时繁忙，请重试当前页面。"
                    default:
                        self?.errorMessage = "无法验证云端文件列表，请刷新后重试。"
                    }
                } else {
                    self?.errorMessage = "文件读取失败，请检查网络后重试。"
                }
            }
        }
    }

    /// Load only one neighboring Server range. A four-range window keeps the
    /// view lazy, allows forward/backward finger scrolling, and never loads a
    /// 100k-node directory into memory.
    func loadAdjacent(_ direction: XDriveIOSNativeFilesContinuousWindowPolicy.Direction,
                      login: XDriveIOSNativeOwnerLoginModel, folderID: UInt64,
                      query: String, filters: XDriveIOSNativeFilesSearchFilterState,
                      sort: String, order: String,
                      grouping: String = "none", foldersFirst: Bool = true) {
        guard !loading, !loadingAdjacent, verifiedPage, adjacentError == nil,
              let expected = login.owner else { return }
        let oldEntries = entries
        let oldIDs = oldEntries.map(\.id)
        let oldStart = startOffset
        let oldTotal = total
        guard let requestOffset = XDriveIOSNativeFilesContinuousWindowPolicy.requestedOffset(
            direction: direction, startOffset: oldStart,
            loadedCount: oldEntries.count, total: oldTotal
        ) else { return }

        adjacentTicket = UUID()
        let ticket = adjacentTicket
        let pageTicket = epoch
        loadingAdjacent = true
        adjacentJob = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == pageTicket && self?.adjacentTicket == ticket {
                    self?.loadingAdjacent = false
                    self?.adjacentJob = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesReadError.invalidScope
                }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let found: [XDriveIOSNativeFilesEntry]
                let returnedTotal: Int
                let returnedOffset: Int
                var incomingGroupIndexes: [XDriveIOSNativeFilesGroupIndex]? = nil
                if query.isEmpty && !filters.hasActiveFilters {
                    let page = try await reader.children(
                        parentID: folderID, offset: requestOffset, sort: sort, order: order,
                        grouping: grouping, foldersFirst: foldersFirst
                    )
                    found = page.items.map { XDriveIOSNativeFilesEntry(node: $0, path: nil) }
                    returnedTotal = page.total_count
                    returnedOffset = page.offset
                    if grouping != "none" && requestOffset == 0 {
                        incomingGroupIndexes = page.groups
                    }
                } else {
                    let page = try await reader.search(
                        query, offset: requestOffset, sort: sort, order: order, filters: filters
                    )
                    found = page.items.map {
                        XDriveIOSNativeFilesEntry(node: $0.node, path: $0.path)
                    }
                    returnedTotal = page.total_count
                    returnedOffset = page.offset
                }
                try Task.checkCancellation()
                guard let self, self.epoch == pageTicket,
                      self.adjacentTicket == ticket,
                      self.startOffset == oldStart,
                      self.total == oldTotal,
                      self.entries.map(\.id) == oldIDs,
                      self.verifiedGrouping == grouping,
                      self.verifiedFoldersFirst == foldersFirst,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                if let incomingGroupIndexes,
                   incomingGroupIndexes != self.groupIndexes {
                    throw XDriveIOSNativeFilesReadError.invalidPage
                }
                guard let plan = XDriveIOSNativeFilesContinuousWindowPolicy.mergePlan(
                    direction: direction, startOffset: oldStart,
                    currentIDs: oldIDs, incomingIDs: found.map(\.id),
                    pageOffset: returnedOffset, total: oldTotal,
                    returnedTotal: returnedTotal
                ) else { throw XDriveIOSNativeFilesReadError.invalidPage }

                var updated = direction == .next
                    ? oldEntries + found : found + oldEntries
                if plan.dropFromFront > 0 {
                    updated.removeFirst(plan.dropFromFront)
                }
                if plan.dropFromBack > 0 {
                    updated.removeLast(plan.dropFromBack)
                }
                self.startOffset = plan.startOffset
                self.entries = updated
                self.adjacentError = nil
            } catch is CancellationError {
                // Never append cancelled or stale adjacent results.
            } catch {
                guard let self, self.epoch == pageTicket,
                      self.adjacentTicket == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesReadError {
                    switch failure {
                    case .server(401), .server(403), .server(404), .invalidScope:
                        self.entries = []
                        self.total = 0
                        self.verifiedPage = false
                        self.adjacentError = "文件访问权限已变化，请重新验证账户后刷新。"
                    case .invalidPage:
                        self.adjacentError = "文件列表在滚动期间发生变化，请刷新后继续。"
                    default:
                        self.adjacentError = "无法加载更多文件，请刷新当前目录重试。"
                    }
                } else {
                    self.adjacentError = "网络读取失败，请刷新当前目录重试。"
                }
            }
        }
    }
}

@MainActor
private final class XDriveIOSNativeFilesSearchOptionsModel: ObservableObject {
    @Published private(set) var sources: [XDriveIOSNativeFilesSearchSourceOption] = []
    @Published private(set) var tags: [XDriveIOSNativeFilesSearchTagOption] = []
    @Published private(set) var loading = false
    @Published private(set) var verified = false
    @Published private(set) var errorMessage: String?

    private var epoch = UUID()
    private var job: Task<Void, Never>?
    private var loadedOwner: XDriveNativeOwnerRoot?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        loadedOwner = nil
        sources = []
        tags = []
        loading = false
        verified = false
        errorMessage = nil
    }

    func belongs(to owner: XDriveNativeOwnerRoot?) -> Bool {
        guard let owner, let loadedOwner else { return false }
        return XDriveIOSNativePhotoOwnerScope.matches(owner, loadedOwner)
    }

    func matches(_ owner: XDriveNativeOwnerRoot?) -> Bool {
        verified && belongs(to: owner)
    }

    func load(login: XDriveIOSNativeOwnerLoginModel) {
        guard let expected = login.owner else {
            invalidate()
            return
        }
        if verified, let loadedOwner,
           XDriveIOSNativePhotoOwnerScope.matches(loadedOwner, expected) {
            return
        }
        if loading, let loadedOwner,
           XDriveIOSNativePhotoOwnerScope.matches(loadedOwner, expected) {
            return
        }

        invalidate()
        loadedOwner = expected
        let ticket = epoch
        loading = true
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.loading = false
                    self?.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesReadError.invalidScope
                }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                async let sourceRead = reader.searchSources()
                async let tagRead = reader.searchTags()
                let (loadedSources, loadedTags) = try await (sourceRead, tagRead)
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { return }
                self.sources = loadedSources
                self.tags = loadedTags
                self.verified = true
                self.errorMessage = nil
            } catch is CancellationError {
                // An owner switch or screen teardown invalidates both reads.
            } catch {
                guard let self, self.epoch == ticket else { return }
                self.sources = []
                self.tags = []
                self.verified = false
                self.errorMessage = "无法读取同步文件夹和标签筛选项，请检查网络后重试。"
            }
        }
    }
}

private struct XDriveIOSNativeFilesBatchDestinationIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let items: [XDriveIOSNativeFilesNode]
    let sourceParentID: UInt64
    let kind: XDriveIOSNativeFilesDestinationKind
}

private struct XDriveIOSNativeFilesLocateIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
}

private struct XDriveIOSNativeFilesManagementIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let file: XDriveIOSNativeFilesNode?
    let directory: XDriveIOSNativeFilesNode?
    let quickAction: XDriveIOSNativeFilesQuickAction?
}

private struct XDriveIOSNativeFilesVersionIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
}

private struct XDriveIOSNativeFilesBatchTagsIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let nodeIDs: [UInt64]
}

/// One exact Owner + revision captured when a row action is opened.
private struct XDriveIOSNativeFilesQuickIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
}

private struct XDriveIOSNativeFilesRowDestinationIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
    let kind: XDriveIOSNativeFilesDestinationKind
}

private struct XDriveIOSNativeFilesFolder: Hashable {
    let id: UInt64
    let name: String
}

/// iOS fixed Files tab: genuine native bounded Owner directory navigation
/// and whole-library search. File previews use the separate native L3 Viewer;
/// Owner-bound creation, transfers and mutations live in the native action sheet.
struct XDriveIOSNativeFilesBrowser: View {
    // Drag payload is process-local and carries no credential or file bytes.
    // The transfer writer independently re-reads Owner, Node and destination.
    private static let internalDragType = "com.lazyxu.xdrive.files.internal-node"
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeFilesPageModel()
    @StateObject private var inlineFolders = XDriveIOSNativeFilesInlineFolderStore()
    @StateObject private var favoriteShortcuts = XDriveIOSNativeFilesCollectionPageModel()
    @StateObject private var quickAccess = XDriveIOSNativeFilesQuickAccessModel.shared
    @AppStorage("xdrive.ios.files.home.quick-access-expanded.v1")
    private var quickAccessExpanded = true
    @AppStorage("xdrive.ios.files.home.favorites-expanded.v1")
    private var favoriteFoldersExpanded = true
    @StateObject private var searchOptions = XDriveIOSNativeFilesSearchOptionsModel()
    @State private var favoriteShortcutsOwner: XDriveNativeOwnerRoot?
    @StateObject private var batchTrash = XDriveIOSNativeFilesBatchTrashModel()
    @StateObject private var batchTarget = XDriveIOSNativeFilesBatchTargetModel()
    @StateObject private var batchExport = XDriveIOSNativeFilesBatchExportModel()
    // Row actions reuse the existing verified Server writers, not a second API.
    @StateObject private var quickMutation = XDriveIOSNativeFilesMutationModel()
    @StateObject private var quickDestinationWriter =
        XDriveIOSNativeFilesDestinationMutationModel()
    @StateObject private var quickFavorite = XDriveIOSNativeFilesFavoriteMutationModel()
    @State private var quickRenameIntent: XDriveIOSNativeFilesQuickIntent?
    @State private var quickTrashIntent: XDriveIOSNativeFilesQuickIntent?
    @State private var rowDestinationIntent: XDriveIOSNativeFilesRowDestinationIntent?
    @State private var quickRenameDraft = ""
    @State private var quickActionNotice: String?
    @Environment(\.xdriveNativeTransfers) private var transfers
    @ObservedObject private var clipboard = XDriveIOSNativeFilesClipboard.shared
    @State private var showingClipboardPasteConfirmation = false
    @State private var showingSavedSearches = false
    @State private var savedSearchOwner: XDriveNativeOwnerRoot?
    @State private var showingFileOperations = false
    @State private var fileOperationsOwner: XDriveNativeOwnerRoot?
    @State private var operationWasAccepted = false
    @State private var managementWriteConfirmed = false
    @State private var versionRestoreConfirmed = false
    @State private var showingPathPrompt = false
    @State private var pathDraft = ""
    @State private var pathBusy = false
    @State private var pathError: String?
    @State private var pathDestination: XDriveIOSNativeFilesFolder?
    @State private var pathTicket = UUID()
    @State private var pathTask: Task<Void, Never>?
    @State private var batchTagsIntent: XDriveIOSNativeFilesBatchTagsIntent?
    @State private var showingBatchShare = false
    @State private var batchDestinationIntent: XDriveIOSNativeFilesBatchDestinationIntent?
    @State private var selecting = false
    @State private var selectedIDs = Set<UInt64>()
    // At most 200 same-parent, revision-locked Nodes survive virtual-window
    // eviction. Every mutation is still verified by the existing Server.
    @State private var selectedSnapshots = [UInt64: XDriveIOSNativeFilesNode]()
    @State private var selectAllBusy = false
    @State private var selectAllNotice: String?
    @State private var selectAllEpoch = UUID()
    @State private var selectAllJob: Task<Void, Never>?
    @State private var showingBatchTrashConfirmation = false
    @State private var draggedNode: XDriveIOSNativeFilesNode?
    @State private var draggedOwner: XDriveNativeOwnerRoot?
    @State private var dragNonce: UUID?
    @State private var pendingDrop: XDriveIOSNativeFilesDropIntent?
    @State private var offset = 0
    @State private var queryDraft = ""
    @State private var activeQuery = ""
    @State private var searchFilters = XDriveIOSNativeFilesSearchFilterState()
    @State private var searchReturnOffset: Int?
    @State private var searchReturnNodeID: UInt64?
    @State private var lastAppearedNodeID: UInt64?
    @State private var pendingNavigationReturnNodeID: UInt64?
    @State private var sort = "name"
    @AppStorage("xdrive.ios.files.view-mode.v1") private var viewMode = "list"
    @State private var order = "asc"
    @State private var grouping = "none"
    @State private var foldersFirst = true
    @State private var searchError: String?
    @State private var selectedFile: XDriveIOSNativeFilesEntry?
    @State private var managementIntent: XDriveIOSNativeFilesManagementIntent?
    @State private var versionHistoryIntent: XDriveIOSNativeFilesVersionIntent?
    @State private var locateIntent: XDriveIOSNativeFilesLocateIntent?
    @State private var selectedOwner: XDriveNativeOwnerRoot?
    @State private var returnOwner: XDriveNativeOwnerRoot?
    @State private var lastViewedFile: XDriveIOSNativeFilesNode?
    @State private var didRestoreLocatedFile = false
    @State private var locatedFileNotice: String?
    private let folder: XDriveIOSNativeFilesFolder?
    private let focusedNode: XDriveIOSNativeFilesNode?

    init(login: XDriveIOSNativeOwnerLoginModel,
         initialOffset: Int = 0, focus: XDriveIOSNativeFilesNode? = nil) {
        self.login = login
        folder = nil
        focusedNode = focus
        _offset = State(initialValue: initialOffset)
    }

    private init(login: XDriveIOSNativeOwnerLoginModel,
                 folder: XDriveIOSNativeFilesFolder) {
        self.login = login
        self.folder = folder
        focusedNode = nil
    }

    /// Files-owned recent and search-result folder navigation.
    init(login: XDriveIOSNativeOwnerLoginModel, folderID: UInt64,
         folderName: String, initialOffset: Int = 0,
         focus: XDriveIOSNativeFilesNode? = nil) {
        self.login = login
        self.folder = XDriveIOSNativeFilesFolder(id: folderID, name: folderName)
        focusedNode = focus
        _offset = State(initialValue: initialOffset)
    }

    private var parentID: UInt64? {
        guard let owner = login.owner else { return nil }
        return folder?.id ?? owner.rootNodeID
    }

    private var isGlobalSearch: Bool {
        !activeQuery.isEmpty || searchFilters.hasActiveFilters
    }

    private var hasVerifiedSearchOptionsForOwner: Bool {
        searchOptions.matches(login.owner)
    }

    private var hasSearchOptionsStateForOwner: Bool {
        searchOptions.belongs(to: login.owner)
    }

    private var searchSourceFilterTitle: String {
        guard let id = searchFilters.sourceID else { return "同步文件夹" }
        return searchOptions.sources.first(where: { $0.id == id })?.name ?? "同步文件夹已筛选"
    }

    private var searchTagFilterTitle: String {
        guard let id = searchFilters.tagID else { return "标签" }
        return searchOptions.tags.first(where: { $0.id == id })?.name ?? "标签已筛选"
    }

    private var canSelectPage: Bool {
        !model.loading && !selectAllBusy && model.verifiedPage && !isGlobalSearch &&
            login.owner != nil && !model.entries.isEmpty &&
            !batchTrash.busy && !batchTarget.busy &&
            !batchExport.busy && batchExport.prepared.isEmpty
    }

    private var chosenItems: [XDriveIOSNativeFilesNode] {
        guard let parentID else { return [] }
        return XDriveIOSNativeFilesSelectionPolicy.validItems(
            snapshots: selectedSnapshots, selectedIDs: selectedIDs,
            parentID: parentID
        ) ?? []
    }

    private var canPasteHere: Bool {
        !isHome && !isGlobalSearch && !model.loading && model.verifiedPage &&
            !selecting && !batchTarget.busy && !batchTrash.busy &&
            clipboard.canPaste(to: parentID, owner: login.owner)
    }

    /// Native Files Browse starts at locations and shortcuts, not inside an
    /// arbitrary server directory. Enter the verified cloud root explicitly.
    private var isHome: Bool { folder == nil && !isGlobalSearch }

    /// Present only a few folders from the existing, bounded and
    /// Owner-verified Favorites projection. Never infer navigation IDs from
    /// a path or reuse another account's stale favorite directory.
    private var verifiedFavoriteFolders: [XDriveIOSNativeFilesCollectionItem] {
        guard isHome, favoriteShortcuts.verified,
              let expected = favoriteShortcutsOwner,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
            return []
        }
        return Array(favoriteShortcuts.items.filter {
            $0.node.isDirectory &&
                XDriveIOSNativeFilesCollectionsPolicy.validItem($0, kind: .favorites)
        }.prefix(8))
    }

    private func verifiedManagementParentName(
        for intent: XDriveIOSNativeFilesManagementIntent
    ) -> String? {
        guard let node = intent.file ?? intent.directory else {
            return folder?.id == intent.owner.rootNodeID ? nil : folder?.name
        }
        guard let nodeParent = node.parent_id else { return nil }
        if nodeParent == intent.owner.rootNodeID { return nil }
        if nodeParent == folder?.id { return folder?.name }
        // Inline and search results are not necessarily direct children
        // of the visible directory. Never mislabel the outer folder as
        // the selected Node's actual parent.
        return inlineFolders.verifiedParentName(for: node, owner: login.owner)
    }

    private func openHomeTag(_ tag: XDriveIOSNativeFilesSearchTagOption) {
        guard isHome, let owner = login.owner,
              searchOptions.matches(owner),
              searchOptions.tags.contains(where: { $0.id == tag.id })
        else { return }
        if searchReturnOffset == nil {
            searchReturnOffset = offset
            searchReturnNodeID = nil
        }
        queryDraft = ""
        activeQuery = ""
        var filters = XDriveIOSNativeFilesSearchFilterState()
        filters.tagID = tag.id
        // The existing filter-change path performs exactly one complete
        // Server all-files Range; no local page-only filtering.
        searchFilters = filters
    }

    @ViewBuilder private var filesHome: some View {
        Section("位置") {
            if let owner = login.owner {
                NavigationLink {
                    XDriveIOSNativeFilesBrowser(
                        login: login, folderID: owner.rootNodeID,
                        folderName: "xDrive 云端"
                    )
                } label: {
                    HStack(spacing: 12) {
                        Label("xDrive 云端", systemImage: "externaldrive")
                        Spacer()
                        Text(owner.origin.host ?? "云端")
                            .font(.caption).foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .accessibilityIdentifier("native-ios-files-open-root-location")
            } else {
                Label("请先登录 xDrive 服务器", systemImage: "externaldrive.badge.xmark")
                    .foregroundStyle(.secondary)
            }
            NavigationLink {
                XDriveIOSNativeFilesTrashScreen(login: login)
            } label: {
                Label("最近删除", systemImage: "trash")
            }
            .disabled(login.owner == nil || batchTrash.busy || batchTarget.busy)
            .accessibilityIdentifier("native-ios-files-open-trash")
        }
        Section("个人收藏") {
            DisclosureGroup("收藏夹和常用收藏", isExpanded: $favoriteFoldersExpanded) {
                NavigationLink {
                    XDriveIOSNativeFilesCollectionScreen(login: login, kind: .favorites)
                } label: {
                    Label("收藏夹", systemImage: "star")
                }
                .disabled(login.owner == nil || batchTrash.busy || batchTarget.busy)
                .accessibilityIdentifier("native-ios-files-open-favorites")
                ForEach(verifiedFavoriteFolders) { item in
                NavigationLink {
                    XDriveIOSNativeFilesBrowser(
                        login: login, folderID: item.node.id,
                        folderName: item.node.name
                    )
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.node.name).lineLimit(1)
                            Text(item.path)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                    }
                }
                .accessibilityIdentifier("native-ios-files-favorite-folder-\(item.id)")
            }
                if favoriteShortcuts.loading {
                    ProgressView("正在读取收藏文件夹…")
                } else if let error = favoriteShortcuts.error, login.owner != nil {
                    HStack {
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                        Spacer(minLength: 4)
                        Button("重试") { loadFavoriteShortcuts() }
                            .accessibilityIdentifier("native-ios-files-favorite-retry")
                    }
                }
            }
        }
        Section("快捷目录") {
            DisclosureGroup("固定的文件夹", isExpanded: $quickAccessExpanded) {
                if quickAccess.matches(login.owner) {
                    ForEach(quickAccess.items) { item in
                        HStack(spacing: 8) {
                            NavigationLink {
                                XDriveIOSNativeFilesBrowser(
                                    login: login, folderID: item.node.id,
                                    folderName: item.node.name
                                )
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Label(item.node.name, systemImage: "pin.fill")
                                        .lineLimit(1)
                                    Text(item.path)
                                        .font(.caption).foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .accessibilityIdentifier("native-ios-files-pinned-folder-\(item.id)")
                            Menu {
                                Button("上移") {
                                    reorderQuickAccess(item, delta: -1)
                                }
                                Button("下移") {
                                    reorderQuickAccess(item, delta: 1)
                                }
                                Button("取消固定", role: .destructive) {
                                    quickAccess.unpin(item.id, login: login)
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle")
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            .disabled(quickAccess.busy || quickAccess.loading)
                            .accessibilityIdentifier("native-ios-files-pinned-more-\(item.id)")
                        }
                    }
                    if quickAccess.items.isEmpty {
                        Text("还没有固定文件夹。打开云端目录，长按文件夹即可固定。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if quickAccess.loading {
                    ProgressView("正在验证快捷目录…")
                }
                if let status = quickAccess.status {
                    HStack {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                        Spacer(minLength: 2)
                        Button("重新读取") {
                            quickAccess.load(login: login, force: true)
                        }
                        .disabled(quickAccess.loading || quickAccess.busy)
                    }
                }
            }
        }
        Section("快捷访问") {
            NavigationLink {
                XDriveIOSNativeFilesCollectionScreen(login: login, kind: .recent)
            } label: {
                Label("最近使用", systemImage: "clock")
            }
            .disabled(login.owner == nil || batchTrash.busy || batchTarget.busy)
            .accessibilityIdentifier("native-ios-files-open-recent")
        }
        Section("标签") {
            Button {
                searchOptions.load(login: login)
            } label: {
                Label("浏览所有标签", systemImage: "tag")
            }
            .disabled(login.owner == nil || searchOptions.loading)
            .accessibilityIdentifier("native-ios-files-home-load-tags")
            if hasVerifiedSearchOptionsForOwner {
                ForEach(searchOptions.tags) { tag in
                    Button { openHomeTag(tag) } label: {
                        Label(tag.name, systemImage: "tag.fill")
                    }
                    .accessibilityIdentifier("native-ios-files-home-tag-\(tag.id)")
                }
                if searchOptions.tags.isEmpty {
                    Text("尚无标签。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else if searchOptions.loading && hasSearchOptionsStateForOwner {
                ProgressView("正在读取标签…")
            } else if hasSearchOptionsStateForOwner,
                      let error = searchOptions.errorMessage {
                HStack {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    Button("重试") { searchOptions.load(login: login) }
                }
            }
        }
        Section("整理") {
            Button { presentSavedSearches() } label: {
                Label("智能文件夹", systemImage: "folder.badge.gearshape")
            }
            .disabled(login.owner == nil)
            .accessibilityIdentifier("native-ios-files-open-saved-searches")
            Button { presentFileOperations() } label: {
                Label("操作历史及撤销", systemImage: "arrow.uturn.backward.circle")
            }
            .disabled(login.owner == nil)
            .accessibilityIdentifier("native-ios-files-open-operations")
        }
        if pathBusy || pathError != nil {
            Section {
                if pathBusy { ProgressView("正在验证目标文件夹…") }
                if let pathError { Text(pathError).foregroundStyle(.orange) }
            }
        }
    }

        @ViewBuilder private var filesHeader: some View {
        Section("全库筛选") {
            if isGlobalSearch {
                HStack {
                    Text(activeQuery.isEmpty ? "全库筛选结果" : "全库搜索：\(activeQuery)")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Button("清除") { clearSearch() }
                        .accessibilityIdentifier("native-ios-files-clear-search")
                }
            }
            if !selecting {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 18) {
                        Menu {
                            Picker("搜索类型", selection: $searchFilters.kind) {
                                Text("全部类型").tag("all")
                                Text("文件夹").tag("folder")
                                Text("全部文件").tag("file")
                                Text("图片").tag("image")
                                Text("视频").tag("video")
                                Text("音频").tag("audio")
                                Text("PDF").tag("pdf")
                                Text("文档").tag("document")
                                Text("表格").tag("spreadsheet")
                                Text("演示文稿").tag("presentation")
                                Text("压缩文件").tag("archive")
                                Text("代码").tag("code")
                                Text("文本").tag("text")
                                Text("其他文件").tag("other")
                            }
                        } label: {
                            Label(
                                "类型：\(XDriveIOSNativeFilesPagePolicy.searchKindLabel(searchFilters.kind))",
                                systemImage: "line.3.horizontal.decrease.circle"
                            )
                            .font(.subheadline)
                        }
                        .accessibilityIdentifier("native-ios-files-search-kind-filter")
                        Menu {
                            Button("不限时间") {
                                searchFilters.modifiedFrom = nil
                                searchFilters.modifiedTo = nil
                            }
                            Button("今天") { setSearchModifiedFrom(searchStartOfDay(daysAgo: 0)) }
                            Button("最近 7 天") { setSearchModifiedFrom(searchStartOfDay(daysAgo: 7)) }
                            Button("最近 30 天") { setSearchModifiedFrom(searchStartOfDay(daysAgo: 30)) }
                            Button("今年") { setSearchModifiedFrom(searchStartOfYear()) }
                        } label: {
                            Label(searchFilters.hasDateFilter ? "修改时间已筛选" : "修改时间",
                                  systemImage: "calendar")
                                .font(.subheadline)
                        }
                        .accessibilityIdentifier("native-ios-files-search-date-filter")
                        Menu {
                            Button("不限大小") {
                                searchFilters.minSize = nil
                                searchFilters.maxSize = nil
                            }
                            Button("小于 1 MiB") {
                                searchFilters.minSize = 0
                                searchFilters.maxSize = (1 << 20) - 1
                            }
                            Button("1–100 MiB") {
                                searchFilters.minSize = 1 << 20
                                searchFilters.maxSize = (100 << 20) - 1
                            }
                            Button("100 MiB–1 GiB") {
                                searchFilters.minSize = 100 << 20
                                searchFilters.maxSize = (1 << 30) - 1
                            }
                            Button("1 GiB 及以上") {
                                searchFilters.minSize = 1 << 30
                                searchFilters.maxSize = nil
                            }
                        } label: {
                            Label(searchFilters.hasSizeFilter ? "文件大小已筛选" : "文件大小",
                                  systemImage: "externaldrive")
                                .font(.subheadline)
                        }
                        .accessibilityIdentifier("native-ios-files-search-size-filter")
                        if (hasVerifiedSearchOptionsForOwner && !searchOptions.sources.isEmpty) ||
                            searchFilters.hasSourceFilter {
                            Menu {
                                Button("全部同步文件夹") { searchFilters.sourceID = nil }
                                if hasVerifiedSearchOptionsForOwner {
                                    ForEach(searchOptions.sources) { source in
                                        Button {
                                            searchFilters.sourceID = source.id
                                        } label: {
                                            if searchFilters.sourceID == source.id {
                                                Label(source.name, systemImage: "checkmark")
                                            } else {
                                                Text(source.name)
                                            }
                                        }
                                    }
                                }
                            } label: {
                                Label(searchSourceFilterTitle, systemImage: "folder")
                                    .font(.subheadline)
                            }
                            .accessibilityIdentifier("native-ios-files-search-source-filter")
                        }
                        if (hasVerifiedSearchOptionsForOwner && !searchOptions.tags.isEmpty) ||
                            searchFilters.hasTagFilter {
                            Menu {
                                Button("全部标签") { searchFilters.tagID = nil }
                                if hasVerifiedSearchOptionsForOwner {
                                    ForEach(searchOptions.tags) { tag in
                                        Button {
                                            searchFilters.tagID = tag.id
                                        } label: {
                                            if searchFilters.tagID == tag.id {
                                                Label(tag.name, systemImage: "checkmark")
                                            } else {
                                                Text(tag.name)
                                            }
                                        }
                                    }
                                }
                            } label: {
                                Label(searchTagFilterTitle, systemImage: "tag")
                                    .font(.subheadline)
                            }
                            .accessibilityIdentifier("native-ios-files-search-tag-filter")
                        }
                    }
                    .padding(.vertical, 4)
                }
                .disabled(login.owner == nil)
            }
            if !hasVerifiedSearchOptionsForOwner && !searchOptions.loading {
                Button("加载同步文件夹与标签筛选") {
                    searchOptions.load(login: login)
                }
                .accessibilityIdentifier("native-ios-files-load-advanced-filter-options")
                .disabled(login.owner == nil)
            }
            if searchOptions.loading && hasSearchOptionsStateForOwner {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("正在读取同步文件夹和标签…")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else if hasSearchOptionsStateForOwner, let error = searchOptions.errorMessage {
                HStack {
                    Text(error).font(.footnote).foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Button("重试") { searchOptions.load(login: login) }
                        .accessibilityIdentifier("native-ios-files-search-options-retry")
                }
            }
            if let searchError {
                Text(searchError).foregroundStyle(.orange).font(.footnote)
            }
            if let locatedFileNotice {
                Text(locatedFileNotice).foregroundStyle(.orange).font(.footnote)
            }
        }
    }

    @ViewBuilder private var filesLoadStatus: some View {
            if pathBusy {
                ProgressView("正在验证目标文件夹…")
                    .accessibilityIdentifier("native-ios-files-path-loading")
            }
            if let pathError {
                Text(pathError).foregroundStyle(.orange)
                    .accessibilityIdentifier("native-ios-files-path-error")
            }
            if model.loading && model.entries.isEmpty {
                if model.slowLoading {
                    HStack { ProgressView(); Text("正在读取当前页…") }
                        .accessibilityIdentifier("native-ios-files-cold-range-loading")
                } else {
                    // No transient spinner for a fast first page. Reserve a
                    // stable quiet slot while the initial read is pending.
                    Color.clear.frame(height: 44).accessibilityHidden(true)
                }
            } else if model.slowLoading && !model.entries.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("正在更新当前文件列表…").foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("native-ios-files-retained-range-loading")
            } else if let error = model.errorMessage {
                Text(error).foregroundStyle(.orange)
                Button("重试当前页") { reload() }
                    .accessibilityIdentifier("native-ios-files-retry")
            } else if model.entries.isEmpty {
                Label("当前目录或搜索结果为空。", systemImage: "folder")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 96)
            }
    }

    /// System long-press gesture starts a native drag. Never publish an
    /// external file or a bearer, and never accept a cross-app text drop.
    private func beginInternalDrag(_ entry: XDriveIOSNativeFilesEntry) -> NSItemProvider {
        let provider = NSItemProvider()
        guard !selecting, !isGlobalSearch, !model.loading,
              !batchTarget.busy, let owner = login.owner,
              containsVerifiedNode(entry.node),
              let sourceParent = entry.node.parent_id,
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                [entry.node], parentID: sourceParent
              ) else { return provider }
        let nonce = UUID()
        draggedNode = entry.node
        draggedOwner = owner
        dragNonce = nonce
        provider.registerDataRepresentation(
            forTypeIdentifier: Self.internalDragType, visibility: .ownProcess
        ) { completion in
            // The process-local payload ties this provider to exactly one
            // drag intent even if a later gesture replaces the UI snapshot.
            completion(Data(nonce.uuidString.utf8), nil)
            return nil
        }
        return provider
    }

    private func clearInternalDrag() {
        draggedNode = nil
        draggedOwner = nil
        dragNonce = nil
    }

    private func prepareInternalDrop(
        on destination: XDriveIOSNativeFilesNode, providers: [NSItemProvider]
    ) -> Bool {
        guard pendingDrop == nil, providers.count == 1,
              providers[0].hasItemConformingToTypeIdentifier(Self.internalDragType),
              destination.isDirectory, !selecting, !model.loading,
              !batchTarget.busy, let owner = login.owner,
              let startedOwner = draggedOwner, let original = draggedNode,
              let nonce = dragNonce,
              XDriveIOSNativePhotoOwnerScope.matches(owner, startedOwner),
              containsVerifiedNode(original), containsVerifiedNode(destination),
              let sourceParent = original.parent_id,
              XDriveIOSNativeFilesBatchTargetPolicy.validSelection(
                [original], sourceParentID: sourceParent,
                destinationID: destination.id, kind: .move
              ) else {
            clearInternalDrag()
            return false
        }
        // The payload is opaque and scoped to this process. Never infer the
        // dropped file from a global drag state without matching its nonce;
        // the system may deliver another gesture's provider out of order.
        providers[0].loadDataRepresentation(forTypeIdentifier: Self.internalDragType) {
            bytes, error in
            Task { @MainActor in
                guard error == nil, let bytes,
                      let received = String(data: bytes, encoding: .utf8),
                      received == nonce.uuidString, dragNonce == nonce,
                      draggedNode == original,
                      let current = login.owner,
                      XDriveIOSNativePhotoOwnerScope.matches(current, startedOwner),
                      containsVerifiedNode(original), containsVerifiedNode(destination),
                      !model.loading, !batchTarget.busy else {
                    if dragNonce == nonce { clearInternalDrag() }
                    return
                }
                pendingDrop = .init(owner: startedOwner, original: original,
                                    destination: destination)
                clearInternalDrag()
            }
        }
        return true
    }

    private func confirmInternalDrop() {
        guard let drop = pendingDrop else { return }
        pendingDrop = nil
        guard let owner = login.owner,
              XDriveIOSNativePhotoOwnerScope.matches(owner, drop.owner),
              containsVerifiedNode(drop.original),
              containsVerifiedNode(drop.destination),
              let sourceParent = drop.original.parent_id,
              XDriveIOSNativeFilesBatchTargetPolicy.validSelection(
                [drop.original], sourceParentID: sourceParent,
                destinationID: drop.destination.id, kind: .move
              ) else { return }
        batchTarget.perform(
            .move, items: [drop.original], sourceParentID: sourceParent,
            destination: XDriveIOSNativeFilesDestination(
                id: drop.destination.id, name: drop.destination.name
            ), login: login
        ) {
            reload(resetOffset: true)
        }
    }

    @ViewBuilder private func fileEntryRow(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        if selecting {
            Button { toggleSelection(entry) } label: {
                HStack(spacing: 12) {
                    Image(systemName: selectedIDs.contains(entry.id)
                          ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(Color.accentColor)
                    row(entry)
                }
            }
            .buttonStyle(.plain)
            .disabled(!canSelectPage)
            .accessibilityIdentifier("native-ios-files-select-\(entry.id)")
        } else if entry.node.isDirectory {
            // Disclosure is a sibling of NavigationLink: tapping the 44-pt
            // chevron expands in place; tapping the row still navigates into
            // the folder. A nested Button inside the Link caused misroutes.
            HStack(spacing: 0) {
                if !isGlobalSearch && viewMode == "list" &&
                   inlineFolders.allowsDisclosure(entry.node, owner: login.owner) {
                    Button {
                        toggleInline(entry)
                    } label: {
                        Image(systemName: inlineFolders.branch(
                            for: entry.node, owner: login.owner
                        ) == nil ? "chevron.right" : "chevron.down")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(inlineFolders.branch(
                        for: entry.node, owner: login.owner
                    ) == nil ? "展开 " + entry.node.name : "收起 " + entry.node.name)
                    .accessibilityIdentifier("native-ios-files-disclose-\(entry.node.id)")
                }
                NavigationLink(value: XDriveIOSNativeFilesFolder(
                    id: entry.node.id, name: entry.node.name
                )) {
                    row(entry)
                }
                .accessibilityIdentifier("native-ios-files-folder-\(entry.node.id)")
                .onDrag { beginInternalDrag(entry) }
            }
            .onDrop(of: [Self.internalDragType], isTargeted: nil) { providers in
                prepareInternalDrop(on: entry.node, providers: providers)
            }
            .contextMenu {
                nativeQuickActions(for: entry)
                Button {
                    openManagement(for: entry.node)
                } label: {
                    Label("显示简介", systemImage: "info.circle")
                }
                .accessibilityIdentifier("native-ios-files-folder-more-\(entry.node.id)")
                if isGlobalSearch {
                    Button {
                        requestLocation(for: entry)
                    } label: {
                        Label("显示位置", systemImage: "folder.badge.questionmark")
                    }
                    .accessibilityIdentifier("native-ios-files-locate-\(entry.id)")
                }
            }
            .id(entry.node.id)
        } else {
            Button { openViewer(entry) } label: { row(entry) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("native-ios-files-file-\(entry.node.id)")
                .onDrag { beginInternalDrag(entry) }
                .contextMenu {
                    nativeQuickActions(for: entry)
                    Button {
                        openManagement(for: entry.node)
                    } label: {
                        Label("显示简介", systemImage: "info.circle")
                    }
                    .accessibilityIdentifier("native-ios-files-more-\(entry.node.id)")
                    Button("版本历史") { openVersionHistory(for: entry.node) }
                    if !activeQuery.isEmpty {
                        Button {
                            requestLocation(for: entry)
                        } label: {
                            Label("显示位置", systemImage: "folder.badge.questionmark")
                        }
                        .accessibilityIdentifier("native-ios-files-locate-\(entry.id)")
                    }
                }
                .id(entry.node.id)
        }
    }

    private var filesContinuousStatus: some View {
        Section {
            if model.loadingAdjacent {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("正在继续加载文件…")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("native-ios-files-loading-adjacent")
            }
            if let message = model.adjacentError {
                Text(message).foregroundStyle(.orange)
                Button("刷新文件列表") { reload(resetOffset: true) }
                    .accessibilityIdentifier("native-ios-files-continuous-retry")
            }
        }
    }

    private func requestContinuousNeighbor(for visibleID: UInt64) {
        guard !selecting, selectedFile == nil, !model.loading,
              model.verifiedPage,
              let parentID, let index = model.entries.firstIndex(where: {
                  $0.id == visibleID
              }) else { return }
        // A row becoming visible is an approximate, bounded scroll anchor.
        // It remains valid even when an adjacent page fetch is in flight.
        lastAppearedNodeID = visibleID
        guard !model.loadingAdjacent else { return }
        let threshold = min(8, max(1, model.entries.count / 4))
        if index >= model.entries.count - threshold {
            model.loadAdjacent(
                .next, login: login, folderID: parentID,
                query: activeQuery, filters: searchFilters, sort: sort, order: order,
                grouping: grouping, foldersFirst: foldersFirst
            )
        } else if index < threshold {
            model.loadAdjacent(
                .previous, login: login, folderID: parentID,
                query: activeQuery, filters: searchFilters, sort: sort, order: order,
                grouping: grouping, foldersFirst: foldersFirst
            )
        }
    }

    @ViewBuilder private var filesBatchOperations: some View {
            if selecting {
                Section("批量操作") {
                    Text("已选 \(selectedIDs.count) 项（最多 200 项，可跨已加载窗口；服务器逐项复核）")
                        .font(.footnote).foregroundStyle(.secondary)
                    if selectAllBusy {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("正在读取完整目录选择范围…")
                            Button("取消全选读取") { cancelSelectAllRead() }
                                .accessibilityIdentifier("native-ios-files-select-all-cancel")
                        }
                        .accessibilityIdentifier("native-ios-files-select-all-loading")
                    }
                    if let selectAllNotice {
                        Text(selectAllNotice).font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-select-all-status")
                    }
                    if batchExport.busy {
                        ProgressView("正在顺序下载和核对文件…")
                        Button("取消批量下载", role: .cancel) {
                            batchExport.cancelCurrentTransfer()
                        }
                        .accessibilityIdentifier("native-ios-files-batch-export-cancel")
                    }
                    if !batchExport.prepared.isEmpty {
                        Button("用系统分享导出 \(batchExport.prepared.count) 个文件") {
                            showingBatchShare = true
                        }
                        .accessibilityIdentifier("native-ios-files-batch-export-share")
                        Button("删除临时下载文件") {
                            batchExport.invalidate()
                        }
                    }
                    if let status = batchExport.status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-batch-export-status")
                    }
                    if batchTrash.busy {
                        ProgressView("正在处理已选项目…")
                        Button("取消批量操作", role: .cancel) {
                            batchTrash.cancelCurrent()
                        }
                    }
                    if let status = batchTrash.status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-batch-status")
                    }
                    if batchTarget.busy {
                        ProgressView("服务器正在处理本页批量复制/移动…")
                        Button("取消批量复制/移动", role: .cancel) {
                            batchTarget.cancelCurrent()
                        }
                        .accessibilityIdentifier("native-ios-files-batch-target-cancel")
                    }
                    if let status = batchTarget.status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-batch-target-status")
                    }
                }
            }
    }

    /// Native Files-style edit bar, positioned above the five-module tab
    /// chrome by SwiftUI safe-area layout rather than a fixed global overlay.
    private var filesSelectionToolbar: some View {
        HStack(spacing: 12) {
            Text("已选 \(selectedIDs.count)")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("native-ios-files-selection-count")
            Spacer(minLength: 4)
            if !batchExport.prepared.isEmpty {
                Button {
                    showingBatchShare = true
                } label: {
                    Label("导出", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("native-ios-files-batch-share-toolbar")
                Button {
                    batchExport.invalidate()
                } label: {
                    Label("清理暂存", systemImage: "xmark.circle")
                }
                .accessibilityIdentifier("native-ios-files-batch-discard-toolbar")
            } else {
                Button {
                    openBatchDestination(.copy)
                } label: {
                    Label("复制", systemImage: "doc.on.doc")
                }
                .disabled(!canSelectPage || selectedIDs.isEmpty)
                .accessibilityIdentifier("native-ios-files-batch-copy")
                Button {
                    openBatchDestination(.move)
                } label: {
                    Label("移动", systemImage: "folder")
                }
                .disabled(!canSelectPage || selectedIDs.isEmpty)
                .accessibilityIdentifier("native-ios-files-batch-move")
                Menu {
                    Button("全选当前目录（最多 200 项）") {
                        selectAllCurrentFolder()
                    }
                    .disabled(!canSelectPage ||
                        model.total > XDriveIOSNativeFilesBatchTrashPolicy.maxSelected)
                    .accessibilityIdentifier("native-ios-files-select-all-server")
                    Button("选择已加载项目（最多 200 项）") {
                        guard canSelectPage else { return }
                        for entry in model.entries where !selectedIDs.contains(entry.id) {
                            if selectedIDs.count >= XDriveIOSNativeFilesBatchTrashPolicy.maxSelected {
                                break
                            }
                            selectedIDs.insert(entry.id)
                            selectedSnapshots[entry.id] = entry.node
                        }
                    }
                    .disabled(!canSelectPage)
                    Button("清空选择") {
                        selectedIDs.removeAll()
                        selectedSnapshots.removeAll()
                    }
                        .disabled(selectedIDs.isEmpty)
                    Divider()
                    Button("复制到剪贴板") { captureSelection(.copy) }
                        .disabled(!canSelectPage || selectedIDs.isEmpty)
                        .accessibilityIdentifier("native-ios-files-batch-clipboard-copy")
                    Button("剪切到剪贴板") { captureSelection(.move) }
                        .disabled(!canSelectPage || selectedIDs.isEmpty)
                        .accessibilityIdentifier("native-ios-files-batch-clipboard-cut")
                    Button("为已选项目设置标签") { openBatchTags() }
                        .disabled(!canSelectPage || selectedIDs.isEmpty)
                        .accessibilityIdentifier("native-ios-files-batch-tags")
                    Divider()
                    Button("已选项批量下载并导出") {
                        prepareSelectedExport()
                    }
                    .disabled(!canSelectPage || selectedIDs.isEmpty)
                    .accessibilityIdentifier("native-ios-files-batch-export")
                    Button("已选项移入回收站", role: .destructive) {
                        showingBatchTrashConfirmation = true
                    }
                    .disabled(!canSelectPage || selectedIDs.isEmpty)
                    .accessibilityIdentifier("native-ios-files-batch-trash")
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
                .disabled(!canSelectPage)
                .accessibilityIdentifier("native-ios-files-batch-more")
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 12)
        .frame(minHeight: 52)
        .background(.bar)
        .accessibilityIdentifier("native-ios-files-batch-toolbar")
    }

    private func prepareSelectedExport() {
        guard canSelectPage, let sourceParentID = parentID,
              selectedIDs == Set(chosenItems.map(\.id)),
              XDriveIOSNativeFilesBatchExportPolicy.validSelection(
                  chosenItems, parentID: sourceParentID
              ) else {
            batchExport.invalidSelection()
            return
        }
        batchExport.prepare(
            chosenItems, parentID: sourceParentID, login: login, transfers: transfers
        )
    }

    private func toggleInline(_ entry: XDriveIOSNativeFilesEntry) {
        guard !selecting, !isGlobalSearch, viewMode == "list",
              !model.loading, model.verifiedPage, login.owner != nil,
              entry.node.isDirectory,
              model.entries.contains(where: { $0.node == entry.node }) ||
                  inlineFolders.containsVerified(entry.node, owner: login.owner)
        else { return }
        inlineFolders.toggle(entry.node, login: login)
    }

    @ViewBuilder private func inlineBranchRows(
        for root: XDriveIOSNativeFilesNode
    ) -> some View {
        if !selecting && !isGlobalSearch && viewMode == "list" &&
           root.isDirectory {
            ForEach(inlineFolders.visibleRows(for: root, owner: login.owner)) { inline in
                if let node = inline.node {
                    fileEntryRow(XDriveIOSNativeFilesEntry(node: node, path: nil))
                        .padding(.leading, CGFloat(min(inline.depth, 3)) * 16)
                        .onAppear {
                            inlineFolders.loadNeighborIfNeeded(
                                folderID: inline.folderID,
                                visibleNodeID: node.id, login: login
                            )
                        }
                } else if inline.retryable {
                    HStack {
                        Text(inline.message ?? "子文件夹读取失败")
                            .foregroundStyle(.orange)
                        Spacer()
                        Button("重试展开") {
                            inlineFolders.retry(inline.folderID, login: login)
                        }
                    }
                    .padding(.leading, CGFloat(min(inline.depth, 3)) * 16)
                    .accessibilityIdentifier("native-ios-files-inline-retry")
                } else if inline.message == "空文件夹" {
                    Text("空文件夹")
                        .foregroundStyle(.secondary)
                        .padding(.leading, CGFloat(min(inline.depth, 3)) * 16)
                        .accessibilityIdentifier("native-ios-files-inline-empty")
                } else {
                    ProgressView(inline.message ?? "正在展开文件夹…")
                        .padding(.leading, CGFloat(min(inline.depth, 3)) * 16)
                        .accessibilityIdentifier("native-ios-files-inline-loading")
                }
            }
        }
    }

    /// One shared native action row for grouped and flat lists. Both paths
    /// must keep the same Server Owner/Node checks and confirmation dialogs.
    private func filesActionRow(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        fileEntryRow(entry)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if !selecting && model.verifiedPage && !model.loading {
                    Button {
                        openManagement(for: entry.node)
                    } label: {
                        Label("更多", systemImage: "ellipsis")
                    }
                    .tint(.gray)
                    Button {
                        openManagement(for: entry.node, quickAction: .shareLink)
                    } label: {
                        Label("分享链接", systemImage: "link")
                    }
                    .tint(.blue)
                    Button(role: .destructive) {
                        // The native sheet still asks for destructive confirmation.
                        openManagement(for: entry.node, quickAction: .trash)
                    } label: {
                        Label("删除", systemImage: "trash")
                    }
                }
            }
            .onAppear { requestContinuousNeighbor(for: entry.id) }
    }

    /// A grouped grid uses the very same entry surface as a flat grid.
    /// Server index groups remain outside this bounded 64–256 tile renderer.
    private func filesGrid(_ items: [XDriveIOSNativeFilesEntry]) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 128, maximum: 184), spacing: 10)],
            spacing: 10
        ) {
            ForEach(items) { entry in
                gridTile(entry)
                    .id(entry.id)
                    .onAppear { requestContinuousNeighbor(for: entry.id) }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .accessibilityIdentifier("native-ios-files-grid")
    }

    private var filesList: some View {
        List {
            filesHeader
            if isHome {
                filesHome
            } else {
                filesLoadStatus
                if let notice = inlineFolders.status {
                    Text(notice).foregroundStyle(.orange)
                        .accessibilityIdentifier("native-ios-files-inline-limit")
                }
                if viewMode == "grid" {
                    if grouping != "none" && !isGlobalSearch {
                        ForEach(model.visibleGroups) { group in
                            Section {
                                filesGrid(group.entries)
                            } header: {
                                if let heading = group.heading {
                                    Text(heading)
                                        .font(.subheadline.weight(.semibold))
                                        .accessibilityAddTraits(.isHeader)
                                }
                            }
                        }
                    } else {
                        filesGrid(model.entries)
                    }
                } else {
                    if grouping != "none" && !isGlobalSearch {
                        ForEach(model.visibleGroups) { group in
                            Section {
                                ForEach(group.entries) { entry in
                                    filesActionRow(entry)
                                    inlineBranchRows(for: entry.node)
                                }
                            } header: {
                                if let heading = group.heading {
                                    Text(heading)
                                        .font(.subheadline.weight(.semibold))
                                        .accessibilityAddTraits(.isHeader)
                                }
                            }
                        }
                    } else {
                        ForEach(model.entries) { entry in
                            filesActionRow(entry)
                            inlineBranchRows(for: entry.node)
                        }
                    }
                }
                filesContinuousStatus
                filesBatchOperations
            }
        }
    }

    /// Non-reflowing feedback shares one native location for progress,
    /// confirmed result and uncertain-operation errors.
    @ViewBuilder private var filesQuickFeedback: some View {
        let message = quickActionNotice ?? quickMutation.status ??
            quickDestinationWriter.status ?? quickFavorite.status
        if let message {
            HStack(spacing: 10) {
                if quickMutation.busy || quickDestinationWriter.busy || quickFavorite.busy {
                    ProgressView()
                }
                Text(message)
                    .font(.footnote)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.bottom, selecting ? 64 : 10)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("native-ios-files-quick-feedback")
        }
    }

    private var filesChrome: some View {
        filesList
        .listStyle(.plain)
        .overlay(alignment: .bottom) { filesQuickFeedback }
        .searchable(
            text: $queryDraft,
            placement: .navigationBarDrawer(displayMode: .automatic),
            prompt: "搜索全部文件"
        )
        .onSubmit(of: .search) { submitSearch() }
        .task(id: queryDraft) {
            // System Files-style progressive search, but only for a valid
            // Server query. Task identity cancels superseded keyboard drafts
            // before they can mutate the existing Owner-scoped search route.
            let query = queryDraft.trimmingCharacters(in: .whitespacesAndNewlines)
            guard XDriveIOSNativeFilesPagePolicy.validSearch(query),
                  query != activeQuery else { return }
            do {
                try await Task.sleep(nanoseconds: 400_000_000)
                try Task.checkCancellation()
            } catch {
                return
            }
            guard !Task.isCancelled, phase == .active,
                  login.owner != nil, !selecting,
                  selectedFile == nil, managementIntent == nil,
                  query == queryDraft.trimmingCharacters(in: .whitespacesAndNewlines)
            else { return }
            submitSearch()
        }
        .onChange(of: queryDraft) { value in
            if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                !activeQuery.isEmpty {
                if searchFilters.hasActiveFilters {
                    activeQuery = ""
                    searchError = nil
                    reload(resetOffset: true)
                } else {
                    clearSearch()
                }
            }
        }
        .onChange(of: searchFilters) { _ in
            // Filters always execute against the complete Server index, even
            // with an empty text query. Capture the current Browse anchor once.
            if !activeQuery.isEmpty {
                reload(resetOffset: true)
            } else if searchFilters.hasActiveFilters {
                if searchReturnOffset == nil {
                    let saved = rememberedPosition()
                    searchReturnOffset = saved?.pageOffset ?? offset
                    searchReturnNodeID = saved?.nodeID
                }
                reload(resetOffset: true)
            } else if searchReturnOffset != nil {
                clearSearch()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if selecting { filesSelectionToolbar }
        }
        .navigationTitle(isHome ? "浏览" : (folder?.name ?? "搜索结果"))
        .navigationBarTitleDisplayMode(isHome ? .large : .inline)
        .navigationDestination(isPresented: Binding(
            get: { pathDestination != nil },
            set: { if !$0 { pathDestination = nil } }
        )) {
            if let destination = pathDestination {
                XDriveIOSNativeFilesBrowser(login: login, folder: destination)
            }
        }
        .navigationDestination(for: XDriveIOSNativeFilesFolder.self) { next in
            XDriveIOSNativeFilesBrowser(login: login, folder: next)
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if selecting {
                    Button("完成") {
                        guard !batchTrash.busy, !batchTarget.busy,
                              !batchExport.busy, batchExport.prepared.isEmpty else { return }
                        cancelSelectAllRead()
                        model.cancelAdjacent()
                        selecting = false
                        selectedIDs.removeAll()
                        selectedSnapshots.removeAll()
                    }
                    .disabled(batchTrash.busy || batchTarget.busy ||
                              batchExport.busy || !batchExport.prepared.isEmpty)
                    .accessibilityIdentifier("native-ios-files-selection-done")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                if !selecting {
                    Menu {
                        Button {
                            guard canSelectPage, !batchTrash.busy, !batchTarget.busy,
                                  !batchExport.busy, batchExport.prepared.isEmpty else { return }
                            model.cancelAdjacent()
                            selecting = true
                            selectedIDs.removeAll()
                            selectedSnapshots.removeAll()
                        } label: {
                            Label("选择", systemImage: "checkmark.circle")
                        }
                        .disabled(!canSelectPage)
                        .accessibilityIdentifier("native-ios-files-multi-select")
                        Divider()
                    Picker("显示方式", selection: $viewMode) {
                        Text("列表").tag("list")
                        Text("图标").tag("grid")
                    }
                    .accessibilityIdentifier("native-ios-files-view-mode")
                    Picker("排序", selection: $sort) {
                        Text("名称").tag("name")
                        Text("修改时间").tag("updated")
                        Text("大小").tag("size")
                        Text("类型").tag("type")
                    }
                    .disabled(selecting || model.loading)
                    Picker("顺序", selection: $order) {
                        Text("升序").tag("asc")
                        Text("降序").tag("desc")
                    }
                    .disabled(selecting || model.loading)
                    Picker("分组", selection: $grouping) {
                        Text("不分组").tag("none")
                        Text("按类型").tag("type")
                        Text("按修改日期").tag("modified")
                        Text("按大小").tag("size")
                    }
                    .disabled(isHome || isGlobalSearch || selecting || model.loading)
                    .accessibilityIdentifier("native-ios-files-grouping")
                    Toggle("文件夹优先", isOn: $foldersFirst)
                        .disabled(isHome || isGlobalSearch || selecting || model.loading)
                        .accessibilityIdentifier("native-ios-files-folders-first")
                    Divider()
                    Button {
                        openManagement(for: nil, quickAction: .createFolder)
                    } label: {
                        Label("新建文件夹", systemImage: "folder.badge.plus")
                    }
                    .disabled(model.loading || !model.verifiedPage || selecting ||
                              batchTrash.busy || batchTarget.busy ||
                              batchExport.busy || !batchExport.prepared.isEmpty ||
                              login.owner == nil || !activeQuery.isEmpty)
                    .accessibilityIdentifier("native-ios-files-folder-actions")
                    Button {
                        openManagement(for: nil, quickAction: .uploadFile)
                    } label: {
                        Label("上传文件", systemImage: "square.and.arrow.up")
                    }
                    .disabled(model.loading || !model.verifiedPage || selecting ||
                              batchTrash.busy || batchTarget.busy ||
                              batchExport.busy || !batchExport.prepared.isEmpty ||
                              login.owner == nil || !activeQuery.isEmpty)
                    .accessibilityIdentifier("native-ios-files-quick-upload")
                    Button {
                        openManagement(for: nil, quickAction: .uploadMultiple)
                    } label: {
                        Label("上传多个文件（最多 8 项）", systemImage: "square.stack.3d.up")
                    }
                    .disabled(model.loading || !model.verifiedPage || selecting ||
                              batchTrash.busy || batchTarget.busy ||
                              batchExport.busy || !batchExport.prepared.isEmpty ||
                              login.owner == nil || !activeQuery.isEmpty)
                    .accessibilityIdentifier("native-ios-files-quick-multi-upload")
                    if isGlobalSearch {
                        Button { presentSavedSearches() } label: {
                            Label("保存或管理智能文件夹", systemImage: "folder.badge.gearshape")
                        }
                        .accessibilityIdentifier("native-ios-files-save-current-search")
                    }
                    Button {
                        showingPathPrompt = true
                        pathError = nil
                    } label: {
                        Label("前往文件夹路径…", systemImage: "folder.badge.questionmark")
                    }
                    .disabled(login.owner == nil || pathBusy)
                    .accessibilityIdentifier("native-ios-files-go-to-path")
                    Button { presentFileOperations() } label: {
                        Label("文件操作历史／撤销／重做",
                              systemImage: "arrow.uturn.backward.circle")
                    }
                    .disabled(selecting || model.loading || login.owner == nil)
                    .accessibilityIdentifier("native-ios-files-operations")
                    Button {
                        showingClipboardPasteConfirmation = true
                    } label: {
                        Label("粘贴", systemImage: "doc.on.clipboard")
                    }
                    .disabled(!canPasteHere)
                    .accessibilityIdentifier("native-ios-files-paste")
                    Button {
                        reload()
                    } label: {
                        Label("刷新", systemImage: "arrow.clockwise")
                    }
                    .accessibilityIdentifier("native-ios-files-refresh")
                    .disabled(batchTrash.busy || batchTarget.busy ||
                              batchExport.busy || !batchExport.prepared.isEmpty)
                } label: {
                    Label("更多", systemImage: "ellipsis.circle")
                }
                .accessibilityIdentifier("native-ios-files-more-options")
                }
            }
        }
    }

    private var filesModals: some View {
        filesChrome
        .alert("前往文件夹", isPresented: $showingPathPrompt) {
            TextField("例如 /工作/文档", text: $pathDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("取消", role: .cancel) {}
            Button("打开") { resolveTypedPath() }
        } message: {
            Text("从当前账号云端根目录查找，逐级使用服务器精确名称查询。")
        }
        .confirmationDialog(
            "粘贴剪贴板中的项目到当前文件夹？",
            isPresented: $showingClipboardPasteConfirmation,
            titleVisibility: .visible
        ) {
            Button("确认粘贴") { pasteClipboard() }
                .disabled(!canPasteHere)
        } message: {
            Text("移动会改变原文件所在位置；服务器会核对源文件版本和目标目录，结果不确定时不会自动重试。")
        }
        .confirmationDialog(
            "移动到「\(pendingDrop?.destination.name ?? "目标文件夹")」？",
            isPresented: Binding(
                get: { pendingDrop != nil },
                set: { if !$0 { pendingDrop = nil } }
            ), titleVisibility: .visible
        ) {
            Button("确认移动") { confirmInternalDrop() }
            Button("取消", role: .cancel) { pendingDrop = nil }
        } message: {
            Text("仅支持本 App 内长按拖动。服务器会重新核验账号、文件修订和目标目录；移动结果不确定时不自动重试。")
        }
        .alert("重命名", isPresented: Binding(
            get: { quickRenameIntent != nil },
            set: { if !$0 { quickRenameIntent = nil } }
        )) {
            TextField("新名称", text: $quickRenameDraft)
            Button("保存") { confirmQuickRename() }
            Button("取消", role: .cancel) { quickRenameIntent = nil }
        } message: {
            Text("会核验当前账号与文件版本；发生冲突或结果不确定时不自动重试。")
        }
        .confirmationDialog(
            "将“\(quickTrashIntent?.node.name ?? "所选文件")”移入回收站？",
            isPresented: Binding(
                get: { quickTrashIntent != nil },
                set: { if !$0 { quickTrashIntent = nil } }
            ), titleVisibility: .visible
        ) {
            Button("确认移入回收站", role: .destructive) { confirmQuickTrash() }
            Button("取消", role: .cancel) { quickTrashIntent = nil }
        } message: {
            Text("包含文件夹中的子项；服务器确认前不能认定删除成功。")
        }
        .sheet(item: $rowDestinationIntent) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesDestinationPicker(
                    login: login, originalOwner: intent.owner,
                    selected: intent.node, kind: intent.kind
                ) { target in
                    rowDestinationIntent = nil
                    guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner),
                          canQuickMutate(intent.node) else {
                        quickActionNotice = "文件或账户已变化，请重新选择后再操作。"
                        return
                    }
                    quickDestinationWriter.perform(
                        intent.kind, original: intent.node,
                        destination: target, login: login
                    ) { reload() }
                }
            } else {
                Text("账户已经变化，请关闭后重新选择目标文件夹。")
            }
        }
        .sheet(isPresented: $showingBatchShare, onDismiss: {
            // The iOS Share Sheet only exports already staged originals.
            // It never mutates Server Nodes: keep verified rows, scroll
            // position and loaded thumbnail identities on return.
            batchExport.invalidate()
            selecting = false
            selectedIDs.removeAll()
            selectedSnapshots.removeAll()
        }) {
            XDriveIOSNativeFilesBatchShareSheet(
                files: batchExport.prepared.map(\.fileURL)
            )
        }
        .sheet(isPresented: $showingFileOperations, onDismiss: {
            fileOperationsOwner = nil
            if operationWasAccepted {
                operationWasAccepted = false
                reload()
            }
        }) {
            if let owner = fileOperationsOwner,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                NavigationStack {
                    XDriveIOSNativeFilesOperationHistoryScreen(
                        login: login, expectedOwner: owner
                    ) {
                        operationWasAccepted = true
                    }
                }
            } else {
                Text("账户已经变化，请关闭操作历史。")
            }
        }
        .sheet(isPresented: $showingSavedSearches, onDismiss: {
            savedSearchOwner = nil
        }) {
            if let owner = savedSearchOwner,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) {
                NavigationStack {
                    XDriveIOSNativeFilesSavedSearchesScreen(
                        login: login, expectedOwner: owner,
                        proposedQuery: activeQuery,
                        proposedFilters: searchFilters
                    ) { saved in
                        applySavedSearch(saved, expectedOwner: owner)
                    }
                }
            } else {
                Text("账户已经变化，请关闭智能文件夹。")
            }
        }
        .sheet(item: $batchTagsIntent, onDismiss: { reload() }) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                NavigationStack {
                    XDriveIOSNativeFilesTagPanel(
                        login: login, expectedOwner: intent.owner,
                        nodeIDs: intent.nodeIDs,
                        selectionLabel: "已选择的文件和文件夹"
                    )
                }
            } else {
                Text("账户已变化，请重新选择标签管理范围。")
            }
        }
        .sheet(item: $batchDestinationIntent) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesDestinationPicker(
                    login: login, originalOwner: intent.owner,
                    selected: intent.items[0], selectedItems: intent.items,
                    kind: intent.kind
                ) { target in
                    batchDestinationIntent = nil
                    guard selecting, canSelectPage,
                          let owner = login.owner,
                          XDriveIOSNativePhotoOwnerScope.matches(owner, intent.owner),
                          selectedIDs == Set(intent.items.map(\.id)),
                          intent.items.allSatisfy({ selected in
                            selectedSnapshots[selected.id] == selected
                          }) else { return }
                    batchTarget.perform(
                        intent.kind, items: intent.items,
                        sourceParentID: intent.sourceParentID,
                        destination: target, login: login
                    ) {
                        selecting = false
                        selectedIDs.removeAll()
                        selectedSnapshots.removeAll()
                        reload(resetOffset: true)
                    }
                }
            } else {
                Text("账户已变化，请关闭后重新选择。")
                    .foregroundStyle(.secondary)
            }
        }
        .confirmationDialog(
            "将 \(selectedIDs.count) 项及所含子文件移入回收站？",
            isPresented: $showingBatchTrashConfirmation,
            titleVisibility: .visible
        ) {
            Button("确认批量移入回收站", role: .destructive) {
                guard selecting, canSelectPage,
                      let folderID = parentID,
                      selectedIDs == Set(chosenItems.map(\.id)),
                      XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                        chosenItems, parentID: folderID
                      ) else { return }
                batchTrash.trash(
                    chosenItems, parentID: folderID, login: login
                ) {
                    selecting = false
                    selectedIDs.removeAll()
                    selectedSnapshots.removeAll()
                    reload(resetOffset: true)
                }
            }
        } message: {
            Text("包括选中文件夹的所有子文件。结果不确定时先刷新目录，不能重复提交。")
        }
        // Locate is read-only: closing it cannot invalidate a verified
        // directory window or cause a cold thumbnail/refetch cycle.
        .sheet(item: $locateIntent) { intent in
            NavigationStack {
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                    XDriveIOSNativeFilesLocateScreen(
                        login: login, selected: intent.node, openedOwner: intent.owner
                    )
                } else {
                    Text("账户已经变化，请关闭并重新搜索。")
                }
            }
        }
        .sheet(item: $managementIntent, onDismiss: {
            if managementWriteConfirmed {
                managementWriteConfirmed = false
                reload()
            }
        }) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesManagementPanel(
                    login: login, expectedOwner: intent.owner,
                    folderID: intent.file?.parent_id ?? intent.directory?.parent_id ??
                        folder?.id ?? intent.owner.rootNodeID,
                    folderName: verifiedManagementParentName(for: intent),
                    file: intent.file,
                    directory: intent.directory,
                    initialQuickAction: intent.quickAction
                ) {
                    // Only a confirmed Server mutation invalidates the page;
                    // merely opening Properties or Share never does.
                    managementWriteConfirmed = true
                    managementIntent = nil
                }
            } else {
                Text("当前账户已变化，请关闭并重新选择文件。")
                    .foregroundStyle(.secondary)
            }
        }
        .sheet(item: $versionHistoryIntent, onDismiss: {
            if versionRestoreConfirmed {
                versionRestoreConfirmed = false
                reload()
            }
        }) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesVersionHistoryScreen(
                    login: login, openedOwner: intent.owner, node: intent.node
                ) {
                    // A successful historical restore changes the Node;
                    // read-only version browsing and download do not.
                    versionRestoreConfirmed = true
                    versionHistoryIntent = nil
                }
            } else {
                Text("当前账户已变化，请关闭后重新进入文件版本历史。")
            }
        }
        .fullScreenCover(item: $selectedFile, onDismiss: {
            selectedOwner = nil
            // Viewer is read-only. Returning to a still-valid Owner/scope
            // must not clear all rows and thumbnails or flash an empty List.
            if let folderID = parentID,
               model.canResume(
                owner: login.owner, folderID: folderID,
                query: activeQuery, filters: searchFilters,
                sort: sort, order: order,
                grouping: grouping, foldersFirst: foldersFirst
               ) {
                lastViewedFile = nil
                returnOwner = nil
            } else {
                if let viewed = lastViewedFile,
                   let index = model.entries.firstIndex(where: { $0.id == viewed.id }) {
                    offset = model.startOffset +
                        (index / XDriveIOSNativeFilesPagePolicy.pageSize) *
                        XDriveIOSNativeFilesPagePolicy.pageSize
                }
                reload()
            }
        }) { initial in
            if let openedOwner = selectedOwner {
                XDriveIOSNativeFilesViewer(
                    initial: initial.node,
                    loadedItems: viewerWindow(for: initial.node),
                    openedOwner: openedOwner,
                    login: login,
                    onNavigate: { next in
                        guard phase == .active, !model.loading,
                              selectedFile?.id == initial.id,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                  login.owner, openedOwner
                              ),
                              containsVerifiedNode(next)
                        else { return false }
                        lastViewedFile = next
                        return true
                    }
                )
            } else {
                Text("当前账户已变化，请返回文件列表。")
            }
        }
    }

    /// Save the exact loaded page containing the last appeared row before
    /// SwiftUI retires this navigation subtree. No stale or unknown Node may
    /// become a return anchor.
    private func rememberedPosition()
        -> XDriveIOSNativeFilesContinuousWindowPolicy.RestoreAnchor? {
        guard !isHome, model.verifiedPage, !model.loading,
              login.owner != nil else { return nil }
        return XDriveIOSNativeFilesContinuousWindowPolicy.restoreAnchor(
            lastAppearedNodeID: lastAppearedNodeID,
            startOffset: model.startOffset,
            loadedIDs: model.entries.map(\.id), total: model.total
        )
    }

    private func suspendVisibleRange() {
        cancelPathLookup()
        cancelSelectAllRead()
        clearInternalDrag()
        pendingDrop = nil
        inlineFolders.suspendForNavigation()
        guard selectedFile == nil else { return }
        if let saved = rememberedPosition() {
            offset = saved.pageOffset
            pendingNavigationReturnNodeID = saved.nodeID
        } else {
            pendingNavigationReturnNodeID = nil
        }
        model.suspendForNavigation()
    }

    var body: some View {
        ScrollViewReader { returnScroll in
            filesModals
        .onAppear {
            // Returning from a child must keep the same verified rows, their
            // SwiftUI NavigationLinks and scroll position. Do not refetch on
            // every stack pop; explicit refresh and Owner change still do.
            if isHome {
                reload()
            } else if let folderID = parentID,
                      model.canResume(
                        owner: login.owner, folderID: folderID,
                        query: activeQuery, filters: searchFilters,
                        sort: sort, order: order,
                        grouping: grouping, foldersFirst: foldersFirst
                      ) {
                pendingNavigationReturnNodeID = nil
            } else {
                reload()
            }
            // Listing directories does not need two additional source/tag
            // GETs. The optional filter choices load on explicit demand.
            if isGlobalSearch { searchOptions.load(login: login) }
        }
        .onDisappear { suspendVisibleRange() }
        .onDisappear {
            searchOptions.invalidate()
            if isHome, let current = login.owner,
               let retained = favoriteShortcutsOwner,
               XDriveIOSNativePhotoOwnerScope.matches(current, retained) {
                favoriteShortcuts.suspendForNavigation()
            } else {
                favoriteShortcuts.invalidate()
                favoriteShortcutsOwner = nil
            }
            batchTrash.invalidate()
            batchTarget.invalidate()
            if !showingBatchShare { batchExport.invalidate() }
            if rowDestinationIntent == nil {
                quickMutation.invalidate()
                quickDestinationWriter.invalidate()
                quickFavorite.invalidate()
                quickRenameIntent = nil
                quickTrashIntent = nil
                quickActionNotice = nil
            }
            batchDestinationIntent = nil
            selecting = false
            selectedIDs.removeAll()
            selectedSnapshots.removeAll()
            showingBatchTrashConfirmation = false
        }
        .onChange(of: login.owner) { _ in
            quickMutation.invalidate()
            quickDestinationWriter.invalidate()
            quickFavorite.invalidate()
            quickRenameIntent = nil
            quickTrashIntent = nil
            rowDestinationIntent = nil
            quickActionNotice = nil
            batchTrash.invalidate()
            batchTarget.invalidate()
            batchExport.invalidate()
            showingBatchShare = false
            batchDestinationIntent = nil
            batchTagsIntent = nil
            showingSavedSearches = false
            savedSearchOwner = nil
            quickAccess.invalidate()
            inlineFolders.invalidate()
            showingFileOperations = false
            fileOperationsOwner = nil
            cancelSelectAllRead()
            selectAllNotice = nil
            operationWasAccepted = false
            managementWriteConfirmed = false
            versionRestoreConfirmed = false
            clearInternalDrag()
            pendingDrop = nil
            showingPathPrompt = false
            pathDestination = nil
            cancelPathLookup()
            showingClipboardPasteConfirmation = false
            clipboard.clear()
            selecting = false
            selectedIDs.removeAll()
            selectedSnapshots.removeAll()
            showingBatchTrashConfirmation = false
            managementIntent = nil
            versionHistoryIntent = nil
            locateIntent = nil
            selectedFile = nil
            selectedOwner = nil
            returnOwner = nil
            lastViewedFile = nil
            offset = 0
            queryDraft = ""
            activeQuery = ""
            searchReturnOffset = nil
            searchReturnNodeID = nil
            lastAppearedNodeID = nil
            pendingNavigationReturnNodeID = nil
            searchError = nil
            searchFilters = XDriveIOSNativeFilesSearchFilterState()
            model.invalidate()
            searchOptions.invalidate()
            if login.owner != nil { searchOptions.load(login: login) }
            favoriteShortcuts.invalidate()
            favoriteShortcutsOwner = nil
            if isHome { loadFavoriteShortcuts() }
        }
        .onChange(of: model.verifiedPage) { now in
            if !now {
                selectedIDs.removeAll()
                selectedSnapshots.removeAll()
                selecting = false
            }
        }
                // Node IDs alone cannot detect a revision/parent change in-place.
        // Compare the full verified Node snapshots before permitting mutation.
        .onChange(of: model.entries.map(\.node)) { _ in
            // Eviction is not deselection. Reappearing changed revisions
            // retire only their own snapshots, never the entire selection.
            let conflicts = XDriveIOSNativeFilesSelectionPolicy.conflictingIDs(
                visible: model.entries.map(\.node), snapshots: selectedSnapshots
            )
            for id in conflicts {
                selectedIDs.remove(id)
                selectedSnapshots.removeValue(forKey: id)
            }
        }
        .onChange(of: sort) { _ in reload(resetOffset: true) }
        .onChange(of: order) { _ in reload(resetOffset: true) }
        .onChange(of: viewMode) { next in
            if next == "grid" { inlineFolders.invalidate() }
        }
        .onChange(of: grouping) { _ in
            if !isHome && !isGlobalSearch { reload(resetOffset: true) }
        }
        .onChange(of: foldersFirst) { _ in
            if !isHome && !isGlobalSearch { reload(resetOffset: true) }
        }
        .onChange(of: model.loading) { loading in
            guard !loading, selectedFile == nil else { return }
            if let returnID = pendingNavigationReturnNodeID {
                pendingNavigationReturnNodeID = nil
                if focusedNode == nil, lastViewedFile == nil,
                   model.verifiedPage,
                   model.entries.contains(where: { $0.id == returnID }) {
                    returnScroll.scrollTo(returnID, anchor: .center)
                }
            }
            if !didRestoreLocatedFile, let focusedNode, model.verifiedPage {
                didRestoreLocatedFile = true
                if model.entries.contains(where: { $0.node == focusedNode }) {
                    returnScroll.scrollTo(focusedNode.id, anchor: .center)
                } else {
                    locatedFileNotice = "文件排序或版本已变化；请返回搜索结果重新定位。"
                }
            }
            guard let target = lastViewedFile else { return }
            if let owner = returnOwner,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
               model.entries.contains(where: { $0.node == target }) {
                returnScroll.scrollTo(target.id, anchor: .center)
            }
            lastViewedFile = nil
            returnOwner = nil
        }
        }
    }

    /// Both display modes operate on the same, currently verified 64-item
    /// Owner page. No grid-specific reads or copied mutation pipelines.
    private func cancelSelectAllRead() {
        selectAllEpoch = UUID()
        selectAllJob?.cancel()
        selectAllJob = nil
        selectAllBusy = false
    }

    /// PWA parity: explicitly Select All only when the authoritative Server
    /// directory has at most 200 items. Never select just the visible page.
    private func selectAllCurrentFolder() {
        guard selecting, canSelectPage, let owner = login.owner,
              let folderID = parentID, model.total > 0,
              model.total <= XDriveIOSNativeFilesBatchTrashPolicy.maxSelected,
              model.canResume(
                owner: owner, folderID: folderID, query: activeQuery,
                filters: searchFilters, sort: sort, order: order,
                grouping: grouping, foldersFirst: foldersFirst
              ) else { return }
        let total = model.total
        let chosenSort = sort, chosenOrder = order
        let chosenGroup = grouping, chosenFoldersFirst = foldersFirst
        let token = UUID()
        selectAllEpoch = token
        selectAllBusy = true
        selectAllNotice = nil
        selectAllJob = Task { @MainActor in
            defer {
                if selectAllEpoch == token {
                    selectAllBusy = false
                    selectAllJob = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                else { throw XDriveIOSNativeFilesReadError.invalidScope }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                guard var accumulator = XDriveIOSNativeFilesSelectAllAccumulator(
                    parentID: folderID, total: total,
                    sort: chosenSort, order: chosenOrder
                ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
                for start in stride(
                    from: 0, to: total, by: XDriveIOSNativeFilesPagePolicy.pageSize
                ) {
                    let page = try await reader.children(
                        parentID: folderID, offset: start,
                        sort: chosenSort, order: chosenOrder,
                        grouping: chosenGroup,
                        foldersFirst: chosenFoldersFirst
                    )
                    try Task.checkCancellation()
                    guard accumulator.append(page) else {
                        throw XDriveIOSNativeFilesReadError.invalidPage
                    }
                }
                guard let nodes = accumulator.verifiedSelection() else {
                    throw XDriveIOSNativeFilesReadError.invalidPage
                }
                let ids = Set(nodes.keys)
                try Task.checkCancellation()
                guard selectAllEpoch == token, selecting, !model.loading,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      model.total == total,
                      model.canResume(
                        owner: owner, folderID: folderID, query: activeQuery,
                        filters: searchFilters, sort: chosenSort,
                        order: chosenOrder, grouping: chosenGroup,
                        foldersFirst: chosenFoldersFirst
                      ) else { return }
                // Reject a concurrent changed revision even if the total is
                // identical. Never commit a partial or unverified selection.
                guard model.entries.allSatisfy({
                    nodes[$0.id] == $0.node
                }) else { throw XDriveIOSNativeFilesReadError.invalidPage }
                selectedSnapshots = nodes
                selectedIDs = ids
                selectAllNotice = "已选择当前目录全部 \(total) 项。"
            } catch is CancellationError {
                // Cancellation preserves the previous selected snapshots.
            } catch {
                guard selectAllEpoch == token else { return }
                selectAllNotice = "目录或权限已变化，保留原选择；请刷新后重试。"
            }
        }
    }

    private func toggleSelection(_ entry: XDriveIOSNativeFilesEntry) {
        if selectAllBusy { cancelSelectAllRead() }
        guard canSelectPage,
              model.entries.contains(where: { $0.node == entry.node }) else { return }
        if selectedIDs.contains(entry.id) {
            selectedIDs.remove(entry.id)
            selectedSnapshots.removeValue(forKey: entry.id)
        } else if selectedIDs.count < XDriveIOSNativeFilesBatchTrashPolicy.maxSelected {
            selectedIDs.insert(entry.id)
            selectedSnapshots[entry.id] = entry.node
        }
    }

    private func cancelPathLookup() {
        pathTicket = UUID()
        pathTask?.cancel()
        pathTask = nil
        pathBusy = false
    }

    private func resolveTypedPath() {
        guard !pathBusy, let expectedOwner = login.owner else { return }
        guard let parts = XDriveIOSNativeFilesPathPolicy.segments(pathDraft) else {
            pathError = "文件夹路径无效；最多 32 层、2048 字节。"
            return
        }
        cancelPathLookup()
        let ticket = pathTicket
        pathError = nil
        pathBusy = true
        pathTask = Task { @MainActor in
            defer {
                if pathTicket == ticket {
                    pathBusy = false
                    pathTask = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner)
                else { throw XDriveIOSNativeFilesReadError.invalidScope }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                var destinationID = auth.owner.rootNodeID
                var destinationName = "xDrive 云端"
                for name in parts {
                    try Task.checkCancellation()
                    guard let child = try await reader.namedDirectory(
                        parentID: destinationID, name: name
                    ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
                    destinationID = child.id
                    destinationName = child.name
                }
                try Task.checkCancellation()
                guard pathTicket == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { return }
                if destinationID == parentID && !isHome {
                    pathError = "当前已经位于这个文件夹。"
                } else {
                    pathDestination = XDriveIOSNativeFilesFolder(
                        id: destinationID, name: destinationName
                    )
                }
            } catch is CancellationError {
            } catch {
                guard pathTicket == ticket else { return }
                pathError = "未找到可访问的目标文件夹，请检查路径、权限或网络后重试。"
            }
        }
    }

    private func presentFileOperations() {
        guard !selecting, let owner = login.owner,
              !batchTrash.busy && !batchTarget.busy && !batchExport.busy
        else { return }
        fileOperationsOwner = owner
        showingFileOperations = true
    }

    private func presentSavedSearches() {
        guard !selecting, let owner = login.owner,
              !batchTrash.busy && !batchTarget.busy && !batchExport.busy
        else { return }
        savedSearchOwner = owner
        showingSavedSearches = true
    }

    private func applySavedSearch(
        _ saved: XDriveIOSNativeFilesSavedSearch,
        expectedOwner: XDriveNativeOwnerRoot
    ) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner),
              XDriveIOSNativeFilesSavedSearchPolicy.valid(saved)
        else { return }
        if searchReturnOffset == nil {
            let anchor = rememberedPosition()
            searchReturnOffset = anchor?.pageOffset ?? offset
            searchReturnNodeID = anchor?.nodeID
        }
        let restored = saved.filters.native
        activeQuery = saved.query
        queryDraft = saved.query
        // Filter onChange already launches the one Server Range read.
        // Avoid a second unconditional reload and empty-list flicker.
        if restored != searchFilters {
            searchFilters = restored
        } else {
            reload(resetOffset: true)
        }
    }

    private func captureSelection(_ kind: XDriveIOSNativeFilesDestinationKind) {
        guard canSelectPage, let owner = login.owner, let sourceParentID = parentID,
              selectedIDs == Set(chosenItems.map(\.id)),
              clipboard.capture(
                kind, items: chosenItems, sourceParentID: sourceParentID,
                owner: owner
              ) else { return }
        selecting = false
        selectedIDs.removeAll()
        selectedSnapshots.removeAll()
    }

    private func captureItem(_ entry: XDriveIOSNativeFilesEntry,
                             kind: XDriveIOSNativeFilesDestinationKind) {
        guard !selecting, !isGlobalSearch,
              let owner = login.owner, let sourceParentID = entry.node.parent_id,
              containsVerifiedNode(entry.node) else { return }
        _ = clipboard.capture(
            kind, items: [entry.node], sourceParentID: sourceParentID, owner: owner
        )
    }

    private func openBatchTags() {
        guard canSelectPage, let owner = login.owner, let sourceParentID = parentID,
              selectedIDs == Set(chosenItems.map(\.id)),
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                chosenItems, parentID: sourceParentID
              ) else { return }
        batchTagsIntent = XDriveIOSNativeFilesBatchTagsIntent(
            owner: owner, nodeIDs: chosenItems.map(\.id)
        )
    }

    private func pasteClipboard() {
        guard canPasteHere, let owner = login.owner, let folderID = parentID,
              let snapshot = clipboard.snapshot(for: owner),
              XDriveIOSNativeFilesBatchTargetPolicy.validSelection(
                snapshot.items, sourceParentID: snapshot.sourceParentID,
                destinationID: folderID, kind: snapshot.kind
              ) else { return }
        batchTarget.perform(
            snapshot.kind, items: snapshot.items,
            sourceParentID: snapshot.sourceParentID,
            destination: XDriveIOSNativeFilesDestination(
                id: folderID, name: folder?.name ?? "云端根目录"
            ), login: login
        ) {
            if snapshot.kind == .move { clipboard.clear() }
            reload(resetOffset: true)
        }
    }

    /// The existing native Viewer only accepts 64 same-parent file targets.
    /// Center its immutable window on the selected file instead of passing
    /// an unbounded continuously loaded file list into L3.
    private func containsVerifiedNode(_ node: XDriveIOSNativeFilesNode) -> Bool {
        model.verifiedPage && !model.loading && (
            model.entries.contains(where: { $0.node == node }) ||
            inlineFolders.containsVerified(node, owner: login.owner)
        )
    }

    private func viewerWindow(for selected: XDriveIOSNativeFilesNode)
        -> [XDriveIOSNativeFilesNode] {
        let source = model.entries.contains(where: { $0.node == selected })
            ? model.entries.map(\.node)
            : inlineFolders.siblings(of: selected, owner: login.owner) ?? []
        let siblings = source.filter {
            $0.type == "file" && $0.parent_id == selected.parent_id
        }
        guard let index = siblings.firstIndex(of: selected) else { return [selected] }
        let maximum = XDriveIOSNativeFilesViewerPolicy.maximumLoadedRows
        let start = max(0, min(index - maximum / 2, max(0, siblings.count - maximum)))
        return Array(siblings[start..<min(start + maximum, siblings.count)])
    }

    private func openViewer(_ entry: XDriveIOSNativeFilesEntry) {
        guard let owner = login.owner,
              containsVerifiedNode(entry.node) else { return }
        model.cancelAdjacent()
        inlineFolders.suspendForNavigation()
        selectedOwner = owner
        returnOwner = owner
        lastViewedFile = entry.node
        selectedFile = entry
    }

    @ViewBuilder
    private func gridTile(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if selecting {
                Button { toggleSelection(entry) } label: { gridLabel(entry) }
                    .buttonStyle(.plain)
                    .disabled(!canSelectPage)
                    .accessibilityIdentifier("native-ios-files-select-\(entry.id)")
            } else if entry.node.isDirectory {
                NavigationLink(value: XDriveIOSNativeFilesFolder(
                    id: entry.node.id, name: entry.node.name
                )) {
                    gridLabel(entry)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("native-ios-files-folder-\(entry.id)")
            } else {
                Button { openViewer(entry) } label: { gridLabel(entry) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("native-ios-files-file-\(entry.node.id)")
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .contentShape(Rectangle())
        .onDrag { beginInternalDrag(entry) }
        .onDrop(of: [Self.internalDragType], isTargeted: nil) { providers in
            prepareInternalDrop(on: entry.node, providers: providers)
        }
        .contextMenu {
            if !selecting {
                nativeQuickActions(for: entry)
                Button {
                    openManagement(for: entry.node)
                } label: {
                    Label("显示简介", systemImage: "info.circle")
                }
                .accessibilityIdentifier(entry.node.isDirectory
                    ? "native-ios-files-folder-more-\(entry.id)"
                    : "native-ios-files-more-\(entry.id)")
                if !entry.node.isDirectory {
                    Button("版本历史") { openVersionHistory(for: entry.node) }
                }
                if isGlobalSearch {
                    Button {
                        requestLocation(for: entry)
                    } label: {
                        Label("显示位置", systemImage: "folder.badge.questionmark")
                    }
                    .accessibilityIdentifier("native-ios-files-locate-\(entry.id)")
                }
            }
        }
    }

    private func gridLabel(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                XDriveIOSNativeFilesThumbnailTile(
                    node: entry.node, login: login,
                    height: 72, viewerActive: selectedFile != nil
                )
                if selecting {
                    Image(systemName: selectedIDs.contains(entry.id)
                          ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(Color.accentColor)
                        .padding(6)
                        .accessibilityHidden(true)
                }
            }
            Text(entry.node.name)
                .font(.footnote)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
            Text(entry.path ?? (entry.node.isDirectory ? "文件夹" :
                ByteCountFormatter.string(fromByteCount: entry.node.size,
                                          countStyle: .file)))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if let modifiedDate = entry.node.modifiedDate {
                Text("修改于 \(XDriveIOSNativeFilesDatePolicy.display(modifiedDate))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(selecting
            ? (selectedIDs.contains(entry.id) ? "已选中" : "未选中") : "")
    }

    private func row(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        HStack(spacing: 12) {
            XDriveIOSNativeFilesThumbnailTile(
                node: entry.node, login: login,
                height: 40, width: 40, viewerActive: selectedFile != nil
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.node.name).lineLimit(2)
                if let path = entry.path {
                    Text(path).font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    if !entry.node.isDirectory {
                        Text(ByteCountFormatter.string(
                            fromByteCount: entry.node.size, countStyle: .file
                        )).font(.caption).foregroundStyle(.secondary)
                    }
                    if let modifiedDate = entry.node.modifiedDate {
                        Text("修改于 \(XDriveIOSNativeFilesDatePolicy.display(modifiedDate))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 6)
        }
        .contentShape(Rectangle())
        .frame(minHeight: 44)
    }

    private func requestLocation(for entry: XDriveIOSNativeFilesEntry) {
        guard !model.loading, model.verifiedPage,
              isGlobalSearch, !selecting,
              let owner = login.owner,
              model.entries.contains(where: { $0.node == entry.node }) else { return }
        returnOwner = owner
        lastViewedFile = entry.node
        locateIntent = XDriveIOSNativeFilesLocateIntent(owner: owner, node: entry.node)
    }

    private func openBatchDestination(_ kind: XDriveIOSNativeFilesDestinationKind) {
        guard selecting, canSelectPage,
              let owner = login.owner, let sourceParentID = parentID,
              !chosenItems.isEmpty,
              selectedIDs == Set(chosenItems.map(\.id)),
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                chosenItems, parentID: sourceParentID
              ) else { return }
        batchDestinationIntent = XDriveIOSNativeFilesBatchDestinationIntent(
            owner: owner, items: chosenItems, sourceParentID: sourceParentID,
            kind: kind
        )
    }

    private func openVersionHistory(for node: XDriveIOSNativeFilesNode) {
        guard !selecting, !model.loading, model.verifiedPage,
              !batchTrash.busy, !batchTarget.busy, !batchExport.busy,
              batchExport.prepared.isEmpty,
              node.type == "file", let owner = login.owner,
              containsVerifiedNode(node) else { return }
        versionHistoryIntent = XDriveIOSNativeFilesVersionIntent(
            owner: owner, node: node
        )
    }

    /// The list/grid row is an exact, already committed Server Node snapshot.
    /// An Owner transition or a newer revision invalidates its quick actions.
    private func canQuickMutate(_ node: XDriveIOSNativeFilesNode) -> Bool {
        !selecting && !model.loading && model.verifiedPage &&
            selectedFile == nil && managementIntent == nil &&
            !batchTrash.busy && !batchTarget.busy && !batchExport.busy &&
            batchExport.prepared.isEmpty &&
            !quickMutation.busy && !quickDestinationWriter.busy &&
            !quickFavorite.busy && login.owner != nil &&
            node.parent_id != nil && containsVerifiedNode(node)
    }

    private func clearQuickResult() {
        quickActionNotice = nil
        quickMutation.invalidate()
        quickDestinationWriter.invalidate()
        quickFavorite.invalidate()
    }

    private func requestQuickRename(_ node: XDriveIOSNativeFilesNode) {
        guard canQuickMutate(node), let owner = login.owner else { return }
        clearQuickResult()
        quickRenameDraft = node.name
        quickRenameIntent = .init(owner: owner, node: node)
    }

    private func confirmQuickRename() {
        guard let intent = quickRenameIntent else { return }
        quickRenameIntent = nil
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner),
              canQuickMutate(intent.node) else {
            quickActionNotice = "文件版本或账户已变化，请刷新后重新选择。"
            return
        }
        // Reuse NativeFilesSingleMutation: GET proof, revision If-Match,
        // confirmed receipt and no retry after an uncertain PATCH response.
        quickMutation.perform(
            node: intent.node, kind: .rename(quickRenameDraft), login: login
        ) { reload() }
    }

    private func requestQuickTrash(_ node: XDriveIOSNativeFilesNode) {
        guard canQuickMutate(node), let owner = login.owner else { return }
        clearQuickResult()
        quickTrashIntent = .init(owner: owner, node: node)
    }

    private func confirmQuickTrash() {
        guard let intent = quickTrashIntent else { return }
        quickTrashIntent = nil
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner),
              canQuickMutate(intent.node) else {
            quickActionNotice = "文件版本或账户已变化，请刷新后重新选择。"
            return
        }
        quickMutation.perform(node: intent.node, kind: .trash, login: login) {
            reload()
        }
    }

    private func requestRowDestination(
        _ node: XDriveIOSNativeFilesNode,
        kind: XDriveIOSNativeFilesDestinationKind
    ) {
        guard canQuickMutate(node), let owner = login.owner,
              let sourceParent = node.parent_id,
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                [node], parentID: sourceParent
              ) else { return }
        clearQuickResult()
        rowDestinationIntent = .init(owner: owner, node: node, kind: kind)
    }

    private func requestQuickFavorite(_ node: XDriveIOSNativeFilesNode) {
        guard canQuickMutate(node) else { return }
        clearQuickResult()
        quickFavorite.add(node, login: login)
    }

    /// File-row actions present the native confirmation/target immediately.
    /// Properties, download and cloud-link setup remain in their specialized
    /// verified panels, rather than duplicating any Server writer.
    @ViewBuilder private func nativeQuickActions(for entry: XDriveIOSNativeFilesEntry)
        -> some View {
        if !entry.node.isDirectory {
            Button {
                openViewer(entry)
            } label: {
                Label("预览", systemImage: "eye")
            }
        }
        if entry.node.isDirectory && !isGlobalSearch {
            Button {
                guard containsVerifiedNode(entry.node) else { return }
                quickAccess.togglePin(entry.node, login: login)
            } label: {
                Label(
                    quickAccess.matches(login.owner) &&
                    quickAccess.items.contains(where: { $0.id == entry.node.id })
                        ? "取消固定到快捷目录" : "固定到快捷目录",
                    systemImage: "pin"
                )
            }
            .disabled(quickAccess.busy || quickAccess.loading)
            .accessibilityIdentifier("native-ios-files-toggle-pin-\(entry.node.id)")
        }
        Button {
            captureItem(entry, kind: .copy)
        } label: {
            Label("复制", systemImage: "doc.on.clipboard")
        }
        .accessibilityIdentifier("native-ios-files-clipboard-copy")
        Button {
            captureItem(entry, kind: .move)
        } label: {
            Label("剪切", systemImage: "scissors")
        }
        .accessibilityIdentifier("native-ios-files-clipboard-cut")
        Button {
            requestRowDestination(entry.node, kind: .copy)
        } label: {
            Label("复制到…", systemImage: "doc.on.doc")
        }
        .disabled(!canQuickMutate(entry.node))
        .accessibilityIdentifier("native-ios-files-row-copy-to")
        Button {
            requestRowDestination(entry.node, kind: .move)
        } label: {
            Label("移动到…", systemImage: "folder")
        }
        .disabled(!canQuickMutate(entry.node))
        .accessibilityIdentifier("native-ios-files-row-move-to")
        Button {
            requestQuickRename(entry.node)
        } label: {
            Label("重命名", systemImage: "pencil")
        }
        .disabled(!canQuickMutate(entry.node))
        .accessibilityIdentifier("native-ios-files-row-rename")
        Button {
            requestQuickFavorite(entry.node)
        } label: {
            Label("收藏", systemImage: "star")
        }
        .disabled(!canQuickMutate(entry.node))
        .accessibilityIdentifier("native-ios-files-row-favorite")
        Button {
            openManagement(for: entry.node, quickAction: .shareLink)
        } label: {
            Label("云端分享链接", systemImage: "link")
        }
        Button {
            openManagement(for: entry.node, quickAction: .download)
        } label: {
            Label(entry.node.isDirectory ? "下载文件夹 ZIP" : "下载原件",
                  systemImage: "arrow.down.to.line")
        }
        Button(role: .destructive) {
            requestQuickTrash(entry.node)
        } label: {
            Label("移入回收站", systemImage: "trash")
        }
        .disabled(!canQuickMutate(entry.node))
        .accessibilityIdentifier("native-ios-files-row-trash")
        if !canQuickMutate(entry.node) {
            Text("当前文件尚未验证，或另一个文件操作正在进行。")
                .foregroundStyle(.secondary)
        }
    }

    private func openManagement(
        for node: XDriveIOSNativeFilesNode?,
        quickAction: XDriveIOSNativeFilesQuickAction? = nil
    ) {
        guard !model.loading, model.verifiedPage, selectedFile == nil,
              let owner = login.owner,
              node != nil || activeQuery.isEmpty else { return }
        if let node {
            guard containsVerifiedNode(node) else { return }
        }
        if let node, let index = model.entries.firstIndex(where: { $0.node == node }) {
            offset = model.startOffset +
                (index / XDriveIOSNativeFilesPagePolicy.pageSize) *
                XDriveIOSNativeFilesPagePolicy.pageSize
        }
        model.cancelAdjacent()
        managementIntent = XDriveIOSNativeFilesManagementIntent(
            owner: owner,
            file: node?.isDirectory == false ? node : nil,
            directory: node?.isDirectory == true ? node : nil,
            quickAction: quickAction
        )
    }

    private func searchStartOfDay(daysAgo: Int) -> Date {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        return calendar.date(byAdding: .day, value: -daysAgo, to: today) ?? today
    }

    private func searchStartOfYear() -> Date {
        let calendar = Calendar.current
        let year = calendar.component(.year, from: Date())
        return calendar.date(from: DateComponents(year: year, month: 1, day: 1))
            ?? calendar.startOfDay(for: Date())
    }

    private func setSearchModifiedFrom(_ date: Date) {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime]
        searchFilters.modifiedFrom = formatter.string(from: date)
        searchFilters.modifiedTo = nil
    }

    private func submitSearch() {
        let query = queryDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty {
            guard searchFilters.hasActiveFilters else {
                clearSearch()
                return
            }
            searchError = nil
            if activeQuery.isEmpty { return }
            activeQuery = ""
            reload(resetOffset: true)
            return
        }
        guard XDriveIOSNativeFilesPagePolicy.validSearch(query) else {
            searchError = "搜索词至少需要 2 个字符，最多 200 个字符且不超过 256 UTF-8 字节。"
            return
        }
        searchError = nil
        if query == activeQuery { return }
        if searchReturnOffset == nil {
            let saved = rememberedPosition()
            searchReturnOffset = saved?.pageOffset ?? offset
            searchReturnNodeID = saved?.nodeID
        }
        activeQuery = query
        reload(resetOffset: true)
    }

    private func clearSearch() {
        guard !activeQuery.isEmpty || !queryDraft.isEmpty ||
              searchFilters.hasActiveFilters || searchReturnOffset != nil else { return }
        let restoredOffset = searchReturnOffset ?? 0
        let restoreNodeID = searchReturnNodeID
        activeQuery = ""
        queryDraft = ""
        searchFilters = XDriveIOSNativeFilesSearchFilterState()
        searchError = nil
        searchReturnOffset = nil
        searchReturnNodeID = nil
        lastAppearedNodeID = nil
        offset = restoredOffset
        pendingNavigationReturnNodeID = restoreNodeID
        reload()
    }

    private func reorderQuickAccess(
        _ item: XDriveIOSNativeFilesQuickAccessItem, delta: Int
    ) {
        guard quickAccess.matches(login.owner), !quickAccess.loading,
              !quickAccess.busy,
              let index = quickAccess.items.firstIndex(where: { $0.id == item.id }),
              index + delta >= 0,
              index + delta < quickAccess.items.count else { return }
        var ids = quickAccess.items.map(\.id)
        ids.swapAt(index, index + delta)
        quickAccess.reorder(ids, login: login)
    }

    private func loadFavoriteShortcuts() {
        guard isHome, let owner = login.owner else {
            favoriteShortcuts.invalidate()
            favoriteShortcutsOwner = nil
            return
        }
        let sameOwner = favoriteShortcutsOwner.map {
            XDriveIOSNativePhotoOwnerScope.matches(owner, $0)
        } ?? false
        if !sameOwner {
            favoriteShortcuts.invalidate()
            favoriteShortcutsOwner = owner
        }
        // Returning to Home must not erase the NavigationLinks used for
        // favorited directories or briefly flash an empty shortcuts section.
        // The Server still revalidates Owner/root and all current rows.
        favoriteShortcuts.load(
            .favorites, login: login, preserveVerifiedRows: sameOwner
        )
    }

    private func reload(resetOffset: Bool = false) {
        cancelSelectAllRead()
        selectAllNotice = nil
        clearInternalDrag()
        pendingDrop = nil
        inlineFolders.invalidate()
        selecting = false
        selectedIDs.removeAll()
        selectedSnapshots.removeAll()
        batchExport.invalidate()
        batchTarget.invalidate()
        batchDestinationIntent = nil
        if resetOffset {
            offset = 0
            lastAppearedNodeID = nil
            pendingNavigationReturnNodeID = nil
        }
        if isHome {
            model.invalidate()
            loadFavoriteShortcuts()
            quickAccess.load(login: login)
            return
        }
        favoriteShortcuts.invalidate()
        favoriteShortcutsOwner = nil
        guard let parentID else {
            model.invalidate()
            return
        }
        model.load(login: login, folderID: parentID, offset: offset,
                   query: activeQuery, filters: searchFilters, sort: sort, order: order,
                   grouping: grouping, foldersFirst: foldersFirst)
    }
}
