import CryptoKit
import Foundation

enum XDriveIOSPhotoAutoScheduleError: Error {
    case unsupportedInterval
    case persistenceUnavailable
}

@MainActor
final class XDriveIOSPhotoAutoScheduleStore {
    static let shared = XDriveIOSPhotoAutoScheduleStore()
    private init() {}

    /// Bump on any offline global stop, invalidating UIKit confirmations
    /// that started before the stop but may finish afterward.
    private(set) var localStopGeneration: UInt64 = 0

    /// Contains no token, PhotoKit ID, filename, location or device grant.
    /// Scope identity is reverified against the Server on EVERY auto tick.
    struct State: Codable {
        var enabled: Bool
        var pausedForReview: Bool
        var intervalMinutes: Int
        var allowICloudOriginals: Bool
        var windowIndex: Int
        var nextDueAt: Date
        var lastCompletedAt: Date?
    }
    private func key(for owner: XDriveNativeOwnerRoot) -> String {
        let scope = owner.origin.absoluteString + "\n" + owner.instanceID +
            "\n" + String(owner.ownerID) + "\n" + String(owner.rootNodeID)
        let hash = SHA256.hash(data: Data(scope.utf8))
        return "xdrive.ios.photos.auto.v1." +
            hash.map { String(format: "%02x", $0) }.joined()
    }
    func status(owner: XDriveNativeOwnerRoot) -> State? {
        guard let bytes = UserDefaults.standard.data(forKey: key(for: owner)),
              let state = try? JSONDecoder().decode(State.self, from: bytes),
              XDriveIOSPhotoAutoSchedulePolicy.accepts(
                minutes: state.intervalMinutes
              ), state.windowIndex >= 0 else { return nil }
        return state
    }

    /// Call ONLY after same-origin Web Owner/root verification and explicit
    /// native confirmation. Never treat a writable Web localStorage flag as
    /// permission to scan PhotoKit automatically.
    @discardableResult
    func configure(owner: XDriveNativeOwnerRoot, minutes: Int,
                   allowICloud: Bool) throws -> State {
        guard XDriveIOSPhotoAutoSchedulePolicy.accepts(minutes: minutes) else {
            throw XDriveIOSPhotoAutoScheduleError.unsupportedInterval
        }
        let existing = status(owner: owner)
        let state = State(
            enabled: true, pausedForReview: false,
            intervalMinutes: minutes, allowICloudOriginals: allowICloud,
            windowIndex: existing?.windowIndex ?? 0,
            // First scan is due on the next eligible foreground poll.
            nextDueAt: Date(), lastCompletedAt: existing?.lastCompletedAt
        )
        try persist(state, owner: owner)
        return state
    }

    func disable(owner: XDriveNativeOwnerRoot) {
        // Disable immediately, without requiring a network roundtrip.
        UserDefaults.standard.removeObject(forKey: key(for: owner))
    }

    /// Emergency STOP-only operation for every local Owner scope. This
    /// does not require the Server, enumerate PhotoKit or touch any CAS bytes.
    /// Only this app's exact SHA-256 auto-schedule keys can be deleted;
    /// unrelated defaults and encrypted upload receipts remain untouched.
    func disableAllOnThisDevice() -> Int {
        localStopGeneration &+= 1
        let prefix = "xdrive.ios.photos.auto.v1."
        let keys = UserDefaults.standard.dictionaryRepresentation().keys.filter {
            key in
            guard key.hasPrefix(prefix) else { return false }
            let suffix = key.dropFirst(prefix.count)
            return suffix.utf8.count == 64 &&
                suffix.utf8.allSatisfy {
                    ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
                }
        }
        for key in keys {
            UserDefaults.standard.removeObject(forKey: key)
        }
        return keys.count
    }

    /// Persist the next due time BEFORE any possible network write. A
    /// process crash cannot spin a hot retry loop, and the encrypted
    /// original journal is still responsible for deduplication.
    func reserveDue(owner: XDriveNativeOwnerRoot, now: Date = Date()) throws
        -> State? {
        guard var state = status(owner: owner),
              state.enabled, !state.pausedForReview,
              state.nextDueAt <= now,
              let following = XDriveIOSPhotoAutoSchedulePolicy.nextDue(
                after: now, intervalMinutes: state.intervalMinutes
              ) else { return nil }
        state.nextDueAt = following
        try persist(state, owner: owner)
        return state
    }

    func recordResult(owner: XDriveNativeOwnerRoot,
                      progress: XDriveIOSPhotoBackupProgress,
                      now: Date = Date()) throws -> State? {
        guard var state = status(owner: owner), state.enabled else { return nil }
        let pending = progress.stoppedForReview || progress.needsReview > 0
        state.windowIndex = XDriveIOSPhotoAutoSchedulePolicy.nextWindow(
            current: state.windowIndex, visibleTotal: progress.totalVisible,
            scanned: progress.scanned, uploaded: progress.uploaded,
            needsReview: pending
        )
        state.pausedForReview = pending
        state.lastCompletedAt = now
        try persist(state, owner: owner)
        return state
    }

    private func persist(_ state: State,
                         owner: XDriveNativeOwnerRoot) throws {
        let bytes = try JSONEncoder().encode(state)
        let name = key(for: owner)
        UserDefaults.standard.set(bytes, forKey: name)
        guard UserDefaults.standard.data(forKey: name) == bytes else {
            throw XDriveIOSPhotoAutoScheduleError.persistenceUnavailable
        }
    }
}
