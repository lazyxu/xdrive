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
            precondition(pending.first?.localIdentifier == "later")
            precondition(pending.last?.localIdentifier == "old" && pending.last?.revision == 2)
            try expect(try store.baseline()?.token == later)
            do {
                _ = try store.apply(inserted: ["different"], updated: [], deleted: [],
                                    expectedToken: later, nextToken: Data([4]), authorization: 4)
                fatalError("expected auth guard")
            } catch XDriveIOSPhotoBackupChangeQueueStore.Failure.baselineChanged {}
        }
        let isolated = try XDriveIOSPhotoBackupChangeQueueStore(fileURL: dir.appendingPathComponent("owner-b.sqlite3"))
        try expect(try isolated.baseline() == nil)
        try expect(try isolated.pending().isEmpty)
        print("iOS PhotoKit change queue atomic token+priority+restart+Owner isolation: PASS")
    }
}
