import Foundation

/// Executable, deterministic cross-feature release matrix for pure policies.
/// It is not a substitute for a signed iPhone, real iCloud Photo Library,
/// APNs delivery, or a production NAS restore acceptance.
@main
enum XDriveIOSPhotoBackupMVPAcceptanceChecks {
    static func main() {
        let auto = XDriveIOSPhotoAutoSchedulePolicy.self
        let focused = XDriveIOSPhotoFocusedBackupPolicy.self
        let epoch = XDrivePhotoCursorEpochPolicy.self
        let resilience = XDriveIOSPhotoBackupResiliencePolicy.self

        // P0: Enabling only-new does not turn old PhotoKit positional media
        // into uploads. A changed original is eligible; a new import with
        // historical capture dates instead comes from the durable insert queue.
        let since = Date(timeIntervalSince1970: 1_000_000)
        let old = since.addingTimeInterval(-86_400)
        let edited = since.addingTimeInterval(100)
        precondition(auto.storedStartRule(raw: "onlyNew", newOnlySince: nil) == nil)
        precondition(auto.storedStartRule(raw: "onlyNew", newOnlySince: since) == .onlyNew)
        precondition(auto.newOnlyCandidate(
            capturedAt: old, modifiedAt: old, since: since
        ) == .olderThanStart)
        precondition(auto.newOnlyCandidate(
            capturedAt: old, modifiedAt: edited, since: since
        ) == .eligible)
        precondition(auto.newOnlyCandidate(
            capturedAt: nil, modifiedAt: nil, since: since
        ) == .unknownDates)

        // Exact 20-before / 3-after first-enable fixture. This is an
        // executable policy check, not a synthetic PhotoKit or Server ACK.
        // Only the three consented additions may enter the positional
        // "only new" path; old-dated *new imports* are separately handled by
        // the durable PhotoKit insert queue and its epoch fences.
        let oldAtEnable = (0..<20).map { offset -> (created: Date, modified: Date) in
            let oldStamp = since.addingTimeInterval(-TimeInterval(offset + 1))
            return (created: oldStamp, modified: oldStamp)
        }
        let newAfterEnable = (0..<3).map { offset -> (created: Date, modified: Date) in
            let newStamp = since.addingTimeInterval(TimeInterval(offset + 1))
            return (created: newStamp, modified: newStamp)
        }
        let eligible = (oldAtEnable + newAfterEnable).filter { asset in
            auto.newOnlyCandidate(
                capturedAt: asset.created, modifiedAt: asset.modified, since: since
            ) == .eligible
        }
        precondition(eligible.count == 3)

        // P0: Historical queue totals and a positional cursor become invalid
        // when the PhotoKit token, authorization or baseline changes.
        precondition(epoch.canShowChangeQueueSnapshot(
            hasBaseline: true, tokenUnchanged: true,
            previousAuthorization: 3, currentAuthorization: 3
        ))
        for (hasToken, unchanged, priorAuth) in [
            (false, true, 3), (true, false, 3), (true, true, 4)
        ] {
            precondition(!epoch.canShowChangeQueueSnapshot(
                hasBaseline: hasToken, tokenUnchanged: unchanged,
                previousAuthorization: priorAuth, currentAuthorization: 3
            ))
            precondition(epoch.trustedWindow(
                requested: 250, hasPriorToken: hasToken,
                tokenUnchanged: unchanged,
                previousAuthorization: priorAuth, currentAuthorization: 3
            ) == 0)
        }

        // P0/P1: 10k/100k media use finite 256-item windows, never an
        // unbounded array or a misleading completed scan after a partial
        // UploadSession/receipt review.
        for total in [10_000, 100_000] {
            let windows = XDrivePhotoBackupScanWindow.count(visibleTotal: total)
            precondition(windows == (total + 255) / 256)
            var scanned = 0
            for index in 0..<windows {
                guard let offset = XDrivePhotoBackupScanWindow.offset(for: index) else {
                    preconditionFailure("Invalid bounded PhotoKit offset")
                }
                let count = XDrivePhotoBackupScanWindow.capacity(
                    visibleTotal: total, offset: offset
                )
                precondition((1...256).contains(count))
                scanned += count
            }
            precondition(scanned == total)
        }
        precondition(auto.nextWindow(
            current: 0, visibleTotal: 10_000, scanned: 20,
            uploaded: 20, needsReview: false
        ) == 0)
        precondition(auto.nextWindow(
            current: 0, visibleTotal: 10_000, scanned: 256,
            uploaded: 20, needsReview: false
        ) == 1)
        precondition(auto.nextWindow(
            current: 0, visibleTotal: 10_000, scanned: 256,
            uploaded: 20, needsReview: true
        ) == 0)

        // P0: Focused Backup never persists an incomplete/unavailable
        // prefix and rejects an obsolete iCloud, authorization or library
        // generation after app restart.
        precondition(focused.afterWindow(
            index: 0, visibleTotal: 600, scanned: 20,
            uploaded: 20, needsReview: false
        ) == .repeatWindow(0))
        precondition(focused.afterWindow(
            index: 0, visibleTotal: 600, scanned: 256,
            uploaded: 0, needsReview: true
        ) == .pausedForReview)
        precondition(!focused.canSaveCheckpoint(
            completedWindow: 0, nextWindow: 1,
            visibleTotal: 600, hadUnavailable: true
        ))
        precondition(focused.trustedResumeWindow(
            requested: 1, previousVisible: 600, currentVisible: 600,
            priorAuthorization: 3, currentAuthorization: 3,
            tokenUnchanged: true,
            previousAllowICloud: false, allowICloud: false
        ) == 1)
        precondition(focused.trustedResumeWindow(
            requested: 1, previousVisible: 600, currentVisible: 600,
            priorAuthorization: 3, currentAuthorization: 3,
            tokenUnchanged: false,
            previousAllowICloud: false, allowICloud: false
        ) == 0)
        precondition(focused.trustedResumeWindow(
            requested: 1, previousVisible: 600, currentVisible: 600,
            priorAuthorization: 3, currentAuthorization: 3,
            tokenUnchanged: true,
            previousAllowICloud: false, allowICloud: true
        ) == 0)

        // P0: A silent push can at most request a future system window;
        // each current Owner/grant, protected data, permission, stop/ACK
        // admission gate is individually necessary.
        let quiet: [AnyHashable: Any] = [
            "aps": ["content-available": 1],
            "xdrive_kind": "photos-backup-wake",
            "xdrive_version": 1
        ]
        precondition(resilience.isSilentPhotoWakeHint(quiet))
        var forged = quiet
        forged["aps"] = ["content-available": 1, "source_id": 33]
        precondition(!resilience.isSilentPhotoWakeHint(forged))
        func canRearm(_ b: [Bool]) -> Bool {
            resilience.canRequestSystemWindow(
                protectedDataAvailable: b[0], fullPhotosPermission: b[1],
                managedGrantCurrent: b[2], autoPlanEnabled: b[3],
                noActiveWriter: b[4], noPendingReceipts: b[5],
                noUnresolvedPhotoKitHistory: b[6],
                notPausedForReview: b[7], lastAcceptedWake: nil,
                now: Date(timeIntervalSince1970: 1_000_000)
            )
        }
        let safe = Array(repeating: true, count: 8)
        precondition(canRearm(safe))
        for index in safe.indices {
            var changed = safe
            changed[index] = false
            precondition(!canRearm(changed))
        }

        // P0/P1: Old sealed operations or even equal local/remote counts
        // never prove today's cloud Node coverage or a verified percentage.
        var tally = XDriveIOSNativePhotoReceiptTally()
        tally.include(state: "confirmed", hasVerifiedReceipt: true)
        tally.include(state: "needsReconciliation", hasVerifiedReceipt: false)
        precondition(tally.historicallyConfirmed == 1 && tally.uncertain == 1)
        let snapshot = XDriveIOSNativePhotoCoverageSnapshot(
            localImages: 1, localVideos: 0,
            limitedAuthorization: false, historicLedger: tally,
            checkedAt: Date(), managedTargetNodeID: 7
        )
        precondition(!snapshot.wholeLibraryCompletionVerified)

        // P2: Each safeguard on destructive iCloud/Photos deletion is
        // necessary. Missing cloud retention or an uncertain ACK blocks it.
        func canDelete(_ b: [Bool]) -> Bool {
            resilience.canDeleteApplePhotosOriginal(
                currentOwnerAndSource: b[0],
                originalRevisionAndSHAReverified: b[1],
                allLiveResourcesProtected: b[2],
                noUncertainUploadReceipt: b[3],
                durableServerRetentionLease: b[4],
                leaseStillValidAtDeletion: b[5],
                inForegroundWithFullPhotoAccess: b[6],
                explicitUserConfirmation: b[7]
            )
        }
        precondition(canDelete(safe))
        for index in safe.indices {
            var changed = safe
            changed[index] = false
            precondition(!canDelete(changed))
        }
        print("iOS incremental Photos MVP pure-policy acceptance matrix: PASS")
    }
}
