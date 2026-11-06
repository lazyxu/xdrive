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

        var provesAbsence: Bool { finished && checked == total && unavailable == 0 }
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
            let invalidated = try saved.flatMap { try Self.changedIDs(since: $0.library, through: token) }
            guard Self.isCurrent(library) else { throw XDrivePhotoKitScanFailure.snapshotChanged }
            try currentStore.begin(library: library, invalidate: invalidated)
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
        return Coverage(checked: checked, total: checked, unavailable: unavailable, finished: true)
    }

    /// Read only one 64-slot PhotoKit page at a time. Interruption leaves
    /// individual fingerprints durable, but absence is unverified until a
    /// complete traversal of the current authorized generation.
    func scan(lease expected: Lease, retryUnavailable: Bool,
              progress: @Sendable (Coverage) async -> Void) async throws {
        if let saved = try coverage(lease: expected), saved.provesAbsence || !retryUnavailable {
            await progress(saved)
            return
        }
        guard scanning == nil else { return }
        scanning = expected.ticket
        defer { if scanning == expected.ticket { scanning = nil } }
        let scanner = XDrivePhotoKitBoundedSnapshotScanner()
        _ = try await scanner.start()
        var checked = 0
        var unavailable = 0
        while true {
            try Task.checkCancellation()
            let page = try await scanner.nextPage()
            _ = try database(expected)
            var additions: [(String, XDriveIOSNativeExactPhotoProbe)] = []
            for candidate in page.items where candidate.kind != "unsupported" {
                try Task.checkCancellation()
                checked += 1
                if try probe(id: candidate.id, lease: expected) != nil { continue }
                do {
                    additions.append((candidate.id, try await XDriveIOSNativeExactPhotoProbe.read(candidate)))
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    unavailable += 1
                }
            }
            try remember(additions, lease: expected)
            if page.finished {
                try database(expected).finish(checked: checked, unavailable: unavailable)
                await progress(Coverage(checked: checked, total: checked, unavailable: unavailable, finished: true))
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
