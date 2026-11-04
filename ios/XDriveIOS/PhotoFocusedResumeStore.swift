import CryptoKit
import Foundation

/// Resume position for an explicitly re-started foreground-focused backup.
/// Contains ONLY a completed PhotoKit scan-window index and generation
/// witness. Upload receipts and per-asset state remain in the existing
/// Owner/Device sealed ledger; this is never a background authorization.
@MainActor
final class XDriveIOSPhotoFocusedResumeStore {
    static let shared = XDriveIOSPhotoFocusedResumeStore()
    private init() {}

    struct Resume {
        let nextWindow: Int
        let totalVisible: Int
        let hadUnavailable: Bool
    }

    enum Failure: Error {
        case invalidBoundary
        case persistenceUnavailable
    }

    private struct State: Codable {
        let version: Int
        let nextWindow: Int
        let totalVisible: Int
        let authorizationRaw: Int
        let allowICloud: Bool
        let libraryEpoch: Data
        let hadUnavailable: Bool
        // Optional for V1 root-only checkpoints. A different destination
        // starts at zero even if the PhotoKit library epoch did not change.
        let sourceID: UInt64?
        let targetNodeID: UInt64?
    }

    private func key(for owner: XDriveNativeOwnerRoot) -> String {
        let identity = owner.origin.absoluteString + "\n" +
            owner.instanceID + "\n" + String(owner.ownerID) + "\n" +
            String(owner.rootNodeID)
        let hash = SHA256.hash(data: Data(identity.utf8))
        return "xdrive.ios.photos.focused-cursor.v1." +
            hash.map { String(format: "%02x", $0) }.joined()
    }

    /// Reading a stale or corrupt checkpoint returns window 0. Even when
    /// accepted, the caller MUST first prove current Owner and globally
    /// reconcile pending/unknown receipts under the shared original gate.
    func resume(owner: XDriveNativeOwnerRoot,
                epoch: XDriveIOSPhotoKitLibraryEpoch.Snapshot,
                totalVisible: Int, allowICloud: Bool,
                sourceID: UInt64, targetNodeID: UInt64) -> Resume {
        let fresh = Resume(nextWindow: 0, totalVisible: totalVisible,
                           hadUnavailable: false)
        let name = key(for: owner)
        guard let data = UserDefaults.standard.data(forKey: name) else {
            return fresh
        }
        guard data.count <= 100_000,
              let state = try? JSONDecoder().decode(State.self, from: data),
              state.version == 1,
              XDriveIOSPhotoBackupDestinationCursorPolicy.sameManagedTarget(
                savedSourceID: state.sourceID,
                savedTargetNodeID: state.targetNodeID,
                currentSourceID: sourceID, currentTargetNodeID: targetNodeID,
                ownerRootNodeID: owner.rootNodeID
              ),
              !state.hadUnavailable,
              !state.libraryEpoch.isEmpty, state.libraryEpoch.count <= 65_536
        else {
            clear(owner: owner)
            return fresh
        }
        let next = XDriveIOSPhotoFocusedBackupPolicy.trustedResumeWindow(
            requested: state.nextWindow,
            previousVisible: state.totalVisible, currentVisible: totalVisible,
            priorAuthorization: state.authorizationRaw,
            currentAuthorization: epoch.authorization,
            tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch.matches(
                state.libraryEpoch, as: epoch.token
            ),
            previousAllowICloud: state.allowICloud, allowICloud: allowICloud
        )
        guard next > 0 else {
            clear(owner: owner)
            return fresh
        }
        return Resume(nextWindow: next, totalVisible: totalVisible,
                      hadUnavailable: state.hadUnavailable)
    }

    /// Commit ONLY after a full 256-slot (or final shorter) window returns
    /// a valid .nextWindow decision and the PhotoKit epoch is unchanged.
    /// A partial capped window, unknown ACK, failed scan or crash can only
    /// repeat the same window, never skip its unverified originals.
    func saveCompletedWindow(
        owner: XDriveNativeOwnerRoot,
        completedWindow: Int, nextWindow: Int, totalVisible: Int,
        epoch: XDriveIOSPhotoKitLibraryEpoch.Snapshot,
        allowICloud: Bool, hadUnavailable: Bool,
        sourceID: UInt64, targetNodeID: UInt64
    ) throws {
        guard sourceID > 0, targetNodeID > 0,
              targetNodeID != owner.rootNodeID,
              XDriveIOSPhotoFocusedBackupPolicy.canSaveCheckpoint(
            completedWindow: completedWindow, nextWindow: nextWindow,
            visibleTotal: totalVisible, hadUnavailable: hadUnavailable
        ), !epoch.serialized.isEmpty, epoch.serialized.count <= 65_536
        else { throw Failure.invalidBoundary }
        let checkpoint = State(
            version: 1, nextWindow: nextWindow,
            totalVisible: totalVisible, authorizationRaw: epoch.authorization,
            allowICloud: allowICloud, libraryEpoch: epoch.serialized,
            hadUnavailable: hadUnavailable, sourceID: sourceID,
            targetNodeID: targetNodeID
        )
        let data = try JSONEncoder().encode(checkpoint)
        guard data.count <= 100_000 else { throw Failure.persistenceUnavailable }
        let name = key(for: owner)
        UserDefaults.standard.set(data, forKey: name)
        guard UserDefaults.standard.data(forKey: name) == data else {
            // Do not advance this session when the checkpoint could not
            // be reliably saved; re-scanning the last safe window is fine.
            throw Failure.persistenceUnavailable
        }
    }

    /// A complete scan removes its cursor. This does not erase verified
    /// receipts, claim cloud completeness, or delete any uploaded bytes.
    func clear(owner: XDriveNativeOwnerRoot) {
        UserDefaults.standard.removeObject(forKey: key(for: owner))
    }
}
