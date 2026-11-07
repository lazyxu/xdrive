import Foundation

private func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw NSError(domain: message, code: 1) }
}

@main
struct NativePhotoFingerprintStoreChecks {
    static func main() throws {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("xdrive-gallery-index-check-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("index.sqlite")
        try populate(file)
        try reopen(file)
        try incremental(folder.appendingPathComponent("delta.sqlite"))
        print("Gallery fingerprint persistence, 100k lookup, bounded PhotoKit delta, crash/retry and fail-closed coverage checks passed")
    }


    /// One changed photo, one deleted photo and one new iCloud-only original
    /// must never require rescanning the other fingerprints or prove a false
    /// cloud-only/whole-library state.
    private static func incremental(_ file: URL) throws {
        do {
            let store = try XDriveIOSNativePhotoFingerprintStore(fileURL: file)
            try store.begin(library: Data([10]), invalidate: nil)
            try store.record([
                (id: "a", fingerprint: "hash-a", probe: Data([1])),
                (id: "b", fingerprint: "hash-b", probe: Data([2]))
            ])
            try store.startFullInventory()
            try store.recordInventory([
                .init(id: "a", kind: "image", readable: true),
                .init(id: "b", kind: "video", readable: true),
                .init(id: "c", kind: "live_photo", readable: false)
            ])
            let baseline = try store.finishFullInventory(checked: 3)
            try require(baseline.checked == 3 && baseline.unavailable == 1, "full inventory is exact")
            try require(try store.hasCompleteInventory(), "completed inventory is durable")
            try store.advanceWithoutAssetChanges(library: Data([11]))
            try require(try store.state()?.checked == 3, "album-only token preserves coverage")
            try store.prepareIncremental(library: Data([12]), changed: [
                .init(id: "a", kind: "image"),
                .init(id: "b", kind: nil),
                .init(id: "d", kind: "video")
            ], expectedCount: 3)
            try require(try store.state()?.checked == nil, "pending delta revokes full coverage")
            try require(try store.probe(id: "a") == nil, "modified original's hash is invalidated")
            try require(try store.probe(id: "b") == nil, "deleted original's hash is invalidated")
            let pending = try store.incrementalWork()
            try require(pending?.total == 2 && pending?.checked == 0, "only changed accessible items are queued")
            try require(pending?.assets.map(\.id) == ["a", "d"], "old unchanged assets are not requeued")
            do {
                _ = try store.finishIncremental()
                throw NSError(domain: "pending delta falsely completed", code: 1)
            } catch XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord {}
            do {
                try store.resolvePending([.init(id: "a", kind: "video",
                                                fingerprint: "wrong", probe: Data([99]))])
                throw NSError(domain: "wrong-kind proof accepted", code: 1)
            } catch XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord {}
        }

        // Reopen simulates an app termination midway through the delta.
        do {
            let store = try XDriveIOSNativePhotoFingerprintStore(fileURL: file)
            try require(try store.state()?.checked == nil, "relaunch cannot resurrect pending coverage")
            try require(try store.incrementalWork()?.assets.count == 2, "relaunch resumes changed IDs")
            try store.resolvePending([
                .init(id: "a", kind: "image", fingerprint: "hash-a2", probe: Data([10])),
                .init(id: "d", kind: "video", fingerprint: nil, probe: nil)
            ])
            let done = try store.finishIncremental()
            try require(done.checked == 3 && done.unavailable == 2, "only unreadable originals remain uncertain")
            try require(done.unavailableByKind?["video"] == 1, "new iCloud-only video is not absence")
            try require(done.unavailableByKind?["live_photo"] == 1, "unchanged failed Live asset remains uncertain")
            try require(try store.hasCompleteInventory(), "resolved delta restores exact scope proof")
            try require(try store.localIDs(fingerprint: "hash-a2") == ["a"], "modified original reindexed")
            try require(try store.localIDs(fingerprint: "hash-b").isEmpty, "deleted original stays removed")
            // Explicit retry hashes only two unavailable originals.
            try require(try store.prepareUnavailableRetry(), "unavailable retry queues")
            try require(try store.incrementalWork()?.total == 2, "retry is bounded to unavailable IDs")
            try store.resolvePending([
                .init(id: "c", kind: "live_photo", fingerprint: nil, probe: nil),
                .init(id: "d", kind: "video", fingerprint: "hash-d", probe: Data([4]))
            ])
            let retried = try store.finishIncremental()
            try require(retried.unavailable == 1 && retried.unavailableByKind?["video"] == 0,
                        "retry only promotes proven bytes")
            do {
                try store.prepareIncremental(library: Data([13]), changed: [
                    .init(id: "a", kind: nil)
                ], expectedCount: 3)
                throw NSError(domain: "inconsistent PhotoKit generation accepted", code: 1)
            } catch XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord {}
            try require(try store.state()?.library == Data([12]), "invalid delta rolls back epoch atomically")
            try require(try store.localIDs(fingerprint: "hash-a2") == ["a"], "failed delta preserves proofs")
            try store.begin(library: Data([14]), invalidate: ["a"])
            try require(try store.state()?.checked == nil, "large or expired change history fails closed")
            try require(try store.incrementalWork() == nil, "fallback never inherits stale delta")
            try require(try store.probe(id: "a") == nil, "fallback invalidates changed hash")
            try require(try store.probe(id: "d") != nil, "fallback retains proven unchanged originals")
            try store.startFullInventory()
            try store.recordInventory([.init(id: "d", kind: "video", readable: true)])
            try require(try store.state()?.checked == nil, "partial full scan does not prove absence")
        }
        let reopened = try XDriveIOSNativePhotoFingerprintStore(fileURL: file)
        try require(try reopened.state()?.checked == nil, "interrupted full scan is never complete")
        try require(!(try reopened.hasCompleteInventory()), "partial inventory cannot be treated as complete")
    }

    private static func populate(_ file: URL) throws {
        let store = try XDriveIOSNativePhotoFingerprintStore(fileURL: file)
        try require(try store.state() == nil, "new index has no absence proof")
        try store.begin(library: Data([1]), invalidate: nil)
        for start in stride(from: 0, to: 100_000, by: 256) {
            let batch = (start..<min(100_000, start + 256)).map { index in
                (id: "asset-\(index)", fingerprint: "content-\(index)", probe: Data("probe-\(index)".utf8))
            }
            try store.record(batch)
        }
        try require(try store.state()?.checked == nil, "100k positive fingerprints still require completed scan")
        try require(try store.localIDs(fingerprint: "content-99999") == ["asset-99999"], "oldest indexed item survives 100k")
        try require(try store.probe(id: "asset-512") == Data("probe-512".utf8), "paging never evicts an earlier association")
        try store.finish(checked: 100_000, unavailable: 0)
        try require(try store.state()?.checked == 100_000, "complete authorized scan is durable")
        try require(try store.state()?.unavailable == 0, "full readable coverage")
    }

    private static func reopen(_ file: URL) throws {
        let store = try XDriveIOSNativePhotoFingerprintStore(fileURL: file)
        try require(try store.state()?.checked == 100_000, "reopen retains completed scan")
        try require(try store.localIDs(fingerprint: "content-99999") == ["asset-99999"], "reopen retains reverse match")
        try store.begin(library: Data([2]), invalidate: ["asset-7"])
        try require(try store.probe(id: "asset-7") == nil, "changed asset cannot reuse old fingerprint")
        try require(try store.probe(id: "asset-8") != nil, "unchanged asset avoids rehash")
        try require(try store.state()?.checked == nil, "changed generation loses absence proof")
        try store.record([(id: "asset-new", fingerprint: "content-8", probe: Data([8]))])
        try require(try store.localIDs(fingerprint: "content-8").count == 2, "duplicate local originals stay ambiguous")
        do {
            try store.record([
                (id: "must-rollback", fingerprint: "first", probe: Data([1])),
                (id: "", fingerprint: "invalid", probe: Data([1]))
            ])
            throw NSError(domain: "invalid transaction accepted", code: 1)
        } catch XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord {}
        try require(try store.probe(id: "must-rollback") == nil, "failed batch rolls back all entries")
        try store.finish(checked: 100_001, unavailable: 1)
        try require(try store.state()?.unavailable == 1, "unreadable originals cannot prove absence")
        try require(try store.state()?.unavailableByKind == nil, "legacy coverage cannot invent per-kind absence")
        try store.finish(checked: 100_001, unavailable: 1, unavailableByKind: ["image": 0, "video": 1, "live_photo": 0])
        try require(try store.state()?.unavailableByKind?["image"] == 0, "unavailable video does not block image coverage")
        do {
            try store.finish(checked: 100_001, unavailable: 1, unavailableByKind: ["image": 0, "video": 0, "live_photo": 0])
            throw NSError(domain: "inconsistent type coverage accepted", code: 1)
        } catch XDriveIOSNativePhotoFingerprintStore.Failure.invalidRecord {}
        try require(try store.state()?.unavailableByKind?["video"] == 1, "invalid coverage did not erase prior evidence")
        try store.begin(library: Data([3]), invalidate: nil)
        try require(try store.probe(id: "asset-8") == nil, "expired history invalidates all old fingerprints")
        try store.finish(checked: 0, unavailable: 0)
        try require(try store.state()?.checked == 0, "empty authorized library completes")
    }
}
