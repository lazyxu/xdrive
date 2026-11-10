import Foundation

@main enum XDriveIOSPhotoBackupResiliencePolicyChecks {
    static func main() {
        let p = XDriveIOSPhotoBackupResiliencePolicy.self
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let silent: [AnyHashable: Any] = [
            "aps": ["content-available": 1],
            "xdrive_kind": "photos-backup-wake", "xdrive_version": 1
        ]
        precondition(p.isSilentPhotoWakeHint(silent))
        var invalid = silent
        invalid["owner_id"] = 123
        precondition(!p.isSilentPhotoWakeHint(invalid))
        invalid = silent
        invalid["aps"] = ["content-available": 1, "alert": "backup"]
        precondition(!p.isSilentPhotoWakeHint(invalid))
        invalid = silent
        invalid["xdrive_version"] = 2
        precondition(!p.isSilentPhotoWakeHint(invalid))
        invalid = silent
        invalid["aps"] = ["content-available": 1, "owner_id": 88]
        precondition(!p.isSilentPhotoWakeHint(invalid))
        invalid = silent
        invalid["aps"] = ["content-available": 1, "mutable-content": 1]
        precondition(!p.isSilentPhotoWakeHint(invalid))
        invalid = silent
        invalid["aps"] = ["content-available": 2]
        precondition(!p.isSilentPhotoWakeHint(invalid))
        invalid = silent
        invalid["untrusted_device_id"] = "fake-device"
        precondition(!p.isSilentPhotoWakeHint(invalid))

        func mayWake(_ protected: Bool = true, _ granted: Bool = true,
                     _ last: Date? = nil, _ pending: Bool = false,
                     _ historyOK: Bool = true, _ paused: Bool = false) -> Bool {
            p.canRequestSystemWindow(
                protectedDataAvailable: protected, fullPhotosPermission: true,
                managedGrantCurrent: granted, autoPlanEnabled: true,
                noActiveWriter: true, noPendingReceipts: !pending,
                noUnresolvedPhotoKitHistory: historyOK,
                notPausedForReview: !paused, lastAcceptedWake: last,
                now: now)
        }
        precondition(mayWake())
        precondition(!mayWake(false))
        precondition(!mayWake(true, false))
        precondition(!mayWake(true, true, nil, true))
        precondition(!mayWake(true, true, nil, false, false))
        precondition(!mayWake(true, true, nil, false, true, true))
        precondition(!mayWake(true, true, now.addingTimeInterval(-3599)))
        precondition(mayWake(true, true, now.addingTimeInterval(-3600)))
        precondition(!mayWake(true, true, now.addingTimeInterval(30)))

        let basic: [Bool] = [true, true, true, true, true, true, true, true]
        func mayDelete(_ b: [Bool]) -> Bool {
            p.canDeleteApplePhotosOriginal(
                currentOwnerAndSource: b[0],
                originalRevisionAndSHAReverified: b[1],
                allLiveResourcesProtected: b[2],
                noUncertainUploadReceipt: b[3],
                durableServerRetentionLease: b[4],
                leaseStillValidAtDeletion: b[5],
                inForegroundWithFullPhotoAccess: b[6],
                explicitUserConfirmation: b[7])
        }
        precondition(mayDelete(basic))
        for i in basic.indices {
            var changed = basic
            changed[i] = false
            precondition(!mayDelete(changed))
        }
        print("iOS photo APNs-wake/free-space fail-closed policies: PASS")
    }
}
