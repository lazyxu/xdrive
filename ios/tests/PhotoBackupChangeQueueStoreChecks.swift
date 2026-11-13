import Foundation
import SQLite3

@main struct XDriveIOSPhotoBackupChangeQueueStoreChecks {
    static func expect(_ check: @autoclosure () throws -> Bool) rethrows {
        let succeeded = try check()
        precondition(succeeded)
    }

    /// Inspect the real on-disk table, not the filtered failureReasonCounts
    /// join (whose result would hide stale/orphaned entries).
    private static func rawFailureReasonRows(at file: URL) -> Int {
        var database: OpaquePointer?
        precondition(sqlite3_open_v2(
            file.path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil
        ) == SQLITE_OK)
        guard let database else { preconditionFailure("unable to read queue diagnostics") }
        defer { _ = sqlite3_close_v2(database) }
        var query: OpaquePointer?
        precondition(sqlite3_prepare_v2(
            database, "SELECT COUNT(*) FROM failure_reasons", -1, &query, nil
        ) == SQLITE_OK)
        guard let query else { preconditionFailure("missing diagnostics query") }
        defer { _ = sqlite3_finalize(query) }
        precondition(sqlite3_step(query) == SQLITE_ROW)
        return Int(sqlite3_column_int64(query, 0))
    }

