import CryptoKit
import Foundation
import Photos

/// PhotoKit iOS 16+ incremental *discovery* source. This actor only records
/// candidate IDs, never exports originals, changes upload receipts, invokes
/// UploadSession or promises that the queued asset has reached the Server.
/// Its exact Owner/root is fixed for the actor lifetime; the caller must also
/// reverify the current native Owner before consuming candidates.
actor XDriveIOSPhotoKitPersistentBackupQueue {
    enum Failure: Error {
        case invalidOwner
        case unauthorizedOrChanged
        case requiresExplicitBaseline
        case invalidArchivedToken
        case invalidReplayLimit
    }

    struct Replay: Equatable {
        var inserted = 0
        var updated = 0
        var deleted = 0
        var events = 0
    }

    private let scope: String
    private let store: XDriveIOSPhotoBackupChangeQueueStore

    init(owner: XDriveNativeOwnerRoot) throws {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty else { throw Failure.invalidOwner }
        let scope = Self.ownerScope(owner)
        self.scope = scope
        guard let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        ).first else { throw Failure.invalidOwner }
        let directory = appSupport.appendingPathComponent(
            "PhotoBackupChangeQueues", isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        let database = directory.appendingPathComponent(scope + ".sqlite3")
        self.store = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: database)
    }

    /// Create an explicit new-only capture baseline only after authenticated
    /// opt-in. If an old baseline exists, do not overwrite it: moving a token
    /// forward without replay would permanently lose skipped PhotoKit edits.
    func installNewOnlyBaseline(owner: XDriveNativeOwnerRoot) throws -> Bool {
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        let installed = try store.installBaselineIfAbsent(
            token: epoch.serialized, authorization: epoch.authorization
        )
        try verifyAuthorization(stillMatches: epoch)
        return installed
    }

    /// Read only, bounded to 64 candidate IDs per call. Priority is freshly
    /// inserted originals, then previously edited originals; every candidate
    /// still requires current authorized PHAsset + exact Server receipt proof.
    func pending(owner: XDriveNativeOwnerRoot, limit: Int = 64) throws
        -> [XDriveIOSPhotoBackupChangeQueueStore.Pending] {
        try verifyOwner(owner)
        return try store.pending(limit: limit)
    }

    /// Durable capture from PhotoKit's persistent change history. Every
    /// PHPersistentChange changeToken and its inserted/updated/deleted asset
    /// IDs are committed together. Expired/unavailable history is propagated
    /// to the caller for a conservative full-library reconciliation; NEVER
    /// replace the baseline token or report those assets as backed up.
    func replay(owner: XDriveNativeOwnerRoot,
                maximumEvents: Int = 2) throws -> Replay {
        guard (1...4).contains(maximumEvents) else {
            throw Failure.invalidReplayLimit
        }
        try verifyOwner(owner)
        guard let original = try store.baseline() else {
            throw Failure.requiresExplicitBaseline
        }
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard original.authorization == epoch.authorization else {
            throw Failure.unauthorizedOrChanged
        }
        guard let token = try NSKeyedUnarchiver.unarchivedObject(
            ofClass: PHPersistentChangeToken.self, from: original.token
        ) else { throw Failure.invalidArchivedToken }
        // Apple's fetch result is a Sequence of change records; do not flatten
        // 100k asset identifiers into a new unbounded in-memory Swift array.
        let changes = try PHPhotoLibrary.shared().fetchPersistentChanges(since: token)
        var previousToken = original.token
        var progress = Replay()
        for change in changes {
            try Task.checkCancellation()
            try verifyAuthorization(stillMatches: epoch)
            let details = try change.changeDetails(for: .asset)
            let nextToken = try NSKeyedArchiver.archivedData(
                withRootObject: change.changeToken, requiringSecureCoding: true
            )
            // Only a verified, unchanged authorized library generation may
            // write the next token. The SQLite store transaction ensures a
            // crash never moves it ahead of queued IDs.
            try verifyAuthorization(stillMatches: epoch)
            let applied = try store.apply(
                inserted: details.insertedLocalIdentifiers,
                updated: details.updatedLocalIdentifiers,
                deleted: details.deletedLocalIdentifiers,
                expectedToken: previousToken, nextToken: nextToken,
                authorization: epoch.authorization
            )
            previousToken = nextToken
            progress.inserted += applied.inserted
            progress.updated += applied.updated
            progress.deleted += applied.deleted
            progress.events += 1
            // The saved per-record token is the next replay checkpoint.
            // Never traverse an unbounded change history in one auto tick.
            if progress.events >= maximumEvents { break }
        }
        try verifyAuthorization(stillMatches: epoch)
        return progress
    }

    private func verifyOwner(_ owner: XDriveNativeOwnerRoot) throws {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty,
              Self.ownerScope(owner) == scope else { throw Failure.invalidOwner }
    }

    private func verifyAuthorization(
        stillMatches initial: XDriveIOSPhotoKitLibraryEpoch.Snapshot
    ) throws {
        let current = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard current.authorization == initial.authorization,
              XDriveIOSPhotoKitLibraryEpoch.matches(
                initial.serialized, as: current.token
              ) else { throw Failure.unauthorizedOrChanged }
    }

    private static func ownerScope(_ owner: XDriveNativeOwnerRoot) -> String {
        let identity = owner.origin.absoluteString + "\n" + owner.instanceID +
            "\n" + String(owner.ownerID) + "\n" + String(owner.rootNodeID)
        return SHA256.hash(data: Data(identity.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }
}
