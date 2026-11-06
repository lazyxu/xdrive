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
        print("Gallery fingerprint index persistence, 100k lookup, ambiguity and coverage checks passed")
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
        try store.begin(library: Data([3]), invalidate: nil)
        try require(try store.probe(id: "asset-8") == nil, "expired history invalidates all old fingerprints")
        try store.finish(checked: 0, unavailable: 0)
        try require(try store.state()?.checked == 0, "empty authorized library completes")
    }
}
