import CryptoKit
import Foundation

/// Small, non-secret per-Owner BG cursor. Encrypted resource identity/ACKs
/// remain in XDrivePhotoSyncLedger; no PhotoKit ID or grant is stored here.
/// Only an independently proved installed BG grant may reserve work.
@MainActor
final class XDriveIOSBGOriginalWindowStore {
    static let shared = XDriveIOSBGOriginalWindowStore()
    private init() {}

    private struct State: Codable {
        var windowIndex: Int
        var dueAt: Date
        var pausedForReview: Bool
        var lastCommittedAt: Date?
        // Optional to decode old BG schedules without migrating or exposing
        // original PhotoKit localIdentifiers or any background secret.
        var libraryChangeEpoch: Data? = nil
        var libraryAuthorizationRaw: Int? = nil
    }

    private func account(_ owner: XDriveNativeOwnerRoot) -> String {
        let value = owner.origin.absoluteString + "\n" +
            owner.instanceID + "\n" + String(owner.ownerID) + "\n" +
            String(owner.rootNodeID)
        let hash = SHA256.hash(data: Data(value.utf8))
        return "xdrive.ios.bg.original-window.v1." +
            hash.map { String(format: "%02x", $0) }.joined()
    }

    private func current(owner: XDriveNativeOwnerRoot) throws -> State {
        let key = account(owner)
        guard let bytes = UserDefaults.standard.data(forKey: key) else {
            return State(windowIndex: 0, dueAt: .distantPast,
                         pausedForReview: false, lastCommittedAt: nil)
        }
        guard let parsed = try? JSONDecoder().decode(State.self, from: bytes),
              parsed.windowIndex >= 0,
              parsed.windowIndex < Int.max / XDrivePhotoBackupScanWindow.maxItems,
              parsed.dueAt.timeIntervalSince1970.isFinite else {
            throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
        }
        return parsed
    }

    private func store(_ state: State,
                       owner: XDriveNativeOwnerRoot) throws {
        let bytes = try JSONEncoder().encode(state)
        let key = account(owner)
        UserDefaults.standard.set(bytes, forKey: key)
        guard UserDefaults.standard.data(forKey: key) == bytes else {
            throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
        }
    }

    /// Durable anti-hot-loop reservation BEFORE any PhotoKit byte access.
    /// A crash or expired BGTask never creates automatic retries against an
    /// unknown Server upload. The next OS request must pass Owner proof again.
    func reserveDue(owner: XDriveNativeOwnerRoot,
                    approved: XDriveIOSApprovedPhotoBGCredential,
                    now: Date = Date()) throws -> Int? {
        guard approved.matches(owner, now: now),
              XDriveIOSBGApprovalPolicy.validInterval(
                approved.intervalMinutes
              ) else { return nil }
        var state = try current(owner: owner)
        guard !state.pausedForReview, state.dueAt <= now else { return nil }
        let next = now.addingTimeInterval(
            TimeInterval(approved.intervalMinutes * 60)
        )
        // A past offset is meaningful only for the same PhotoKit library
        // generation and Full/Limited authorization scope. Rewind on a
        // changed, missing or damaged token; never trust the index alone.
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        state.windowIndex = XDrivePhotoCursorEpochPolicy.trustedWindow(
            requested: state.windowIndex,
            hasPriorToken: state.libraryChangeEpoch != nil,
            tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch.matches(
                state.libraryChangeEpoch, as: epoch.token
            ),
            previousAuthorization: state.libraryAuthorizationRaw,
            currentAuthorization: epoch.authorization
        )
        state.libraryChangeEpoch = epoch.serialized
        state.libraryAuthorizationRaw = epoch.authorization
        state.dueAt = next
        try store(state, owner: owner)
        return state.windowIndex
    }

    func record(owner: XDriveNativeOwnerRoot,
                approved: XDriveIOSApprovedPhotoBGCredential,
                report: XDriveIOSPhotoBackupProgress,
                now: Date = Date()) throws {
        guard approved.matches(owner, now: now) else {
            throw XDrivePhotoSyncLedgerError.identityMismatch
        }
        var state = try current(owner: owner)
        let unresolved = report.needsReview > 0 || report.stoppedForReview
        // The same strategy as visible runs. Do not skip a 256-item window
        // just because one 1GiB video filled this BGTask's one-upload budget.
        // A Photos mutation while the original was staged/uploaded cannot
        // commit the old window's next offset: the next BG task must restart
        // the current authorized library from its beginning.
        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
        let unchanged = XDrivePhotoCursorEpochPolicy.canResume(
            hasPriorToken: state.libraryChangeEpoch != nil,
            tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch.matches(
                state.libraryChangeEpoch, as: epoch.token
            ),
            previousAuthorization: state.libraryAuthorizationRaw,
            currentAuthorization: epoch.authorization
        )
        state.windowIndex = unchanged
            ? XDriveIOSPhotoAutoSchedulePolicy.nextWindow(
                current: state.windowIndex, visibleTotal: report.totalVisible,
                scanned: report.scanned, uploaded: report.uploaded,
                needsReview: unresolved
              ) : 0
        state.libraryChangeEpoch = epoch.serialized
        state.libraryAuthorizationRaw = epoch.authorization
        state.pausedForReview = unresolved
        state.lastCommittedAt = now
        try store(state, owner: owner)
    }

    func pause(owner: XDriveNativeOwnerRoot) throws {
        var state = try current(owner: owner)
        state.pausedForReview = true
        try store(state, owner: owner)
    }

    /// Owner explicit opt-out, NOT a loss of existing encrypted receipts.
    /// Leaves an unknown-ACK pause in place unless the user explicitly
    /// authorizes new background work again.
    func disable(owner: XDriveNativeOwnerRoot) {
        UserDefaults.standard.removeObject(forKey: account(owner))
    }
}

/// One resource writer at a time across UIKit foreground and OS BGTask.
/// A map/viewer transition has no authority to release another task's hold.
@MainActor
final class XDriveIOSOriginalRunGate {
    static let shared = XDriveIOSOriginalRunGate()
    private init() {}
    private var owner: UUID?

    func acquire() -> UUID? {
        guard owner == nil else { return nil }
        let token = UUID()
        owner = token
        return token
    }

    func release(_ token: UUID) {
        if owner == token { owner = nil }
    }
}
