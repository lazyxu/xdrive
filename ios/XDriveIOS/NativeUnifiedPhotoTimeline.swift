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

/// Two independently bounded source cursors. The merged page never retains
/// a full PhotoKit list, Cloud gallery list, or full-size original in memory.
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
    }

    @Published private(set) var rows: [XDriveIOSNativeUnifiedPhoto] = []
    @Published private(set) var next: XDriveIOSNativeGalleryCursor?
    @Published private(set) var loading = false
    @Published private(set) var checking = false
    @Published private(set) var notice: String?

    private var owner: XDriveNativeOwnerRoot?
    private var epoch = UUID()
    private var window: [Item] = []
    private var proofs: [String: XDriveIOSNativeExactPhotoMatch] = [:]
    private var proofOrder: [String] = []
    private var currentProofs: Set<String> = []
    private var libraryArchive: Data?
    private var fullLocalAccess = false
    private var localCount: Int?
    private static let pageSize = 48
    private static let probeBatch = 4
    private static let proofLimit = 512

    func belongs(to current: XDriveNativeOwnerRoot?) -> Bool {
        guard let owner else { return false }
        return XDriveIOSNativePhotoOwnerScope.matches(current, owner)
    }

    func reset() {
        epoch = UUID()
        owner = nil
        window = []
        rows = []
        proofs = [:]
        proofOrder = []
        currentProofs = []
        libraryArchive = nil
        localCount = nil
        next = nil
        loading = false
        checking = false
        notice = nil
    }

    func load(from start: XDriveIOSNativeGalleryCursor, login: XDriveIOSNativeOwnerLoginModel) async {
        guard let expected = login.owner else { reset(); return }
        if !belongs(to: expected) { reset() }
        owner = expected
        let ticket = UUID()
        epoch = ticket
        loading = true
        checking = false
        notice = nil
        defer {
            if epoch == ticket { loading = false; checking = false }
        }
        var cursor = start
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        fullLocalAccess = permission == .authorized
        if permission != .authorized && permission != .limited { cursor.localEnd = true }
        currentProofs = []
        let localEpoch = try? XDriveIOSPhotoKitLibraryEpoch.capture()
        if !fullLocalAccess || localEpoch.map({
            XDriveIOSPhotoKitLibraryEpoch.matches(libraryArchive, as: $0.token)
        }) != true {
            proofs = [:]
            proofOrder = []
            localCount = nil
            if libraryArchive != nil && cursor.local > 0 {
                notice = "本机照片已变化，请回到最新重新核对。"
                return
            }
        }
        libraryArchive = localEpoch?.serialized

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
            var local: ArraySlice<XDrivePhotoKitScanCandidate> = []
            var cloud: ArraySlice<Item> = []
            var localTotal = cursor.local
            var cloudTotal = cursor.cloudCount ?? cursor.cloud
            var page: [Item] = []
            if !cursor.localEnd {
                localTotal = try await scanner.start(atOffset: cursor.local)
                localCount = localTotal
            }
            while page.count < Self.pageSize {
                try Task.checkCancellation()
                if local.isEmpty && !cursor.localEnd {
                    let slice = try await scanner.nextPage()
                    local = slice.items[...]
                    cursor.localEnd = local.isEmpty
                }
                if cloud.isEmpty && !cursor.cloudEnd, let reader {
                    let anchored = cursor.cloud > 0
                    let slice = try await reader.page(offset: anchored ? cursor.cloud - 1 : 0)
                    if anchored {
                        guard slice.total_count == cursor.cloudCount,
                              slice.items.first?.id == cursor.cloudAnchor,
                              slice.items.first?.node.revision == cursor.cloudAnchorRevision else {
                            throw XDriveIOSNativeMediaReadFailure.invalidPage
                        }
                    }
                    cloudTotal = slice.total_count
                    cursor.cloudCount = cloudTotal
                    cloud = slice.items.dropFirst(anchored ? 1 : 0)
                        .map { Item.cloud($0, Self.date($0.metadata.captured_at)) }[...]
                    cursor.cloudEnd = cloud.isEmpty
                }
                let localHead = local.first
                let cloudHead = cloud.first
                if let localHead,
                   cloudHead == nil || (localHead.capturedAt ?? .distantPast) >= (cloudHead?.capturedAt ?? .distantPast) {
                    cursor.local += 1
                    local = local.dropFirst()
                    cursor.localEnd = cursor.local >= localTotal
                    if localHead.kind != "unsupported" { page.append(.local(localHead)) }
                } else if let cloudHead {
                    cursor.cloud += 1
                    cloud = cloud.dropFirst()
                    if case .cloud(let item, _) = cloudHead {
                        cursor.cloudAnchor = item.id
                        cursor.cloudAnchorRevision = item.node.revision
                    }
                    cursor.cloudEnd = cursor.cloud >= cloudTotal
                    page.append(cloudHead)
                } else {
                    break
                }
            }
            guard current(ticket, login: login, owner: expected) else { return }
            window = page
            next = cursor.finished ? nil : cursor
            publish()
            loading = false
            if let reader {
                checking = true
                try await reconcile(page, reader: reader, ticket: ticket, login: login,
                                    owner: expected, library: localEpoch?.serialized)
            }
        } catch is CancellationError {
        } catch {
            guard current(ticket, login: login, owner: expected) else { return }
            notice = "图库暂未完成读取或配对。可刷新后重试。"
        }
    }

    private func reconcile(
        _ page: [Item], reader: XDriveIOSNativeMediaGalleryReader, ticket: UUID,
        login: XDriveIOSNativeOwnerLoginModel, owner: XDriveNativeOwnerRoot, library: Data?
    ) async throws {
        let locals = page.compactMap { item -> XDrivePhotoKitScanCandidate? in
            if case .local(let row) = item { return row }
            return nil
        }
        let memo = XDriveIOSNativePhotoMatchMemo.shared
        let memoTicket: UUID?
        if let library {
            memoTicket = await memo.bind(
                scope: XDriveIOSNativePhotoThumbnailCache.scope(for: owner), library: library
            )
        } else {
            memoTicket = nil
        }
        for start in stride(from: 0, to: locals.count, by: Self.probeBatch) {
            var probes: [XDriveIOSNativeExactPhotoProbe] = []
            var candidates: [XDrivePhotoKitScanCandidate] = []
            let end = min(start + Self.probeBatch, locals.count)
            for candidate in locals[start..<end] {
                try Task.checkCancellation()
                // Evicted iCloud originals and unsupported or oversized
                // originals stay unknown; no thumbnail/name inference.
                let saved: XDriveIOSNativeExactPhotoProbe?
                if let memoTicket {
                    saved = await memo.probe(localID: candidate.id, ticket: memoTicket)
                } else {
                    saved = nil
                }
                if let saved {
                    probes.append(saved)
                    candidates.append(candidate)
                } else if let probe = try? await XDriveIOSNativeExactPhotoProbe.read(candidate) {
                    probes.append(probe)
                    candidates.append(candidate)
                }
            }
            guard current(ticket, login: login, owner: owner) else { return }
            if probes.isEmpty { continue }
            let matches = try await reader.exactMatches(probes)
            guard current(ticket, login: login, owner: owner) else { return }
            if let library {
                guard let epoch = try? XDriveIOSPhotoKitLibraryEpoch.capture(),
                      XDriveIOSPhotoKitLibraryEpoch.matches(library, as: epoch.token) else {
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
            }
            var verifiedProbes: [(String, XDriveIOSNativeExactPhotoProbe)] = []
            for (index, candidate) in candidates.enumerated() {
                guard let stamp = XDriveIOSNativePhotoProofStamp.current(candidate.id),
                      stamp.modifiedAt == candidate.modifiedAt, stamp.createdAt == candidate.capturedAt,
                      stamp.kind == candidate.kind, stamp.isLive == candidate.isLive else { continue }
                remember(matches[index], for: candidate.id)
                currentProofs.insert(candidate.id)
                verifiedProbes.append((candidate.id, probes[index]))
            }
            publish()
            if let memoTicket { await memo.remember(verifiedProbes, ticket: memoTicket) }
            await Task.yield()
        }
    }

    private func remember(_ match: XDriveIOSNativeExactPhotoMatch, for id: String) {
        proofOrder.removeAll { $0 == id }
        proofs[id] = match
        proofOrder.append(id)
        if proofOrder.count > Self.proofLimit {
            proofs[proofOrder.removeFirst()] = nil
        }
    }

    private func publish() {
        let cloudItems = window.compactMap { row -> XDriveIOSNativeMediaItem? in
            if case .cloud(let item, _) = row { return item }
            return nil
        }
        let cloudByNode = Dictionary(cloudItems.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var claims: [UInt64: [XDriveIOSNativeExactPhotoMatch]] = [:]
        for proof in proofs.values where proof.state == .matched {
            if let node = proof.node_id { claims[node, default: []].append(proof) }
        }
        // Absence is evidence only after the full accessible local snapshot
        // has been checked, including an empty authorized library.
        let checkedAllLocal = fullLocalAccess && localCount == proofs.count &&
            !proofs.values.contains(where: { $0.state == .ambiguous })
        rows = window.compactMap { item in
            switch item {
            case .local(let candidate):
                let proof = currentProofs.contains(candidate.id) ? proofs[candidate.id] : nil
                if let proof, let node = proof.node_id, claims[node]?.count == 1,
                   cloudByNode[node].map(proof.matches) ?? true {
                    return XDriveIOSNativeUnifiedPhoto(
                        local: candidate, cloud: cloudByNode[node], match: proof,
                        presence: .both, capturedAt: candidate.capturedAt
                    )
                }
                return XDriveIOSNativeUnifiedPhoto(
                    local: candidate, cloud: nil, match: nil,
                    // A managed Live ZIP can still exist in backup storage
                    // before the Server projects its two gallery resources.
                    presence: proof?.state == .unmatched && !candidate.isLive ? .localOnly : .unverified,
                    capturedAt: candidate.capturedAt
                )
            case .cloud(let item, let date):
                if let proof = claims[item.id], proof.count == 1, proof[0].matches(item) { return nil }
                return XDriveIOSNativeUnifiedPhoto(
                    local: nil, cloud: item, match: nil,
                    presence: checkedAllLocal && claims[item.id] == nil ? .cloudOnly : .unverified,
                    capturedAt: date
                )
            }
        }
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
