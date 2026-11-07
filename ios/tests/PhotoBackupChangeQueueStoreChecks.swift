import Foundation

@main struct XDriveIOSPhotoBackupChangeQueueStoreChecks {
    static func expect(_ check: @autoclosure () throws -> Bool) rethrows {
        let succeeded = try check()
        precondition(succeeded)
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
        print("iOS PhotoKit change queue atomic token+priority+restart+Owner isolation+failure codes: PASS")
    }
}
