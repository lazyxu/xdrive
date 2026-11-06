import Combine
import Foundation
import Photos

enum XDriveIOSNativeGalleryPresence: String, CaseIterable, Identifiable {
    case both, localOnly, cloudOnly, unverified

    var id: Self { self }
    var title: String {
        switch self {
        case .both: return "两端都有"
        case .localOnly: return "仅本机"
        case .cloudOnly: return "仅云端"
        case .unverified: return "待核验"
        }
    }
    var symbol: String {
        switch self {
        case .both: return "checkmark.icloud"
        case .localOnly: return "iphone"
        case .cloudOnly: return "icloud"
        case .unverified: return "questionmark.circle"
        }
    }
}

struct XDriveIOSNativeGalleryCursor: Equatable {
    var local = 0
    var cloud = 0
    var localEnd = false
    var cloudEnd = false
    var cloudCount: Int?
    var cloudAnchor: UInt64?
    var cloudAnchorRevision: UInt64?
    var finished: Bool { localEnd && cloudEnd }
}

struct XDriveIOSNativeUnifiedPhoto: Identifiable {
    let local: XDrivePhotoKitScanCandidate?
    let cloud: XDriveIOSNativeMediaItem?
    let match: XDriveIOSNativeExactPhotoMatch?
    let presence: XDriveIOSNativeGalleryPresence
    let capturedAt: Date?

    var id: String {
        if let local { return "local:" + local.id }
        return "cloud:\(cloud?.id ?? 0)"
    }
    var isVideo: Bool { local?.kind == "video" || cloud?.isVideo == true }
    var isLive: Bool { local?.isLive == true || cloud?.isLive == true }
}

/// Merge two bounded source cursors and apply the selected source filter
/// before committing a visible page. An empty result still advances the
/// checkpoint when the bounded search has more candidates.
@MainActor
final class XDriveIOSNativeUnifiedPhotoTimeline: ObservableObject {
    private enum Item {
        case local(XDrivePhotoKitScanCandidate)
        case cloud(XDriveIOSNativeMediaItem, Date?)

        var capturedAt: Date? {
            switch self {
            case .local(let row): return row.capturedAt
            case .cloud(_, let date): return date
            }
        }

        var provisional: XDriveIOSNativeUnifiedPhoto {
            switch self {
            case .local(let row):
                return .init(local: row, cloud: nil, match: nil, presence: .unverified, capturedAt: row.capturedAt)
            case .cloud(let item, let date):
                return .init(local: nil, cloud: item, match: nil, presence: .unverified, capturedAt: date)
            }
        }
    }

    @Published private(set) var rows: [XDriveIOSNativeUnifiedPhoto] = []
    @Published private(set) var next: XDriveIOSNativeGalleryCursor?
    @Published private(set) var loading = false
    @Published private(set) var notice: String?
    @Published private(set) var coverage: XDriveIOSNativePhotoFingerprintIndex.Coverage?
    @Published private(set) var indexRevision = UUID()

    private var owner: XDriveNativeOwnerRoot?
    private var epoch = UUID()
    private var libraryArchive: Data?
    private var indexTicket = UUID()
    private static let pageSize = 48
    private static let probeBatch = 8
    private static let searchLimit = 192

    func belongs(to current: XDriveNativeOwnerRoot?) -> Bool {
        guard let owner else { return false }
        return XDriveIOSNativePhotoOwnerScope.matches(current, owner)
    }

    func reset() {
        epoch = UUID()
        indexTicket = UUID()
        owner = nil
        libraryArchive = nil
        rows = []
        next = nil
        coverage = nil
        loading = false
        notice = nil
    }

    func scanLocal(login: XDriveIOSNativeOwnerLoginModel, retryUnavailable: Bool) async {
        guard let expected = login.owner, let library = try? XDriveIOSPhotoKitLibraryEpoch.capture() else { return }
        let ticket = UUID()
        indexTicket = ticket
        let index = XDriveIOSNativePhotoFingerprintIndex.shared
        do {
            let lease = try await index.bind(
                scope: XDriveIOSNativePhotoThumbnailCache.scope(for: expected), library: library.serialized
            )
            try await index.scan(lease: lease, retryUnavailable: retryUnavailable) { [weak self] status in
                await self?.publishCoverage(status, ticket: ticket, login: login, owner: expected)
            }
        } catch is CancellationError {
        } catch {
            guard indexTicket == ticket, !Task.isCancelled,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
            notice = "本机原件索引暂不可用。可继续浏览并刷新后重试。"
        }
    }

