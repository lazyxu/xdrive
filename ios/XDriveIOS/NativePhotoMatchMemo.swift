import Foundation
import Photos

/// Local original identity persists across paging and application launches.
/// All reads and writes are bound to one Owner and the current PhotoKit
/// generation. Coverage is separate from a positive fingerprint match.
actor XDriveIOSNativePhotoFingerprintIndex {
    static let shared = XDriveIOSNativePhotoFingerprintIndex()

    struct Lease: Equatable, Sendable {
        let ticket: UUID
        let library: Data
    }

    struct Coverage: Sendable {
        let checked: Int
        let total: Int
        let unavailable: Int
        let finished: Bool
        var unavailableByKind: [String: Int]? = nil

        var provesAbsence: Bool { finished && checked == total && unavailable == 0 }
        func provesAbsence(for kind: String) -> Bool {
            provesAbsence || (finished && checked == total && unavailableByKind?[kind] == 0)
        }
    }

    private var activeScope: String?
    private var lease: Lease?
    private var store: XDriveIOSNativePhotoFingerprintStore?
    private var scanning: UUID?

    func bind(scope: String, library: Data) throws -> Lease {
        guard Self.isCurrent(library) else { throw XDrivePhotoKitScanFailure.snapshotChanged }
        if activeScope == scope, let lease,
           XDriveIOSPhotoKitLibraryEpoch.matches(lease.library, as: PHPhotoLibrary.shared().currentChangeToken) {
            return lease
        }
        let currentStore = try Self.open(scope: scope)
        let saved = try currentStore.state()
        let token = PHPhotoLibrary.shared().currentChangeToken
        if !XDriveIOSPhotoKitLibraryEpoch.matches(saved?.library, as: token) {
            let changed = try saved.flatMap { try Self.changedIDs(since: $0.library, through: token) }
            guard Self.isCurrent(library) else { throw XDrivePhotoKitScanFailure.snapshotChanged }
            if let changed, changed.isEmpty {
                // An album-only PhotoKit change cannot invalidate identical
                // original bytes or a completed asset inventory.
                try currentStore.advanceWithoutAssetChanges(library: library)
            } else if let changed, changed.count <= 128,
                      try currentStore.hasCompleteInventory() {
                let entries = Self.changedAssets(changed)
                // Compare with PhotoKit's typed lazy query, not untrusted
                // cached counts or a list of filenames.
                let supported = PHAsset.fetchAssets(with: .image, options: nil).count +
                    PHAsset.fetchAssets(with: .video, options: nil).count
                guard Self.isCurrent(library) else { throw XDrivePhotoKitScanFailure.snapshotChanged }
                do {
                    try currentStore.prepareIncremental(
                        library: library, changed: entries, expectedCount: supported
                    )
                } catch XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord {
                    // A legacy or inconsistent database cannot prove absence
                    // from a delta. Keep reusable hashes, but rebuild coverage.
                    try currentStore.begin(library: library, invalidate: changed)
                }
            } else {
                // Expired/incomplete PhotoKit history or a large batch: fail
                // closed to a full inventory, reusing unchanged fingerprints.
                try currentStore.begin(library: library, invalidate: changed)
            }
        }
        guard Self.isCurrent(library) else { throw XDrivePhotoKitScanFailure.snapshotChanged }
        let value = Lease(ticket: UUID(), library: library)
        activeScope = scope
        store = currentStore
        lease = value
        scanning = nil
        return value
    }

    func probe(id: String, lease expected: Lease) throws -> XDriveIOSNativeExactPhotoProbe? {
        guard let data = try database(expected).probe(id: id) else { return nil }
        let probe = try JSONDecoder().decode(XDriveIOSNativeExactPhotoProbe.self, from: data)
        guard probe.fingerprint != nil else { throw XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord }
        return probe
    }

    func remember(_ entries: [(String, XDriveIOSNativeExactPhotoProbe)], lease expected: Lease) throws {
        let encoded = try entries.map { id, probe -> (id: String, fingerprint: String, probe: Data) in
            guard let fingerprint = probe.fingerprint else { throw XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord }
            return (id, fingerprint, try JSONEncoder().encode(probe))
        }
        try database(expected).record(encoded)
    }

    func localIDs(for probe: XDriveIOSNativeExactPhotoProbe, lease expected: Lease) throws -> [String] {
        guard let fingerprint = probe.fingerprint else { throw XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord }
        return try database(expected).localIDs(fingerprint: fingerprint)
    }

    func coverage(lease expected: Lease) throws -> Coverage? {
        guard let state = try database(expected).state(),
              let checked = state.checked, let unavailable = state.unavailable else { return nil }
        return Coverage(checked: checked, total: checked, unavailable: unavailable, finished: true,
                        unavailableByKind: state.unavailableByKind)
    }

    /// Read changed PhotoKit originals only. A bounded delta is a durable,
    /// incomplete journal until every affected item is hashed or explicitly
    /// marked unavailable, never a temporary proof of cloud-only absence.
    private func finishPending(lease expected: Lease,
                               progress: @Sendable (Coverage) async -> Void) async throws {
        while true {
            try Task.checkCancellation()
            guard let work = try database(expected).incrementalWork() else {
                throw XDrivePhotoKitScanFailure.snapshotChanged
            }
            if work.assets.isEmpty {
                let saved = try database(expected).finishIncremental()
                guard let checked = saved.checked, let unavailable = saved.unavailable else {
                    throw XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord
                }
                await progress(Coverage(checked: checked, total: checked, unavailable: unavailable,
                                        finished: true, unavailableByKind: saved.unavailableByKind))
                return
            }
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: work.assets.map(\.id), options: nil)
            var byID: [String: PHAsset] = [:]
            assets.enumerateObjects { asset, _, _ in byID[asset.localIdentifier] = asset }
            var completed: [XDriveIOSNativePhotoFingerprintStore.ResolvedAsset] = []
            for item in work.assets {
                try Task.checkCancellation()
                guard let asset = byID[item.id],
                      Self.kind(of: asset) == item.kind else {
                    throw XDrivePhotoKitScanFailure.snapshotChanged
                }
                let candidate = XDrivePhotoKitScanCandidate(
                    id: item.id,
                    kind: asset.mediaType == .video ? "video" : "image",
                    isLive: item.kind == "live_photo",
                    capturedAt: asset.creationDate, modifiedAt: asset.modificationDate
                )
                do {
                    let value = try await XDriveIOSNativeExactPhotoProbe.read(candidate)
                    guard value.kind == item.kind, let fingerprint = value.fingerprint else {
                        throw XDrivePhotoKitScanFailure.snapshotChanged
                    }
                    completed.append(.init(id: item.id, kind: item.kind,
                                           fingerprint: fingerprint, probe: try JSONEncoder().encode(value)))
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    // Includes iCloud-only originals when network access is
                    // disabled. Unreadability never becomes a positive match.
                    completed.append(.init(id: item.id, kind: item.kind,
                                           fingerprint: nil, probe: nil))
                }
            }
            try Task.checkCancellation()
            try database(expected).resolvePending(completed)
            await progress(Coverage(checked: work.checked + completed.count, total: work.total,
                                    unavailable: 0, finished: false))
            await Task.yield()
        }
    }

    /// A full 64-slot scan remains the safe fallback for a legacy index,
    /// expired PhotoKit history, or a batch exceeding the delta budget.
    /// Unchanged SHA-256 proofs are reused; all source IDs are inventoried.
    func scan(lease expected: Lease, retryUnavailable: Bool,
              progress: @Sendable (Coverage) async -> Void) async throws {
        let saved = try coverage(lease: expected)
        if let saved, saved.provesAbsence || !retryUnavailable {
            await progress(saved)
            return
        }
        guard scanning == nil else { return }
        scanning = expected.ticket
        defer { if scanning == expected.ticket { scanning = nil } }

        if retryUnavailable, saved != nil {
            _ = try database(expected).prepareUnavailableRetry()
        }
        if try database(expected).incrementalWork() != nil {
            try await finishPending(lease: expected, progress: progress)
            return
        }

        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        _ = try await scanner.start()
        try database(expected).startFullInventory()
        var checked = 0
        var unavailable = 0
        while true {
            try Task.checkCancellation()
            let page = try await scanner.nextPage()
            _ = try database(expected)
            var additions: [(String, XDriveIOSNativeExactPhotoProbe)] = []
            var inventory: [XDriveIOSNativePhotoFingerprintStore.InventoryEntry] = []
            for candidate in page.items where candidate.kind != "unsupported" {
                try Task.checkCancellation()
                checked += 1
                let kind = candidate.isLive ? "live_photo" : candidate.kind
                if let cached = try probe(id: candidate.id, lease: expected), cached.kind == kind {
                    inventory.append(.init(id: candidate.id, kind: kind, readable: true))
                    continue
                }
                do {
                    let value = try await XDriveIOSNativeExactPhotoProbe.read(candidate)
                    guard value.kind == kind else { throw XDrivePhotoKitScanFailure.snapshotChanged }
                    additions.append((candidate.id, value))
                    inventory.append(.init(id: candidate.id, kind: kind, readable: true))
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    unavailable += 1
                    inventory.append(.init(id: candidate.id, kind: kind, readable: false))
                }
            }
            try remember(additions, lease: expected)
            try database(expected).recordInventory(inventory)
            if page.finished {
                let complete = try database(expected).finishFullInventory(checked: checked)
                guard let unavailable = complete.unavailable else {
                    throw XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord
                }
                await progress(Coverage(checked: checked, total: checked, unavailable: unavailable,
                                        finished: true, unavailableByKind: complete.unavailableByKind))
                return
            }
            await progress(Coverage(checked: checked, total: page.totalAccessibleAssets,
                                    unavailable: unavailable, finished: false))
            await Task.yield()
        }
    }

    private func database(_ expected: Lease) throws -> XDriveIOSNativePhotoFingerprintStore {
        guard expected == lease, let store, Self.isCurrent(expected.library) else {
            throw XDrivePhotoKitScanFailure.snapshotChanged
        }
        return store
    }

    static func isCurrent(_ library: Data) -> Bool {
        let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return permission == .authorized &&
            XDriveIOSPhotoKitLibraryEpoch.matches(library, as: PHPhotoLibrary.shared().currentChangeToken) &&
            PHPhotoLibrary.authorizationStatus(for: .readWrite) == permission
    }

    private static func kind(of asset: PHAsset) -> String? {
        switch asset.mediaType {
        case .image:
            return asset.mediaSubtypes.contains(.photoLive) ? "live_photo" : "image"
        case .video:
            return "video"
        default:
            return nil
        }
    }

    private static func changedAssets(_ ids: Set<String>) ->
        [XDriveIOSNativePhotoFingerprintStore.ChangedAsset] {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: Array(ids), options: nil)
        var found: [String: String] = [:]
        result.enumerateObjects { asset, _, _ in
            if let kind = kind(of: asset) { found[asset.localIdentifier] = kind }
        }
        return ids.sorted().map {
            XDriveIOSNativePhotoFingerprintStore.ChangedAsset(id: $0, kind: found[$0])
        }
    }

    /// Preserve unchanged hashes on ordinary edits, but reject incomplete
    /// replay, expired tokens and excessively large event sets.
    private static func changedIDs(since data: Data, through current: PHPersistentChangeToken) throws -> Set<String>? {
        do {
            guard let token = try NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: data) else { return nil }
            var invalidated: Set<String> = []
            for (index, change) in try PHPhotoLibrary.shared().fetchPersistentChanges(since: token).enumerated() {
                try Task.checkCancellation()
                guard index < 8 else { return nil }
                let details = try change.changeDetails(for: .asset)
                let affected = details.insertedLocalIdentifiers.count + details.updatedLocalIdentifiers.count +
                    details.deletedLocalIdentifiers.count
                guard affected <= 4096 - invalidated.count else { return nil }
                invalidated.formUnion(details.insertedLocalIdentifiers)
                invalidated.formUnion(details.updatedLocalIdentifiers)
                invalidated.formUnion(details.deletedLocalIdentifiers)
                if change.changeToken.isEqual(current) { return invalidated }
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return nil
        }
        return nil
    }

    private static func open(scope: String) throws -> XDriveIOSNativePhotoFingerprintStore {
        guard scope.utf8.count == 64, scope.utf8.allSatisfy({
            (48...57).contains($0) || (97...102).contains($0)
        }) else { throw CocoaError(.fileReadInvalidFileName) }
        let manager = FileManager.default
        var folder = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("xdrive-gallery-fingerprints-v2", isDirectory: true)
        try manager.createDirectory(at: folder, withIntermediateDirectories: true,
                                    attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.complete])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        let file = folder.appendingPathComponent(scope + ".sqlite")
        if !manager.fileExists(atPath: file.path) {
            guard manager.createFile(atPath: file.path, contents: nil,
                                     attributes: [.posixPermissions: 0o600, .protectionKey: FileProtectionType.complete]) else {
                throw CocoaError(.fileWriteUnknown)
            }
        }
        let properties = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard properties.isRegularFile == true, properties.isSymbolicLink != true else {
            throw CocoaError(.fileReadInvalidFileName)
        }
        return try XDriveIOSNativePhotoFingerprintStore(fileURL: file)
    }
}