    static func main() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("owner-a.sqlite3")
        let old = Data([1]), newest = Data([2]), later = Data([3])
        do {
            let store = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: url)
            try expect(try store.baseline() == nil)
            try expect(try store.installBaselineIfAbsent(token: old, authorization: 3))
            try expect(try !store.installBaselineIfAbsent(token: newest, authorization: 3))
            try expect(try store.baseline()?.token == old)
            let delta = try store.apply(inserted: ["new", "later"], updated: ["old"], deleted: [],
                                        expectedToken: old, nextToken: newest, authorization: 3)
            precondition(delta == .init(inserted: 2, updated: 1, deleted: 0))
            let first = try store.pending()
            precondition(first.count == 3)
            try expect(try store.counts() == .init(pending: 3, failed: 0, confirmed: 0, missingLocal: 0))
            precondition(first[0].priority == 2 && first[1].priority == 2)
            precondition(first[2].localIdentifier == "old")
            try expect(try store.baseline()?.token == newest)
            do {
                _ = try store.apply(inserted: ["never"], updated: [], deleted: [],
                                    expectedToken: old, nextToken: later, authorization: 3)
                fatalError("expected token guard")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            try expect(try store.pending().count == 3)
            do {
                _ = try store.apply(inserted: ["bad\u{0}id"], updated: [], deleted: [],
                                    expectedToken: newest, nextToken: later, authorization: 3)
                fatalError("expected rollback")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.invalidInput {}
            try expect(try store.baseline()?.token == newest)
        }
        do {
            let store = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: url)
            try expect(try store.baseline()?.token == newest)
            try expect(try store.pending().count == 3)
            _ = try store.apply(inserted: [], updated: ["old"], deleted: ["new"],
                                expectedToken: newest, nextToken: later, authorization: 3)
            let pending = try store.pending()
            precondition(pending.count == 2)
            try expect(try store.counts() == .init(pending: 2, failed: 0, confirmed: 0, missingLocal: 1))
            precondition(pending.first?.localIdentifier == "later")
            precondition(pending.last?.localIdentifier == "old" && pending.last?.revision == 2)
            try expect(try store.baseline()?.token == later)
            do {
                _ = try store.apply(inserted: ["different"], updated: [], deleted: [],
                                    expectedToken: later, nextToken: Data([4]), authorization: 4)
                fatalError("expected auth guard")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
        }
        // A verified receipt for one revision cannot clear later edits.
        // An item-local failure is isolated until explicit user retry.
        do {
            let store = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: url)
            let initial = try store.pending()
            guard let old = initial.first(where: { $0.localIdentifier == "old" }) else {
                fatalError("expected original pending old revision")
            }
            do {
                _ = try store.settle(
                    old, result: .confirmed,
                    expectedBaselineToken: Data([99]), authorization: 3
                )
                fatalError("expected stale baseline guard")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            try expect(try store.status(for: "old")?.state == .pending)
            try expect(try store.settle(
                old, result: .confirmed,
                expectedBaselineToken: later, authorization: 3
            ))
            try expect(try store.status(for: "old")?.state == .confirmed)
            try expect(try store.counts() == .init(pending: 1, failed: 0, confirmed: 1, missingLocal: 1))
            try expect(try !store.settle(old, result: .confirmed))
            _ = try store.apply(inserted: [], updated: ["old"], deleted: [],
                                expectedToken: later, nextToken: Data([5]), authorization: 3)
            let modified = try store.pending()
            guard let newer = modified.first(where: { $0.localIdentifier == "old" }) else {
                fatalError("expected edited original requeue")
            }
            precondition(newer.revision > old.revision)
            try expect(try store.status(for: "old")?.state == .pending)
            try expect(try store.counts() == .init(pending: 2, failed: 0, confirmed: 0, missingLocal: 1))
            try expect(try !store.settle(old, result: .confirmed))
            try expect(try store.settle(newer, result: .failed))
            try expect(try store.status(for: "old")?.state == .failed)
            try expect(try store.counts() == .init(pending: 1, failed: 1, confirmed: 0, missingLocal: 1))
            try expect(try !store.settle(newer, result: .failed))
            let failedRows = try store.failed()
            precondition(failedRows.count == 1 && failedRows[0] == newer)
            do {
                _ = try store.retryFailed(
                    newer, expectedBaselineToken: Data([99]), authorization: 3
                )
                fatalError("expected stale retry baseline guard")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            try expect(try store.retryFailed(
                newer, expectedBaselineToken: Data([5]), authorization: 3
            ))
            try expect(try !store.retryFailed(
                newer, expectedBaselineToken: Data([5]), authorization: 3
            ))
            try expect(try store.counts() == .init(pending: 2, failed: 0, confirmed: 0, missingLocal: 1))
            let again = try store.pending()
            precondition(again.contains(where: { $0.localIdentifier == "old" && $0.revision == newer.revision }))
            _ = try store.apply(inserted: [], updated: [], deleted: ["old"],
                                expectedToken: Data([5]), nextToken: Data([6]), authorization: 3)
            let remainingAfterDeletion = try store.pending()
            precondition(!remainingAfterDeletion.contains(where: { $0.localIdentifier == "old" }))
            try expect(try store.status(for: "old")?.state == .missingLocal)
            try expect(try store.counts() == .init(pending: 1, failed: 0, confirmed: 0, missingLocal: 2))
            try expect(try store.status(for: "not-here") == nil)
            try expect(try !store.settle(newer, result: .confirmed))
        }
        // Fresh only-new consent after permanently disabling an earlier plan:
        // the old PhotoKit queue must not silently upload pre-consent edits.
        // This is NOT full-library reconciliation and must not install a
        // verified-library marker or change the separate upload journal.
        do {
            let path = dir.appendingPathComponent("fresh-only-new.sqlite3")
            let first = Data([80]), changed = Data([81]), consent = Data([82])
            let store = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: path)
            try expect(try store.installBaselineIfAbsent(
                token: first, authorization: 3
            ))
            _ = try store.apply(
                inserted: ["from-previous-plan", "previous-failed"],
                updated: [], deleted: [], expectedToken: first,
                nextToken: changed, authorization: 3
            )
            guard let failed = try store.pending().first(where: {
                $0.localIdentifier == "previous-failed"
            }) else { preconditionFailure("missing previous candidate") }
            try expect(try store.settle(
                failed, result: .failed, reasonCode: "originalMissing",
                expectedBaselineToken: changed, authorization: 3
            ))
            precondition(rawFailureReasonRows(at: path) == 1)
            try store.replaceBaselineForFreshOnlyNewConsent(
                token: consent, authorization: 3
            )
            try expect(try store.baseline()?.token == consent)
            try expect(try store.counts() == .init())
            try expect(try store.pending().isEmpty)
            try expect(try store.failed().isEmpty)
            precondition(rawFailureReasonRows(at: path) == 0)
            try expect(try !store.hasCompletedFullReconciliation(
                token: consent, authorization: 3
            ))
            do {
                _ = try store.apply(inserted: ["stale-before-consent"],
                                    updated: [], deleted: [],
                                    expectedToken: changed, nextToken: Data([83]),
                                    authorization: 3)
                preconditionFailure("stale prior token accepted")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            _ = try store.apply(inserted: ["new-after-consent"],
                                updated: [], deleted: [],
                                expectedToken: consent, nextToken: Data([84]),
                                authorization: 3)
            try expect(try store.pending().map { $0.localIdentifier } == ["new-after-consent"])
        }
        // The reset and token persist across process relaunch.
        do {
            let path = dir.appendingPathComponent("fresh-only-new.sqlite3")
            let reopened = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: path)
            try expect(try reopened.baseline()?.token == Data([84]))
            try expect(try reopened.pending().map { $0.localIdentifier } == ["new-after-consent"])
        }
        // A full authorized-library reconciliation atomically installs a
        // fresh token and discards stale queue rows only after receipt proof.
        do {
            let store = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: url)
            try expect(try store.counts() == .init(
                pending: 1, failed: 0, confirmed: 0, missingLocal: 2
            ))
            try store.completeFullReconciliation(
                token: Data([7]), authorization: 3
            )
            try expect(try store.baseline()?.token == Data([7]))
            try expect(try store.baseline()?.authorization == 3)
            try expect(try store.counts() == .init())
            try expect(try store.pending().isEmpty)
            try expect(try store.failed().isEmpty)
            try expect(try store.status(for: "old") == nil)
            try expect(try store.hasCompletedFullReconciliation(
                token: Data([7]), authorization: 3
            ))
            try expect(try !store.hasCompletedFullReconciliation(
                token: Data([6]), authorization: 3
            ))
        }
        do {
            let reopened = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: url)
            try expect(try reopened.baseline()?.token == Data([7]))
            try expect(try reopened.baseline()?.authorization == 3)
            try expect(try reopened.counts() == .init())
            try expect(try reopened.hasCompletedFullReconciliation(
                token: Data([7]), authorization: 3
            ))
        }
        // iCloud-only read without network does not become a permanently
        // failed or confirmed original. A later explicitly approved foreground
        // read may requeue only the same baseline and exact revision.
        let cloudFile = dir.appendingPathComponent("icloud-wait.sqlite3")
        do {
            let cloud = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: cloudFile)
            try expect(try cloud.installBaselineIfAbsent(
                token: Data([1]), authorization: 3
            ))
            _ = try cloud.apply(
                inserted: ["cloud-only"], updated: [], deleted: [],
                expectedToken: Data([1]), nextToken: Data([2]),
                authorization: 3
            )
            guard let pending = try cloud.pending().first else {
                fatalError("missing iCloud candidate")
            }
            try expect(try cloud.settle(
                pending, result: .waitingICloud,
                expectedBaselineToken: Data([2]), authorization: 3
            ))
            try expect(try cloud.counts() == .init(
                pending: 0, failed: 0, waitingICloud: 1,
                confirmed: 0, missingLocal: 0
            ))
            try expect(try cloud.failed().isEmpty)
            try expect(try cloud.waitingICloud().first == pending)
            try expect(try !cloud.retryFailed(
                pending, expectedBaselineToken: Data([2]), authorization: 3
            ))
        }
        do {
            let cloud = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: cloudFile)
            let waiting = try cloud.waitingICloud()
            guard let candidate = waiting.first, waiting.count == 1 else {
                fatalError("waiting iCloud row was not durable")
            }
            do {
                _ = try cloud.retryWaitingICloud(
                    candidate, expectedBaselineToken: Data([9]), authorization: 3
                )
                fatalError("expected stale iCloud retry rejection")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            try expect(try cloud.counts().waitingICloud == 1)
            try expect(try cloud.retryWaitingICloud(
                candidate, expectedBaselineToken: Data([2]), authorization: 3
            ))
            try expect(try !cloud.retryWaitingICloud(
                candidate, expectedBaselineToken: Data([2]), authorization: 3
            ))
            try expect(try cloud.settle(
                candidate, result: .confirmed,
                expectedBaselineToken: Data([2]), authorization: 3
            ))
            try expect(try cloud.counts() == .init(
                pending: 0, failed: 0, waitingICloud: 0,
                confirmed: 1, missingLocal: 0
            ))
        }
        let isolated = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: dir.appendingPathComponent("owner-b.sqlite3"))
        try expect(try isolated.baseline() == nil)
        try expect(try isolated.pending().isEmpty)
        try expect(try isolated.counts() == .init())
        // Failure reasons are local-only normalized codes and committed
        // atomically with the same baseline/revision fence as the queue state.
        // Reopen the database to prove that diagnostics survive an app restart.
        let reasonFile = dir.appendingPathComponent("failure-reasons.sqlite3")
        do {
            let reasons = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: reasonFile)
            _ = try reasons.installBaselineIfAbsent(token: Data([10]), authorization: 3)
            _ = try reasons.apply(inserted: ["reason-video"], updated: [], deleted: [],
                                  expectedToken: Data([10]), nextToken: Data([11]), authorization: 3)
            guard let item = try reasons.pending().first else {
                preconditionFailure("failure test candidate missing")
            }
            do {
                _ = try reasons.settle(item, result: .failed,
                                       reasonCode: "http-403-secret-body",
                                       expectedBaselineToken: Data([11]), authorization: 3)
                preconditionFailure("arbitrary remote error body persisted")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.invalidInput {}
            try expect(try reasons.status(for: "reason-video")?.state == .pending)
            try expect(try reasons.settle(item, result: .failed,
                                           reasonCode: "incompleteLivePair",
                                           expectedBaselineToken: Data([11]), authorization: 3))
            try expect(try reasons.status(for: "reason-video")?.failureReasonCode ==
                       "incompleteLivePair")
            try expect(try reasons.failureReasonCounts()["incompleteLivePair"] == 1)
        }
        do {
            let reopened = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: reasonFile)
            try expect(try reopened.status(for: "reason-video")?.failureReasonCode ==
                       "incompleteLivePair")
            try expect(try reopened.failureReasonCounts()["incompleteLivePair"] == 1)
            guard let item = try reopened.failed().first else {
                preconditionFailure("durable failure missing after reopen")
            }
            do {
                _ = try reopened.retryFailed(item, expectedBaselineToken: Data([99]),
                                             authorization: 3)
                preconditionFailure("stale baseline retried failure")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            try expect(try reopened.retryFailed(item, expectedBaselineToken: Data([11]),
                                                authorization: 3))
            try expect(try reopened.failureReasonCounts().isEmpty)
            try expect(try reopened.status(for: "reason-video")?.failureReasonCode == nil)
            // A second item-local failure of the same queued revision must
            // NOT redisplay the previous attempt's old reason code.
            try expect(try reopened.settle(
                item, result: .failed, expectedBaselineToken: Data([11]),
                authorization: 3
            ))
            try expect(try reopened.status(for: "reason-video")?.failureReasonCode == nil)
            try expect(try reopened.retryFailed(
                item, expectedBaselineToken: Data([11]), authorization: 3
            ))
            _ = try reopened.apply(inserted: [], updated: ["reason-video"], deleted: [],
                                   expectedToken: Data([11]), nextToken: Data([12]),
                                   authorization: 3)
            try expect(try reopened.status(for: "reason-video")?.failureReasonCode == nil)
            try expect(try reopened.failureReasonCounts().isEmpty)
        }
        // One manually selected failed item may be outside the first
        // 64 priority-ordered failures. Indexed ID+revision retry must
        // affect only that item, regardless of automatic batch ordering.
        let beyond64 = dir.appendingPathComponent("selected-beyond-64.sqlite3")
        do {
            let large = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: beyond64)
            let names = (0..<70).map { "selection-\($0)" }
            let before = Data([20]), after = Data([21])
            try expect(try large.installBaselineIfAbsent(
                token: before, authorization: 3
            ))
            _ = try large.apply(
                inserted: Set(names), updated: [], deleted: [],
                expectedToken: before, nextToken: after, authorization: 3
            )
            for id in names {
                let candidate = XDriveIOSPhotoBackupChangeQueueStore.Pending(
                    localIdentifier: id, revision: 1, priority: 2
                )
                try expect(try large.settle(
                    candidate, result: .failed,
                    expectedBaselineToken: after, authorization: 3
                ))
            }
            // A task-list UI must page durable entries without materializing
            // all identifiers, leaking raw error strings or shifting order.
            let firstPage = try large.page(state: .failed, offset: 0, limit: 32)
            let secondPage = try large.page(state: .failed, offset: 32, limit: 32)
            let tailPage = try large.page(state: .failed, offset: 64, limit: 32)
            precondition(firstPage.count == 32 && secondPage.count == 32 &&
                         tailPage.count == 6)
            precondition(Set((firstPage + secondPage + tailPage).map(\.localIdentifier)).count == 70)
            precondition(firstPage.allSatisfy { $0.state == .failed && $0.revision == 1 })
            try expect(try large.page(state: .waitingICloud).isEmpty)
            do {
                _ = try large.page(offset: -1)
                fatalError("negative UI cursor admitted")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.invalidInput {}
            do {
                _ = try large.page(limit: 65)
                fatalError("unbounded UI page admitted")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.invalidInput {}
            let head = try large.failed(limit: 64)
            try expect(head.count == 64)
            let included = Set(head.map(\.localIdentifier))
            guard let selectedID = names.first(where: { !included.contains($0) }),
                  let status = try large.status(for: selectedID),
                  status.state == .failed else {
                preconditionFailure("70 failed revisions must include a non-head item")
            }
            let single = XDriveIOSPhotoBackupChangeQueueStore.Pending(
                localIdentifier: selectedID, revision: status.revision, priority: 0
            )
            try expect(try !large.retryFailed(
                .init(localIdentifier: selectedID, revision: status.revision + 1, priority: 0),
                expectedBaselineToken: after, authorization: 3
            ))
            try expect(try large.retryFailed(
                single, expectedBaselineToken: after, authorization: 3
            ))
            try expect(try large.status(for: selectedID)?.state == .pending)
            try expect(try large.counts() == .init(
                pending: 1, failed: 69, waitingICloud: 0,
                confirmed: 0, missingLocal: 0
            ))
            try expect(try large.failed(limit: 64).count == 64)
        }
        // Persisted diagnostic rows must be retired with the same PhotoKit
        // edit/delete transaction, and atomically cleared by a full recovery.
        // Historical counts hide orphans; inspect the actual encrypted-at-rest
        // Owner-local SQLite table to catch storage/privacy retention.
        let lifecycleFile = dir.appendingPathComponent("failure-reasons-lifecycle.sqlite3")
        do {
            let lifecycle = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: lifecycleFile)
            let initial = Data([31]), recorded = Data([32]), changed = Data([33])
            try expect(try lifecycle.installBaselineIfAbsent(
                token: initial, authorization: 3
            ))
            _ = try lifecycle.apply(
                inserted: ["edited-original", "deleted-original", "untouched-original"],
                updated: [], deleted: [],
                expectedToken: initial, nextToken: recorded, authorization: 3
            )
            for id in ["edited-original", "deleted-original", "untouched-original"] {
                let status = try lifecycle.status(for: id)
                guard let revision = status?.revision else {
                    preconditionFailure("missing lifecycle candidate")
                }
                try expect(try lifecycle.settle(
                    .init(localIdentifier: id, revision: revision, priority: 0),
                    result: .failed, reasonCode: "originalMissing",
                    expectedBaselineToken: recorded, authorization: 3
                ))
            }
            try expect(rawFailureReasonRows(at: lifecycleFile) == 3)
            _ = try lifecycle.apply(
                inserted: [], updated: ["edited-original"],
                deleted: ["deleted-original"],
                expectedToken: recorded, nextToken: changed, authorization: 3
            )
            try expect(try lifecycle.status(for: "edited-original")?.state == .pending)
            try expect(try lifecycle.status(for: "deleted-original")?.state == .missingLocal)
            try expect(try lifecycle.status(for: "untouched-original")?.failureReasonCode
                       == "originalMissing")
            try expect(rawFailureReasonRows(at: lifecycleFile) == 1)
            try lifecycle.completeFullReconciliation(
                token: Data([34]), authorization: 3
            )
            try expect(rawFailureReasonRows(at: lifecycleFile) == 0)
            try expect(try lifecycle.counts() == .init())
            try expect(try lifecycle.baseline()?.token == Data([34]))
        }
        // Combined recovery: an old-capture-date photo can be freshly
        // imported and must survive token replay + app restart. Editing a
        // previously confirmed photo revokes that *revision's* local ACK;
        // deleting a photo is a tombstone, never permission to delete CAS.
        // A lost Server finalize ACK is never fabricated by SQLite.
        let crashFile = dir.appendingPathComponent("restart-old-import-edit-delete.sqlite3")
        let t0 = Data([90]), t1 = Data([91]), t2 = Data([92])
        var confirmedBeforeEdit: XDriveIOSPhotoBackupChangeQueueStore.Pending?
        do {
            let active = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: crashFile)
            try expect(try active.installBaselineIfAbsent(token: t0, authorization: 3))
            _ = try active.apply(
                inserted: ["previous-confirmed", "will-delete"],
                updated: [], deleted: [], expectedToken: t0,
                nextToken: t1, authorization: 3
            )
            let first = try active.pending()
            guard let original = first.first(where: {
                $0.localIdentifier == "previous-confirmed"
            }) else { preconditionFailure("confirmed source missing") }
            confirmedBeforeEdit = original
            try expect(try active.settle(
                original, result: .confirmed,
                expectedBaselineToken: t1, authorization: 3
            ))
        }
        do {
            let restarted = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: crashFile)
            try expect(try restarted.baseline()?.token == t1)
            try expect(try restarted.status(for: "previous-confirmed")?.state == .confirmed)
            _ = try restarted.apply(
                inserted: ["import-with-old-capture-date"],
                updated: ["previous-confirmed"],
                deleted: ["will-delete"],
                expectedToken: t1, nextToken: t2, authorization: 3
            )
            let statuses = try restarted.counts()
            precondition(statuses.pending == 2 && statuses.confirmed == 0 &&
                         statuses.missingLocal == 1)
            guard let prior = confirmedBeforeEdit else {
                preconditionFailure("missing old receipt candidate")
            }
            try expect(try !restarted.settle(
                prior, result: .confirmed, expectedBaselineToken: t2,
                authorization: 3
            ))
            let chosen = try restarted.pending()
            precondition(chosen.contains(where: {
                $0.localIdentifier == "import-with-old-capture-date" &&
                $0.priority == 2
            }))
            // An interrupted/uncertain write is not a SQLite confirmation.
            // Preserve this pending revision and replay token after restart.
        }
        do {
            let rebooted = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: crashFile)
            try expect(try rebooted.baseline()?.token == t2)
            try expect(try rebooted.counts().pending == 2)
            try expect(try rebooted.counts().confirmed == 0)
            try expect(try rebooted.status(for: "will-delete")?.state == .missingLocal)
            do {
                _ = try rebooted.apply(
                    inserted: ["cannot-advance-unknown"],
                    updated: [], deleted: [], expectedToken: t1,
                    nextToken: Data([93]), authorization: 3
                )
                fatalError("stale reboot token was accepted")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
            try expect(try rebooted.baseline()?.token == t2)
            try rebooted.completeFullReconciliation(
                token: Data([94]), authorization: 3
            )
            try expect(try rebooted.counts() == .init())
            try expect(try rebooted.hasCompletedFullReconciliation(
                token: Data([94]), authorization: 3
            ))
        }
        // Real SQLite automatic retry: only safe item-local failures,
        // one exact revision, three persisted attempts and finite cooldowns.
        // Unsupported items and unknown remote ACKs never enter this path.
        let automaticFile = dir.appendingPathComponent("automatic-retry.sqlite3")
        let retryToken0 = Data([110]), retryToken1 = Data([111])
        let retryTime = Date(timeIntervalSince1970: 3_000_000)
        do {
            let retry = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: automaticFile)
            try expect(try retry.installBaselineIfAbsent(
                token: retryToken0, authorization: 3
            ))
            _ = try retry.apply(
                inserted: ["recoverable", "unsupported-type"], updated: [],
                deleted: [], expectedToken: retryToken0,
                nextToken: retryToken1, authorization: 3
            )
            let items = try retry.pending()
            guard let recoverable = items.first(where: {
                    $0.localIdentifier == "recoverable"
                  }), let unsupported = items.first(where: {
                    $0.localIdentifier == "unsupported-type"
                  }) else { preconditionFailure("missing retry fixtures") }
            try expect(try retry.settle(
                recoverable, result: .failed, reasonCode: "unavailable",
                expectedBaselineToken: retryToken1, authorization: 3
            ))
            try expect(try retry.settle(
                unsupported, result: .failed, reasonCode: "unsupported",
                expectedBaselineToken: retryToken1, authorization: 3
            ))
            try expect(try retry.automaticRetryCandidates(
                limit: 4, now: retryTime
            ).map(\.localIdentifier) == ["recoverable"])
            let attempts: [TimeInterval] = [0, 15 * 60, 15 * 60 + 60 * 60]
            for (index, elapsed) in attempts.enumerated() {
                let moment = retryTime.addingTimeInterval(elapsed)
                try expect(try retry.retryFailedAutomatically(
                    recoverable, expectedBaselineToken: retryToken1,
                    authorization: 3, now: moment
                ))
                try expect(try retry.settle(
                    recoverable, result: .failed, reasonCode: "unavailable",
                    expectedBaselineToken: retryToken1, authorization: 3
                ))
                if index < 2 {
                    try expect(try retry.automaticRetryCandidates(
                        limit: 4, now: moment
                    ).isEmpty)
                }
            }
            try expect(try retry.automaticRetryCandidates(
                limit: 4, now: retryTime.addingTimeInterval(200_000)
            ).isEmpty)
            try expect(try !retry.retryFailedAutomatically(
                recoverable, expectedBaselineToken: retryToken1,
                authorization: 3,
                now: retryTime.addingTimeInterval(200_000)
            ))
            // An explicit user request can still reset a previously exhausted
            // item without bypassing receipt review or the exact revision CAS.
            try expect(try retry.retryFailed(
                recoverable, expectedBaselineToken: retryToken1,
                authorization: 3
            ))
            try expect(try retry.settle(
                recoverable, result: .failed, reasonCode: "unavailable",
                expectedBaselineToken: retryToken1, authorization: 3
            ))
            try expect(try retry.automaticRetryCandidates(
                limit: 4, now: retryTime
            ).count == 1)
        }

        print("iOS PhotoKit change queue atomic token+priority+restart+Owner isolation+failure codes: PASS")
    }
}