    private func publishCoverage(_ status: XDriveIOSNativePhotoFingerprintIndex.Coverage, ticket: UUID,
                                 login: XDriveIOSNativeOwnerLoginModel, owner: XDriveNativeOwnerRoot) {
        guard indexTicket == ticket, !Task.isCancelled,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        let advanced = status.finished && coverage?.finished != true
        coverage = status
        if advanced { indexRevision = UUID() }
    }

    func load(from start: XDriveIOSNativeGalleryCursor, filter: XDriveIOSNativeGalleryPresence?,
              login: XDriveIOSNativeOwnerLoginModel) async {
        guard let expected = login.owner else { reset(); return }
        if let owner, !XDriveIOSNativePhotoOwnerScope.matches(owner, expected) { reset() }
        owner = expected
        let ticket = UUID()
        epoch = ticket
        loading = true
        notice = nil
        rows = []
        next = nil
        defer { if epoch == ticket { loading = false } }

        var cursor = start
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if permission != .authorized && permission != .limited { cursor.localEnd = true }
        let localEpoch = try? XDriveIOSPhotoKitLibraryEpoch.capture()
        if cursor.local > 0, let libraryArchive,
           !XDriveIOSNativePhotoFingerprintIndex.isCurrent(libraryArchive) {
            notice = "本机照片已变化，请回到最新重新核对。"
            return
        }
        libraryArchive = localEpoch?.serialized
        let index = XDriveIOSNativePhotoFingerprintIndex.shared
        let lease: XDriveIOSNativePhotoFingerprintIndex.Lease?
        if let localEpoch {
            lease = try? await index.bind(scope: XDriveIOSNativePhotoThumbnailCache.scope(for: expected),
                                          library: localEpoch.serialized)
        } else {
            lease = nil
        }

        if filter == .cloudOnly {
            let complete: Bool
            if let lease {
                complete = (try? await index.coverage(lease: lease))?.provesAbsence == true
            } else {
                complete = false
            }
            guard current(ticket, login: login, owner: expected) else { return }
            guard complete else {
                notice = "本机图库核对完整后，才能确认哪些照片仅在云端。可在「待核验」中查看其他照片。"
                return
            }
        }
        let auth = try? await login.verifiedAuthorization()
        guard current(ticket, login: login, owner: expected) else { return }
        let reader: XDriveIOSNativeMediaGalleryReader?
        if let auth, XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) {
            reader = XDriveIOSNativeMediaGalleryReader(owner: expected, accessToken: auth.accessToken)
        } else {
            reader = nil
            cursor.cloudEnd = true
            notice = "云端暂不可用。重新连接后刷新图库可继续核对。"
        }

        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        do {
            let localTotal = cursor.localEnd ? cursor.local : try await scanner.start(atOffset: cursor.local)
            var local: ArraySlice<XDrivePhotoKitScanCandidate> = []
            var cloud: ArraySlice<Item> = []
            var visible: [XDriveIOSNativeUnifiedPhoto] = []
            var visited = 0
            var canMatch = reader != nil
            while visible.count < Self.pageSize && visited < Self.searchLimit && !cursor.finished {
                var window: [Item] = []
                let limit = min(Self.pageSize - visible.count, Self.searchLimit - visited)
                while window.count < limit && visited < Self.searchLimit {
                    try Task.checkCancellation()
                    if local.isEmpty && !cursor.localEnd {
                        local = try await scanner.nextPage().items[...]
                        cursor.localEnd = local.isEmpty
                    }
                    if cloud.isEmpty && !cursor.cloudEnd, let reader {
                        cloud = try await cloudWindow(reader, cursor: &cursor)
                    }
                    let localHead = local.first
                    let cloudHead = cloud.first
                    if let localHead,
                       cloudHead == nil || (localHead.capturedAt ?? .distantPast) >= (cloudHead?.capturedAt ?? .distantPast) {
                        cursor.local += 1
                        local = local.dropFirst()
                        cursor.localEnd = cursor.local >= localTotal
                        if localHead.kind != "unsupported" { window.append(.local(localHead)) }
                    } else if let cloudHead, case .cloud(let item, _) = cloudHead {
                        cursor.cloud += 1
                        cloud = cloud.dropFirst()
                        cursor.cloudAnchor = item.id
                        cursor.cloudAnchorRevision = item.node.revision
                        cursor.cloudEnd = cursor.cloud == cursor.cloudCount
                        window.append(cloudHead)
                    } else {
                        break
                    }
                    visited += 1
                }
                guard !window.isEmpty else { break }
                var resolved = window.map(\.provisional)
                guard current(ticket, login: login, owner: expected),
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission else { return }
                if filter == nil { rows = visible + resolved }
                if canMatch, let reader {
                    do {
                        resolved = try await reconcile(window, reader: reader, lease: lease)
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        canMatch = false
                    }
                }
                guard current(ticket, login: login, owner: expected),
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission else { return }
                if let localEpoch, !XDriveIOSNativePhotoFingerprintIndex.isCurrent(localEpoch.serialized) {
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
                visible.append(contentsOf: resolved.filter { filter == nil || $0.presence == filter })
                // Publish verified work as each small window returns, while
                // keeping paging disabled until the checkpoint commits.
                rows = visible
            }
            guard current(ticket, login: login, owner: expected) else { return }
            next = cursor.finished ? nil : cursor
            if reader != nil && !canMatch {
                notice = "暂时无法确认本机与云端的对应关系。请刷新或检查服务器版本。"
            }
        } catch is CancellationError {
        } catch {
            guard current(ticket, login: login, owner: expected) else { return }
            notice = "图库暂未完成读取或配对。可刷新后重试。"
        }
    }

