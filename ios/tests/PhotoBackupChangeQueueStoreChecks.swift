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
            try expect(try store.retryFailed(newer))
            try expect(try !store.retryFailed(newer))
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
        let isolated = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: dir.appendingPathComponent("owner-b.sqlite3"))
        try expect(try isolated.baseline() == nil)
        try expect(try isolated.pending().isEmpty)
        try expect(try isolated.counts() == .init())
        print("iOS PhotoKit change queue atomic token+priority+restart+Owner isolation: PASS")
    }
}
