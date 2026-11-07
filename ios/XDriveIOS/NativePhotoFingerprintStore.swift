import Foundation
import SQLite3

/// Crash-safe, disk-backed fingerprints for one authorized PhotoKit scope.
/// An incomplete or interrupted scan can supply positive fingerprints only.
final class XDriveIOSNativePhotoFingerprintStore {
    enum Failure: Error {
        case database(Int32)
        case invalidRecord
    }

    struct State {
        let library: Data
        let checked: Int?
        let unavailable: Int?
        let unavailableByKind: [String: Int]?
    }

    /// The inventory records every readable or unavailable original in a
    /// completed PhotoKit generation. An unreadable original is not absence.
    struct InventoryEntry {
        let id: String
        let kind: String
        let readable: Bool
    }

    struct ChangedAsset {
        let id: String
        let kind: String? // nil means deleted or no longer supported
    }

    struct PendingAsset {
        let id: String
        let kind: String
    }

    struct PendingWork {
        let total: Int
        let checked: Int
        let assets: [PendingAsset]
    }

    struct ResolvedAsset {
        let id: String
        let kind: String
        let fingerprint: String?
        let probe: Data?
    }

    private enum Binding {
        case text(String), blob(Data), integer(Int)
    }

    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(fileURL: URL) throws {
        let code = sqlite3_open_v2(
            fileURL.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil
        )
        guard code == SQLITE_OK else {
            if let db { sqlite3_close_v2(db) }
            db = nil
            throw Failure.database(code)
        }
        do {
            try execute("PRAGMA journal_mode=DELETE")
            try execute("PRAGMA synchronous=FULL")
            try execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), library BLOB NOT NULL, checked INTEGER, unavailable INTEGER)")
            try execute("CREATE TABLE IF NOT EXISTS fingerprints (local_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, probe BLOB NOT NULL)")
            try execute("CREATE INDEX IF NOT EXISTS fingerprints_by_content ON fingerprints(fingerprint)")
            try execute("CREATE TABLE IF NOT EXISTS coverage (kind TEXT PRIMARY KEY, unavailable INTEGER NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS inventory (local_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status INTEGER NOT NULL CHECK(status IN (0, 1, 2)))")
            try execute("CREATE INDEX IF NOT EXISTS inventory_by_status ON inventory(status)")
            // A pending delta is journaled separately from positive hashes.
            // A crash cannot accidentally promote it to complete coverage.
            try execute("CREATE TABLE IF NOT EXISTS incremental (id INTEGER PRIMARY KEY CHECK(id = 1), total INTEGER NOT NULL)")
        } catch {
            if let db { sqlite3_close_v2(db) }
            db = nil
            throw error
        }
    }

    deinit { if let db { sqlite3_close_v2(db) } }

    func state() throws -> State? {
        var kinds: [String: Int] = [:]
        try statement("SELECT kind, unavailable FROM coverage") { stmt in
            while true {
                let code = sqlite3_step(stmt)
                if code == SQLITE_DONE { break }
                guard code == SQLITE_ROW, let kind = sqlite3_column_text(stmt, 0) else { throw Failure.invalidRecord }
                kinds[String(cString: kind)] = Int(sqlite3_column_int64(stmt, 1))
            }
        }
        return try statement("SELECT library, checked, unavailable FROM state WHERE id = 1") { stmt in
            let code = sqlite3_step(stmt)
            if code == SQLITE_DONE { return nil }
            guard code == SQLITE_ROW, let token = try blob(stmt, column: 0, maximum: 65_536) else {
                throw Failure.invalidRecord
            }
            let checked = sqlite3_column_type(stmt, 1) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 1))
            let unavailable = sqlite3_column_type(stmt, 2) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(stmt, 2))
            guard (checked == nil) == (unavailable == nil),
                  checked.map({ $0 >= 0 }) ?? true,
                  unavailable.map({ $0 >= 0 && $0 <= (checked ?? -1) }) ?? true else {
                throw Failure.invalidRecord
            }
            let completeKinds = unavailable.map { Self.validCoverage(kinds, total: $0) } == true
            return State(library: token, checked: checked, unavailable: unavailable,
                         unavailableByKind: completeKinds ? kinds : nil)
        }
    }

    /// A token and invalidation of all affected rows commit together.
    func begin(library: Data, invalidate: Set<String>?) throws {
        guard !library.isEmpty, library.count <= 65_536 else { throw Failure.invalidRecord }
        try transaction {
            if let invalidate {
                for id in invalidate {
                    try update("DELETE FROM fingerprints WHERE local_id = ?", [.text(id)])
                }
            } else {
                try execute("DELETE FROM fingerprints")
            }
            try update("INSERT OR REPLACE INTO state (id, library) VALUES (1, ?)", [.blob(library)])
            try execute("DELETE FROM coverage")
            try execute("DELETE FROM inventory")
            try execute("DELETE FROM incremental")
        }
    }

    func record(_ values: [(id: String, fingerprint: String, probe: Data)]) throws {
        guard !values.isEmpty else { return }
        try transaction {
            for value in values {
                guard !value.id.isEmpty, value.id.utf8.count <= 1024,
                      !value.fingerprint.isEmpty, value.fingerprint.utf8.count <= 320,
                      !value.probe.isEmpty, value.probe.count <= 1024 else { throw Failure.invalidRecord }
                try update("INSERT OR REPLACE INTO fingerprints VALUES (?, ?, ?)",
                           [.text(value.id), .text(value.fingerprint), .blob(value.probe)])
            }
        }
    }

    func finish(checked: Int, unavailable: Int, unavailableByKind: [String: Int]? = nil) throws {
        guard checked >= 0, unavailable >= 0, unavailable <= checked else { throw Failure.invalidRecord }
        if let kinds = unavailableByKind {
            guard Self.validCoverage(kinds, total: unavailable) else { throw Failure.invalidRecord }
        }
        // A complete scan must have the expected number of distinct readable
        // IDs. A skipped or repeated slot cannot turn into proof of absence.
        let count: Int = try statement("SELECT COUNT(*) FROM fingerprints") { stmt in
            guard sqlite3_step(stmt) == SQLITE_ROW else { throw Failure.invalidRecord }
            return Int(sqlite3_column_int64(stmt, 0))
        }
        guard count >= checked - unavailable, count <= checked else { throw Failure.invalidRecord }
        try transaction {
            try update("UPDATE state SET checked = ?, unavailable = ? WHERE id = 1",
                       [.integer(checked), .integer(unavailable)])
            try execute("DELETE FROM coverage")
            for (kind, missing) in unavailableByKind ?? [:] {
                try update("INSERT INTO coverage VALUES (?, ?)", [.text(kind), .integer(missing)])
            }
        }
    }


    /// Preserve exact coverage when PhotoKit reports no asset-level changes
    /// (for example, an album-only edit). The caller has already replayed the
    /// complete change-token chain and checked the new token.
    func advanceWithoutAssetChanges(library: Data) throws {
        guard !library.isEmpty, library.count <= 65_536,
              try state() != nil else { throw Failure.invalidRecord }
        try update("UPDATE state SET library = ? WHERE id = 1", [.blob(library)])
    }

    /// Legacy stores have fingerprints but no complete inventory; they must
    /// build the inventory once before asset deltas can prove whole-library
    /// absence. Count, readability and the kind-specific misses must agree.
    func hasCompleteInventory() throws -> Bool {
        guard let saved = try state(), let checked = saved.checked,
              let unavailable = saved.unavailable, saved.unavailableByKind != nil,
              try count("SELECT COUNT(*) FROM incremental") == 0 else { return false }
        return try count("SELECT COUNT(*) FROM inventory") == checked &&
            count("SELECT COUNT(*) FROM inventory WHERE status = 0") == unavailable &&
            count("SELECT COUNT(*) FROM inventory WHERE status = 2") == 0 &&
            count("SELECT COUNT(*) FROM fingerprints") == checked - unavailable &&
            count("SELECT COUNT(*) FROM inventory WHERE status = 1 AND local_id NOT IN (SELECT local_id FROM fingerprints)") == 0
    }

    /// After a successful bounded persistent-change replay, atomically retire
    /// only changed fingerprints. Pending assets are read by scan() later;
    /// coverage is NULL until *all* pending originals have been resolved.
    func prepareIncremental(library: Data, changed: [ChangedAsset],
                            expectedCount: Int) throws {
        guard !library.isEmpty, library.count <= 65_536, expectedCount >= 0,
              changed.count <= 128, Set(changed.map(\.id)).count == changed.count,
              changed.allSatisfy({ !$0.id.isEmpty && $0.id.utf8.count <= 1024 &&
                  ($0.kind.map(Self.validKind) ?? true) }),
              try hasCompleteInventory() else { throw Failure.invalidRecord }
        try transaction {
            for item in changed {
                try update("DELETE FROM fingerprints WHERE local_id = ?", [.text(item.id)])
                try update("DELETE FROM inventory WHERE local_id = ?", [.text(item.id)])
                if let kind = item.kind {
                    try update("INSERT INTO inventory VALUES (?, ?, 2)",
                               [.text(item.id), .text(kind)])
                }
            }
            guard try count("SELECT COUNT(*) FROM inventory") == expectedCount else {
                throw Failure.invalidRecord
            }
            let pending = try count("SELECT COUNT(*) FROM inventory WHERE status = 2")
            try update("UPDATE state SET library = ?, checked = NULL, unavailable = NULL WHERE id = 1",
                       [.blob(library)])
            try execute("DELETE FROM coverage")
            try update("INSERT OR REPLACE INTO incremental VALUES (1, ?)", [.integer(pending)])
        }
    }

    /// Explicit retry only revisits a bounded set of previously unreadable
    /// originals, never rehashing the already-verified 19k/100k originals.
    func prepareUnavailableRetry(limit: Int = 64) throws -> Bool {
        guard limit > 0, limit <= 128, try hasCompleteInventory() else { return false }
        let ids = try statement("SELECT local_id FROM inventory WHERE status = 0 ORDER BY local_id LIMIT ?",
                                [.integer(limit)]) { stmt -> [String] in
            var values: [String] = []
            while true {
                let code = sqlite3_step(stmt)
                if code == SQLITE_DONE { break }
                guard code == SQLITE_ROW, let name = sqlite3_column_text(stmt, 0) else {
                    throw Failure.invalidRecord
                }
                values.append(String(cString: name))
            }
            return values
        }
        guard !ids.isEmpty else { return false }
        try transaction {
            for id in ids {
                try update("UPDATE inventory SET status = 2 WHERE local_id = ? AND status = 0", [.text(id)])
            }
            try execute("UPDATE state SET checked = NULL, unavailable = NULL WHERE id = 1")
            try execute("DELETE FROM coverage")
            try update("INSERT INTO incremental VALUES (1, ?)", [.integer(ids.count)])
        }
        return true
    }

    func incrementalWork(limit: Int = 64) throws -> PendingWork? {
        let total: Int? = try statement("SELECT total FROM incremental WHERE id = 1") { stmt in
            let code = sqlite3_step(stmt)
            if code == SQLITE_DONE { return nil }
            guard code == SQLITE_ROW else { throw Failure.invalidRecord }
            return Int(sqlite3_column_int64(stmt, 0))
        }
        guard let total else { return nil }
        let remaining = try count("SELECT COUNT(*) FROM inventory WHERE status = 2")
        guard total >= 0, remaining <= total, limit > 0, limit <= 128 else {
            throw Failure.invalidRecord
        }
        let items = try statement(
            "SELECT local_id, kind FROM inventory WHERE status = 2 ORDER BY local_id LIMIT ?",
            [.integer(limit)]
        ) { stmt -> [PendingAsset] in
            var values: [PendingAsset] = []
            while true {
                let code = sqlite3_step(stmt)
                if code == SQLITE_DONE { return values }
                guard code == SQLITE_ROW,
                      let id = sqlite3_column_text(stmt, 0),
                      let kind = sqlite3_column_text(stmt, 1) else { throw Failure.invalidRecord }
                values.append(PendingAsset(id: String(cString: id), kind: String(cString: kind)))
            }
        }
        return PendingWork(total: total, checked: total - remaining, assets: items)
    }

    /// Every row being committed must still be pending for the exact kind.
    /// Both the pending flag and fingerprint commit in a single transaction.
    func resolvePending(_ changes: [ResolvedAsset]) throws {
        guard changes.count <= 64, Set(changes.map(\.id)).count == changes.count else {
            throw Failure.invalidRecord
        }
        try transaction {
            guard try count("SELECT COUNT(*) FROM incremental") == 1 else {
                throw Failure.invalidRecord
            }
            for item in changes {
                guard Self.validKind(item.kind), !item.id.isEmpty, item.id.utf8.count <= 1024,
                      (item.fingerprint == nil) == (item.probe == nil) else {
                    throw Failure.invalidRecord
                }
                let matching = try statement(
                    "SELECT COUNT(*) FROM inventory WHERE local_id = ? AND kind = ? AND status = 2",
                    [.text(item.id), .text(item.kind)]
                ) { stmt -> Int in
                    guard sqlite3_step(stmt) == SQLITE_ROW else { throw Failure.invalidRecord }
                    return Int(sqlite3_column_int64(stmt, 0))
                }
                guard matching == 1 else { throw Failure.invalidRecord }
                if let fingerprint = item.fingerprint, let probe = item.probe {
                    guard !fingerprint.isEmpty, fingerprint.utf8.count <= 320,
                          !probe.isEmpty, probe.count <= 1024 else { throw Failure.invalidRecord }
                    try update("INSERT OR REPLACE INTO fingerprints VALUES (?, ?, ?)",
                               [.text(item.id), .text(fingerprint), .blob(probe)])
                }
                try update("UPDATE inventory SET status = ? WHERE local_id = ?",
                           [.integer(item.probe == nil ? 0 : 1), .text(item.id)])
            }
        }
    }

    /// On an interrupted full scan, no old coverage may survive. Previously
    /// hashed originals remain reusable, but a fresh bounded inventory must
    /// be enumerated before declaring cloud-only/absence.
    func startFullInventory() throws {
        try transaction {
            try execute("DELETE FROM incremental")
            try execute("DELETE FROM inventory")
            try execute("UPDATE state SET checked = NULL, unavailable = NULL WHERE id = 1")
            try execute("DELETE FROM coverage")
        }
    }

    func recordInventory(_ rows: [InventoryEntry]) throws {
        guard rows.count <= 64 else { throw Failure.invalidRecord }
        try transaction {
            for row in rows {
                guard !row.id.isEmpty, row.id.utf8.count <= 1024, Self.validKind(row.kind) else {
                    throw Failure.invalidRecord
                }
                try update("INSERT INTO inventory VALUES (?, ?, ?)",
                           [.text(row.id), .text(row.kind), .integer(row.readable ? 1 : 0)])
            }
        }
    }

    func finishFullInventory(checked: Int) throws -> State {
        try transaction {
            // A safe complete scan may have retained positive fingerprints
            // from an earlier token. Purge only IDs absent from this scan.
            try execute("DELETE FROM fingerprints WHERE local_id NOT IN (SELECT local_id FROM inventory WHERE status = 1)")
            try completeInventory(expectedCount: checked)
        }
        guard let saved = try state() else { throw Failure.invalidRecord }
        return saved
    }

    func finishIncremental() throws -> State {
        try transaction {
            let expected = try statement("SELECT total FROM incremental WHERE id = 1") { stmt -> Int in
                guard sqlite3_step(stmt) == SQLITE_ROW else { throw Failure.invalidRecord }
                return Int(sqlite3_column_int64(stmt, 0))
            }
            guard expected >= 0, try count("SELECT COUNT(*) FROM inventory WHERE status = 2") == 0 else {
                throw Failure.invalidRecord
            }
            // A delta never silently changes the full-library item count
            // except through the explicit changed ID membership transaction.
            let checked = try count("SELECT COUNT(*) FROM inventory")
            try completeInventory(expectedCount: checked)
            try execute("DELETE FROM incremental")
        }
        guard let saved = try state() else { throw Failure.invalidRecord }
        return saved
    }

    private func completeInventory(expectedCount: Int) throws {
        let checked = try count("SELECT COUNT(*) FROM inventory")
        let readable = try count("SELECT COUNT(*) FROM inventory WHERE status = 1")
        let unknown = try count("SELECT COUNT(*) FROM inventory WHERE status = 2")
        let hashes = try count("SELECT COUNT(*) FROM fingerprints")
        guard checked == expectedCount, unknown == 0, hashes == readable,
              try count("SELECT COUNT(*) FROM inventory WHERE status = 1 AND local_id NOT IN (SELECT local_id FROM fingerprints)") == 0 else {
            throw Failure.invalidRecord
        }
        let missing: [String: Int] = try statement(
            "SELECT kind, COUNT(*) FROM inventory WHERE status = 0 GROUP BY kind"
        ) { stmt in
            var kinds: [String: Int] = ["image": 0, "video": 0, "live_photo": 0]
            while true {
                let code = sqlite3_step(stmt)
                if code == SQLITE_DONE { return kinds }
                guard code == SQLITE_ROW, let name = sqlite3_column_text(stmt, 0),
                      Self.validKind(String(cString: name)) else { throw Failure.invalidRecord }
                kinds[String(cString: name)] = Int(sqlite3_column_int64(stmt, 1))
            }
        }
        try update("UPDATE state SET checked = ?, unavailable = ? WHERE id = 1",
                   [.integer(checked), .integer(checked - readable)])
        try execute("DELETE FROM coverage")
        for kind in ["image", "video", "live_photo"] {
            try update("INSERT INTO coverage VALUES (?, ?)", [.text(kind), .integer(missing[kind] ?? 0)])
        }
    }

    private static func validKind(_ kind: String) -> Bool {
        kind == "image" || kind == "video" || kind == "live_photo"
    }

    private func count(_ sql: String) throws -> Int {
        try statement(sql) { stmt in
            guard sqlite3_step(stmt) == SQLITE_ROW else { throw Failure.invalidRecord }
            return Int(sqlite3_column_int64(stmt, 0))
        }
    }

    func probe(id: String) throws -> Data? {
        try statement("SELECT probe FROM fingerprints WHERE local_id = ?", [.text(id)]) { stmt in
            let code = sqlite3_step(stmt)
            if code == SQLITE_DONE { return nil }
            guard code == SQLITE_ROW else { throw Failure.database(code) }
            return try blob(stmt, column: 0, maximum: 1024)
        }
    }

    private static func validCoverage(_ kinds: [String: Int], total: Int) -> Bool {
        guard total >= 0, Set(kinds.keys) == Set(["image", "video", "live_photo"]) else { return false }
        var remaining = total
        for count in kinds.values {
            guard count >= 0, count <= remaining else { return false }
            remaining -= count
        }
        return remaining == 0
    }

    func localIDs(fingerprint: String) throws -> [String] {
        try statement("SELECT local_id FROM fingerprints WHERE fingerprint = ? LIMIT 2", [.text(fingerprint)]) { stmt in
            var ids: [String] = []
            while true {
                let code = sqlite3_step(stmt)
                if code == SQLITE_DONE { return ids }
                guard code == SQLITE_ROW, let value = sqlite3_column_text(stmt, 0) else { throw Failure.database(code) }
                ids.append(String(cString: value))
            }
        }
    }

    private func blob(_ stmt: OpaquePointer, column: Int32, maximum: Int) throws -> Data? {
        let size = Int(sqlite3_column_bytes(stmt, column))
        guard size > 0, size <= maximum, let pointer = sqlite3_column_blob(stmt, column) else {
            throw Failure.invalidRecord
        }
        return Data(bytes: pointer, count: size)
    }

    private func execute(_ sql: String) throws {
        let code = sqlite3_exec(db, sql, nil, nil, nil)
        guard code == SQLITE_OK else { throw Failure.database(code) }
    }

    private func update(_ sql: String, _ bindings: [Binding]) throws {
        try statement(sql, bindings) { stmt in
            let code = sqlite3_step(stmt)
            guard code == SQLITE_DONE else { throw Failure.database(code) }
        }
    }

    private func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do {
            try body()
            try execute("COMMIT")
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func statement<T>(_ sql: String, _ bindings: [Binding] = [],
                              _ body: (OpaquePointer) throws -> T) throws -> T {
        var prepared: OpaquePointer?
        let code = sqlite3_prepare_v2(db, sql, -1, &prepared, nil)
        guard code == SQLITE_OK, let stmt = prepared else { throw Failure.database(code) }
        defer { sqlite3_finalize(stmt) }
        for (offset, value) in bindings.enumerated() {
            let index = Int32(offset + 1)
            let status: Int32
            switch value {
            case .text(let text):
                status = text.withCString { sqlite3_bind_text(stmt, index, $0, -1, transient) }
            case .blob(let data):
                status = data.withUnsafeBytes {
                    sqlite3_bind_blob(stmt, index, $0.baseAddress, Int32($0.count), transient)
                }
            case .integer(let integer):
                status = sqlite3_bind_int64(stmt, index, Int64(integer))
            }
            guard status == SQLITE_OK else { throw Failure.database(status) }
        }
        return try body(stmt)
    }
}
