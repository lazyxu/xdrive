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