    private func cloudWindow(_ reader: XDriveIOSNativeMediaGalleryReader,
                             cursor: inout XDriveIOSNativeGalleryCursor) async throws -> ArraySlice<Item> {
        let anchored = cursor.cloud > 0
        let slice = try await reader.page(offset: anchored ? cursor.cloud - 1 : 0)
        if anchored {
            guard slice.total_count == cursor.cloudCount,
                  slice.items.first?.id == cursor.cloudAnchor,
                  slice.items.first?.node.revision == cursor.cloudAnchorRevision else {
                throw XDriveIOSNativeMediaReadFailure.invalidPage
            }
        }
        cursor.cloudCount = slice.total_count
        let items = slice.items.dropFirst(anchored ? 1 : 0)
            .map { Item.cloud($0, Self.date($0.metadata.captured_at)) }
        cursor.cloudEnd = items.isEmpty
        return items[...]
    }

    private func reconcile(
        _ page: [Item], reader: XDriveIOSNativeMediaGalleryReader,
        lease: XDriveIOSNativePhotoFingerprintIndex.Lease?
    ) async throws -> [XDriveIOSNativeUnifiedPhoto] {
        let index = XDriveIOSNativePhotoFingerprintIndex.shared
        let locals = page.compactMap { item -> XDrivePhotoKitScanCandidate? in
            if case .local(let row) = item { return row }
            return nil
        }
        let clouds = page.compactMap { item -> XDriveIOSNativeMediaItem? in
            if case .cloud(let row, _) = item { return row }
            return nil
        }
        var localProbes: [String: XDriveIOSNativeExactPhotoProbe] = [:]
        var additions: [(String, XDriveIOSNativeExactPhotoProbe)] = []
        for candidate in locals {
            try Task.checkCancellation()
            if let lease, let cached = try await index.probe(id: candidate.id, lease: lease) {
                localProbes[candidate.id] = cached
            } else if let fresh = try? await XDriveIOSNativeExactPhotoProbe.read(candidate) {
                localProbes[candidate.id] = fresh
                additions.append((candidate.id, fresh))
            }
        }
        try Task.checkCancellation()
        if let lease { try await index.remember(additions, lease: lease) }
        let cloudProbes = try await fingerprints(clouds, reader: reader)
        let probes = Dictionary((Array(localProbes.values) + Array(cloudProbes.values)).compactMap { probe in
            probe.fingerprint.map { ($0, probe) }
        }, uniquingKeysWith: { first, _ in first })
        let windowIDs = Dictionary(grouping: localProbes.keys) { localProbes[$0]?.fingerprint ?? "" }
        var localIDs: [String: [String]] = [:]
        for (key, probe) in probes {
            if let lease {
                localIDs[key] = try await index.localIDs(for: probe, lease: lease)
            } else {
                localIDs[key] = windowIDs[key] ?? []
            }
        }
        // Cloud fingerprints with no local hit never initiate a global lookup.
        let keys = probes.keys.filter {
            windowIDs[$0]?.isEmpty == false || localIDs[$0]?.count == 1
        }.sorted()
        var matches: [String: XDriveIOSNativeExactPhotoMatch] = [:]
        for start in stride(from: 0, to: keys.count, by: Self.probeBatch) {
            let batch = Array(keys[start..<min(start + Self.probeBatch, keys.count)])
            let replies = try await reader.exactMatches(batch.compactMap { probes[$0] })
            for (key, reply) in zip(batch, replies) { matches[key] = reply }
        }
        let checkedAllLocal: Bool
        if let lease {
            checkedAllLocal = try await index.coverage(lease: lease)?.provesAbsence == true
        } else {
            checkedAllLocal = false
        }
        let cloudByNode = Dictionary(clouds.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return page.compactMap { item in
            switch item {
            case .local(let candidate):
                guard let key = localProbes[candidate.id]?.fingerprint, let match = matches[key] else {
                    return item.provisional
                }
                if match.state == .unmatched && !candidate.isLive {
                    return .init(local: candidate, cloud: nil, match: nil,
                                 presence: .localOnly, capturedAt: candidate.capturedAt)
                }
                guard localIDs[key] == [candidate.id] else { return item.provisional }
                if let node = match.node_id, cloudByNode[node].map(match.matches) ?? true {
                    return .init(local: candidate, cloud: cloudByNode[node], match: match,
                                 presence: .both, capturedAt: candidate.capturedAt)
                }
                return item.provisional
            case .cloud(let photo, let date):
                guard let key = cloudProbes[photo.id]?.fingerprint, let ids = localIDs[key] else {
                    return item.provisional
                }
                if ids.count == 1, let id = ids.first,
                   XDriveIOSNativePhotoProofStamp.current(id) != nil, matches[key]?.matches(photo) == true {
                    // The local row owns the timeline position even if its
                    // capture date places it in a different window.
                    return nil
                }
                if checkedAllLocal && ids.isEmpty {
                    return .init(local: nil, cloud: photo, match: nil, presence: .cloudOnly, capturedAt: date)
                }
                return item.provisional
            }
        }
    }

    private func fingerprints(_ clouds: [XDriveIOSNativeMediaItem], reader: XDriveIOSNativeMediaGalleryReader)
        async throws -> [UInt64: XDriveIOSNativeExactPhotoProbe] {
        let refs = clouds.compactMap(XDriveIOSNativeExactPhotoReference.init)
        var values: [UInt64: XDriveIOSNativeExactPhotoProbe] = [:]
        for start in stride(from: 0, to: refs.count, by: Self.probeBatch) {
            let batch = Array(refs[start..<min(start + Self.probeBatch, refs.count)])
            let reply = try await reader.exactFingerprints(batch)
            for (ref, probe) in zip(batch, reply) { values[ref.node_id] = probe }
        }
        return values
    }

    private func current(_ ticket: UUID, login: XDriveIOSNativeOwnerLoginModel, owner: XDriveNativeOwnerRoot) -> Bool {
        epoch == ticket && !Task.isCancelled && XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value))
            ?? (try? Date.ISO8601FormatStyle().parse(value))
    }
}
