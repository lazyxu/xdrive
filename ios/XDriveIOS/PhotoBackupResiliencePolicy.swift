import Foundation

/// Pure admission policy shared by silent APNs hints and the destructive
/// Free Up Space flow. Neither a push nor a historical backup receipt grants
/// PhotoKit access or authorizes original deletion.
enum XDriveIOSPhotoBackupResiliencePolicy {
    static let minimumRemoteWakeGap: TimeInterval = 60 * 60

    static func isSilentPhotoWakeHint(_ payload: [AnyHashable: Any]) -> Bool {
        guard let aps = payload["aps"] as? [String: Any],
              let available = aps["content-available"] as? Int,
              available == 1,
              aps["alert"] == nil, aps["sound"] == nil, aps["badge"] == nil,
              payload["xdrive_kind"] as? String == "photos-backup-wake",
              payload["xdrive_version"] as? Int == 1 else { return false }
        // A push contains NO Owner, PhotoKit ID, credential, Node name or
        // authorization assertion. The local vault is always rechecked.
        return payload.keys.allSatisfy {
            ($0 as? String).map {
                ["aps", "xdrive_kind", "xdrive_version"].contains($0)
            } ?? false
        }
    }

    static func canRequestSystemWindow(
        protectedDataAvailable: Bool, fullPhotosPermission: Bool,
        managedGrantCurrent: Bool, autoPlanEnabled: Bool,
        noActiveWriter: Bool, noPendingReceipts: Bool,
        noUnresolvedPhotoKitHistory: Bool, notPausedForReview: Bool,
        lastAcceptedWake: Date?, now: Date
    ) -> Bool {
        guard protectedDataAvailable, fullPhotosPermission,
              managedGrantCurrent, autoPlanEnabled, noActiveWriter,
              noPendingReceipts, noUnresolvedPhotoKitHistory,
              notPausedForReview, now.timeIntervalSince1970.isFinite else {
            return false
        }
        guard let lastAcceptedWake else { return true }
        return lastAcceptedWake <= now &&
            now.timeIntervalSince(lastAcceptedWake) >= minimumRemoteWakeGap
    }

    /// Fail closed until the SERVER implements a durable retention guarantee
    /// that covers every exact original resource (including both Live parts)
    /// across deletion, version replacement, trash and CAS garbage collection.
    /// The present app MUST NOT pass a historical Node receipt as a lease.
    static func canDeleteApplePhotosOriginal(
        currentOwnerAndSource: Bool,
        originalRevisionAndSHAReverified: Bool,
        allLiveResourcesProtected: Bool,
        noUncertainUploadReceipt: Bool,
        durableServerRetentionLease: Bool,
        leaseStillValidAtDeletion: Bool,
        inForegroundWithFullPhotoAccess: Bool,
        explicitUserConfirmation: Bool
    ) -> Bool {
        currentOwnerAndSource &&
            originalRevisionAndSHAReverified &&
            allLiveResourcesProtected &&
            noUncertainUploadReceipt &&
            durableServerRetentionLease &&
            leaseStillValidAtDeletion &&
            inForegroundWithFullPhotoAccess &&
            explicitUserConfirmation
    }
}
