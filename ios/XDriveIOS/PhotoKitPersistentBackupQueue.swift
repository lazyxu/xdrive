import CryptoKit
import Foundation
import Photos

/// PhotoKit iOS 16+ incremental change queue. It discovers candidates and
/// exposes bounded metadata to the existing original backup runner; it never
/// uploads, changes Server receipts or grants a second write path. The runner
/// must reverify the current native Owner and use the shared CAS/receipt writer.
actor XDriveIOSPhotoKitPersistentBackupQueue {
    enum Failure: Error {
        case invalidOwner
        case unauthorizedOrChanged
        case authorizationChanged
        case requiresExplicitBaseline
        case invalidArchivedToken
        case historyUnavailable
        case invalidReplayLimit
    }

    struct Replay: Equatable {
        var inserted = 0
        var updated = 0
        var deleted = 0
        var events = 0
    }

    struct Candidate: Equatable {
        let pending: XDriveIOSPhotoBackupChangeQueueStore.Pending
        let kind: String
        let isLive: Bool
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

    /// Return only bounded candidates after PhotoKit's current change token
    /// has been fully replayed into SQLite. If history is still behind, the
    /// caller must leave the queue untouched and try on a later tick.
    func pendingCandidates(owner: XDriveNativeOwnerRoot, limit: Int = 64)
        throws -> [Candidate] {
        guard (1...64).contains(limit) else { throw Failure.invalidReplayLimit }
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else { return [] }
        guard baseline.authorization == epoch.authorization else {
            throw Failure.unauthorizedOrChanged
        }
        guard XDriveIOSPhotoKitLibraryEpoch.matches(
            baseline.token, as: epoch.token
        ) else {
            // More persistent changes remain than the bounded replay pass
            // consumed. Never upload stale candidate revisions.
            return []
        }
        let pending = try store.pending(limit: limit)
        guard !pending.isEmpty else { return [] }
        let identifiers = pending.map(\.localIdentifier)
        let fetched = PHAsset.fetchAssets(
            withLocalIdentifiers: identifiers, options: nil
        )
        var assets: [String: PHAsset] = [:]
        assets.reserveCapacity(fetched.count)
        fetched.enumerateObjects { asset, _, _ in
            assets[asset.localIdentifier] = asset
        }
        try verifyAuthorization(stillMatches: epoch)
        return pending.compactMap { row in
            guard let asset = assets[row.localIdentifier] else {
                // Missing from the currently authorized fetch is not proof of
                // deletion under Limited access. Persistent delete events
                // alone move the row to missingLocal.
                return nil
            }
            let kind: String
            switch asset.mediaType {
            case .image: kind = "image"
            case .video: kind = "video"
            default: kind = "unsupported"
            }
            return Candidate(
                pending: row, kind: kind,
                isLive: kind == "image" &&
                    asset.mediaSubtypes.contains(.photoLive)
            )
        }
    }

    /// Read the explicitly selected PhotoKit revision with an indexed lookup.
    /// An item beyond the first 64 auto-queue candidates must still be found.
    /// This creates no upload receipt and never rebases missing history.
    func pendingForSingle(
        owner: XDriveNativeOwnerRoot, localIdentifier: String
    ) throws -> XDriveIOSPhotoBackupChangeQueueStore.Pending? {
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else { return nil }
        guard baseline.authorization == epoch.authorization else {
            throw Failure.unauthorizedOrChanged
        }
        guard XDriveIOSPhotoKitLibraryEpoch.matches(
            baseline.token, as: epoch.token
        ) else {
            // A PhotoKit change is not yet replayed: leave its revision pending.
            return nil
        }
        guard let status = try store.status(for: localIdentifier),
              status.state == .pending else { return nil }
        let fetched = PHAsset.fetchAssets(
            withLocalIdentifiers: [localIdentifier], options: nil
        )
        guard fetched.firstObject != nil else { return nil }
        try verifyAuthorization(stillMatches: epoch)
        // Priority is ignored by the exact-ID, exact-revision CAS settlement.
        return XDriveIOSPhotoBackupChangeQueueStore.Pending(
            localIdentifier: localIdentifier,
            revision: status.revision, priority: 0
        )
    }

    /// Settle one exact queued revision only after the caller's shared
    /// original writer has verified the current Server Node receipt. A newer
    /// PhotoKit edit or an unreplayed change invalidates the settlement.
    @discardableResult
    func settle(_ candidate: XDriveIOSPhotoBackupChangeQueueStore.Pending,
                result: XDriveIOSPhotoBackupChangeQueueStore.Settled,
                owner: XDriveNativeOwnerRoot) throws -> Bool {
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else {
            throw Failure.requiresExplicitBaseline
        }
        guard baseline.authorization == epoch.authorization,
              XDriveIOSPhotoKitLibraryEpoch.matches(
                baseline.token, as: epoch.token
              ) else { throw Failure.unauthorizedOrChanged }
        try verifyAuthorization(stillMatches: epoch)
        return try store.settle(
            candidate, result: result,
            expectedBaselineToken: baseline.token,
            authorization: epoch.authorization
        )
    }

    /// Explicitly requeue at most 64 item-local failures. The original
    /// writer only stores .failed when it proved that no ambiguous Server
    /// mutation occurred; unknown ACKs remain blocked by receipt review.
    func retryFailedCandidates(owner: XDriveNativeOwnerRoot,
                               limit: Int = 64) throws -> Int {
        guard (1...64).contains(limit) else { throw Failure.invalidReplayLimit }
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else {
            throw Failure.requiresExplicitBaseline
        }
        guard baseline.authorization == epoch.authorization,
              XDriveIOSPhotoKitLibraryEpoch.matches(
                baseline.token, as: epoch.token
              ) else { throw Failure.unauthorizedOrChanged }
        let failed = try store.failed(limit: limit)
        var requeued = 0
        for candidate in failed {
            try Task.checkCancellation()
            try verifyAuthorization(stillMatches: epoch)
            if try store.retryFailed(
                candidate, expectedBaselineToken: baseline.token,
                authorization: epoch.authorization
            ) {
                requeued += 1
            }
        }
        try verifyAuthorization(stillMatches: epoch)
        return requeued
    }


    /// Recover only explicit PhotoKit network-access-required rows, at most
    /// four per foreground pass. The caller must already have current
    /// Owner/Device proof and a user-approved iCloud download policy.
    /// Background calls never reach this path.
    func retryWaitingICloudCandidates(owner: XDriveNativeOwnerRoot,
                                      limit: Int = 4) throws -> Int {
        guard (1...4).contains(limit) else { throw Failure.invalidReplayLimit }
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else {
            throw Failure.requiresExplicitBaseline
        }
        guard baseline.authorization == epoch.authorization,
              XDriveIOSPhotoKitLibraryEpoch.matches(
                baseline.token, as: epoch.token
              ) else { throw Failure.unauthorizedOrChanged }
        let waiting = try store.waitingICloud(limit: limit)
        var requeued = 0
        for candidate in waiting {
            try Task.checkCancellation()
            try verifyAuthorization(stillMatches: epoch)
            if try store.retryWaitingICloud(
                candidate, expectedBaselineToken: baseline.token,
                authorization: epoch.authorization
            ) {
                requeued += 1
            }
        }
        try verifyAuthorization(stillMatches: epoch)
        return requeued
    }

    /// Metadata-only, 64-item read for mounted native Gallery pages.
    /// A local queue status is NOT current Server/Node coverage. With a
    /// stale PhotoKit baseline, showing even an old "confirmed" state would
    /// be misleading; return no badges until the replay has caught up.
    func visibleStatuses(owner: XDriveNativeOwnerRoot,
                         localIdentifiers: [String]) throws -> [String: String] {
        guard localIdentifiers.count <= 64 else { throw Failure.invalidReplayLimit }
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline(),
              baseline.authorization == epoch.authorization,
              XDriveIOSPhotoKitLibraryEpoch.matches(baseline.token, as: epoch.token)
        else { return [:] }
        var statuses: [String: String] = [:]
        statuses.reserveCapacity(localIdentifiers.count)
        for id in localIdentifiers {
            try Task.checkCancellation()
            if let row = try store.status(for: id) {
                statuses[id] = row.state.rawValue
            }
        }
        try verifyAuthorization(stillMatches: epoch)
        return statuses
    }

    /// Whether every persisted PhotoKit change event has been replayed. The
    /// automatic runner must defer its date-filtered scan while this is false:
    /// an older-dated imported photo may still be waiting behind the event cap.
    func isCaughtUp(owner: XDriveNativeOwnerRoot) throws -> Bool {
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else { return false }
        guard baseline.authorization == epoch.authorization else {
            throw Failure.unauthorizedOrChanged
        }
        try verifyAuthorization(stillMatches: epoch)
        return XDriveIOSPhotoKitLibraryEpoch.matches(
            baseline.token, as: epoch.token
        )
    }

    /// Read-only local change queue counts for the exact current Owner.
    /// These are *discovery* states; even confirmed queue entries do not
    /// establish complete present-day cloud coverage.
    func summary(owner: XDriveNativeOwnerRoot)
        throws -> XDriveIOSPhotoBackupChangeQueueStore.Counts? {
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard let baseline = try store.baseline() else { return nil }
        guard baseline.authorization == epoch.authorization else {
            throw Failure.unauthorizedOrChanged
        }
        try verifyAuthorization(stillMatches: epoch)
        let totals = try store.counts()
        try verifyAuthorization(stillMatches: epoch)
        return totals
    }

    /// Durable capture from PhotoKit's persistent change history. Every
    /// PHPersistentChange changeToken and its inserted/updated/deleted asset
    /// IDs are committed together. Expired/unavailable history is surfaced
    /// to the caller; explicit scope consent is required before a full-library
    /// reconciliation. NEVER replace the baseline token or claim backup.
    func replay(owner: XDriveNativeOwnerRoot,
                maximumEvents: Int = 2) throws -> Replay {
        guard (1...4).contains(maximumEvents) else {
            throw Failure.invalidReplayLimit
        }
        try verifyOwner(owner)
        guard let original = try store.baseline() else {
            // A caller must not interpret a missing only-new checkpoint as
            // permission to upload the whole library. Foreground recovery
            // requires explicit scope consent; BG callers fail closed.
            throw Failure.historyUnavailable
        }
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard original.authorization == epoch.authorization else {
            throw Failure.authorizationChanged
        }
        let token: PHPersistentChangeToken
        do {
            guard let decoded = try NSKeyedUnarchiver.unarchivedObject(
                ofClass: PHPersistentChangeToken.self, from: original.token
            ) else {
                throw Failure.historyUnavailable
            }
            token = decoded
        } catch {
            // A thrown decode error or an empty archive is equivalent to
            // expired history; only user-confirmed full reconciliation is safe.
            throw Failure.historyUnavailable
        }
        // Apple's fetch result is a Sequence of change records; do not flatten
        // 100k asset identifiers into a new unbounded in-memory Swift array.
        let changes: PHPersistentChangeFetchResult
        do {
            changes = try PHPhotoLibrary.shared().fetchPersistentChanges(since: token)
        } catch PHPhotosError.persistentChangeTokenExpired,
                PHPhotosError.persistentChangeDetailsUnavailable {
            throw Failure.historyUnavailable
        }
        var previousToken = original.token
        var progress = Replay()
        for change in changes {
            do {
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
            } catch PHPhotosError.persistentChangeDetailsUnavailable {
                throw Failure.historyUnavailable
            }
        }
        try verifyAuthorization(stillMatches: epoch)
        return progress
    }

    /// Commit a new PhotoKit history checkpoint only after the user has
    /// explicitly authorized full-library recovery, the caller completed a
    /// clean pass, and every supported original was checked through the shared
    /// receipt verifier. The scanned PhotoKit generation must still match.
    func completeFullLibraryReconciliation(
        owner: XDriveNativeOwnerRoot,
        expectedToken: Data,
        expectedAuthorization: Int
    ) throws {
        try verifyOwner(owner)
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard epoch.authorization == expectedAuthorization else {
            throw Failure.authorizationChanged
        }
        // If the process stopped after the atomic SQLite commit, the durable
        // marker proves the exact scanned checkpoint was already installed.
        // Later PhotoKit changes remain replayable from that checkpoint.
        if try store.hasCompletedFullReconciliation(
            token: expectedToken, authorization: expectedAuthorization
        ) {
            return
        }
        guard XDriveIOSPhotoKitLibraryEpoch.matches(
            expectedToken, as: epoch.token
        ) else { throw Failure.unauthorizedOrChanged }
        try store.completeFullReconciliation(
            token: epoch.serialized, authorization: epoch.authorization
        )
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
        guard current.authorization == initial.authorization else {
            throw Failure.authorizationChanged
        }
        guard XDriveIOSPhotoKitLibraryEpoch.matches(
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
