import Foundation
import SQLite3

/// A bounded-read, crash-durable change queue for the current iOS app install.
/// PhotoKit IDs are stored only in an Owner-scoped local database. No upload
/// may be acknowledged from a scan or a token advance: only the existing
/// original receipt verifier may eventually mark an item complete.
final class XDriveIOSPhotoBackupChangeQueueStore {
    enum Failure: Error, Equatable {
        case invalidInput
        case database(Int32)
        case missingBaseline
        case baselineChanged
    }

    struct Baseline: Equatable {
        let token: Data
        let authorization: Int
    }

    struct Pending: Equatable {
        let localIdentifier: String
        let revision: Int64
        let priority: Int
    }

    struct Applied: Equatable {
        let inserted: Int
        let updated: Int
        let deleted: Int
    }

    /// Only the existing live Owner Node receipt verifier can authorize a
    /// confirmed transition. A queue row or a PhotoKit token proves nothing.
    enum Settled: String {
        case confirmed
        case failed
    }

    /// Read-only per-item queue state; not the full-library cloud completion.
    enum ItemState: String {
        case pending
        case confirmed
        case failed
        case missingLocal
    }
    struct ItemStatus: Equatable {
        let revision: Int64
        let state: ItemState
    }

    /// Counts only locally captured PhotoKit *changes*, not all visible media
    /// and never verified remote coverage. No asset IDs leave this database.
    struct Counts: Equatable {
        var pending = 0
        var failed = 0
        var confirmed = 0
        var missingLocal = 0
    }

    private var database: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(fileURL: URL) throws {
        guard fileURL.isFileURL, !fileURL.path.isEmpty else { throw Failure.invalidInput }
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let code = sqlite3_open_v2(fileURL.path, &database,
                                   SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
        guard code == SQLITE_OK else {
            if let database { sqlite3_close_v2(database) }
            database = nil
            throw Failure.database(code)
        }
        do {
            try execute("PRAGMA busy_timeout=2000")
            // DELETE journaling creates no persistent WAL with a weaker file
            // protection class; FULL synchronization makes checkpoints durable.
            try execute("PRAGMA journal_mode=DELETE")
            try execute("PRAGMA synchronous=FULL")
            try execute("CREATE TABLE IF NOT EXISTS baseline (id INTEGER PRIMARY KEY CHECK(id=1), token BLOB NOT NULL, authorization INTEGER NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS reconciliation (id INTEGER PRIMARY KEY CHECK(id=1), token BLOB NOT NULL, authorization INTEGER NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS sequence (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL)")
            try execute("INSERT OR IGNORE INTO sequence (id,value) VALUES (1,0)")
            try execute("CREATE TABLE IF NOT EXISTS entries (asset_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), priority INTEGER NOT NULL, queue_order INTEGER NOT NULL, state TEXT NOT NULL)")
            try execute("CREATE INDEX IF NOT EXISTS entries_pending_order ON entries (state, priority DESC, queue_order DESC)")
            // Ignore a newly created database until iOS protection permits
            // reading its baseline and backing PhotoKit bytes again.
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete],
                                                   ofItemAtPath: fileURL.path)
        } catch {
            sqlite3_close_v2(database)
            database = nil
            throw error
        }
    }

    deinit { if let database { sqlite3_close_v2(database) } }

    /// Install only on explicit opt-in, before the matching automatic plan
    /// becomes executable. An existing token can NEVER be silently replaced.
    @discardableResult
    func installBaselineIfAbsent(token: Data, authorization: Int) throws -> Bool {
        try validateToken(token)
        guard authorization > 0 else { throw Failure.invalidInput }
        let statement = try prepare("INSERT OR IGNORE INTO baseline(id,token,authorization) VALUES(1,?,?)")
        defer { sqlite3_finalize(statement) }
        try bind(token, into: statement, position: 1)
        guard sqlite3_bind_int64(statement, 2, Int64(authorization)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
        return sqlite3_changes(database) == 1
    }

    /// Replace an unreplayable PhotoKit history checkpoint only after the
    /// Owner-scoped caller has completed a full current-library scan and
    /// verified every supported original against the current Server receipt.
    /// The new token and clearing of stale change rows are one SQLite commit.
    /// This operation itself proves NOTHING about uploads.
    func completeFullReconciliation(token: Data, authorization: Int) throws {
        try validateToken(token)
        guard authorization > 0 else { throw Failure.invalidInput }
        try execute("BEGIN IMMEDIATE")
        var committed = false
        defer { if !committed { try? execute("ROLLBACK") } }
        let statement = try prepare(
            "INSERT INTO baseline(id,token,authorization) VALUES(1,?,?) " +
            "ON CONFLICT(id) DO UPDATE SET token=excluded.token,authorization=excluded.authorization"
        )
        defer { sqlite3_finalize(statement) }
        try bind(token, into: statement, position: 1)
        guard sqlite3_bind_int64(statement, 2, Int64(authorization)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
        try execute("DELETE FROM entries")
        let marker = try prepare(
            "INSERT INTO reconciliation(id,token,authorization) VALUES(1,?,?) " +
            "ON CONFLICT(id) DO UPDATE SET token=excluded.token,authorization=excluded.authorization"
        )
        defer { sqlite3_finalize(marker) }
        try bind(token, into: marker, position: 1)
        guard sqlite3_bind_int64(marker, 2, Int64(authorization)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(marker)
        try execute("COMMIT")
        committed = true
    }

    /// A durable marker distinguishes a completed full pass from an ordinary
    /// incremental replay that happens to advance the same baseline later.
    func hasCompletedFullReconciliation(token: Data, authorization: Int) throws -> Bool {
        try validateToken(token)
        guard authorization > 0 else { throw Failure.invalidInput }
        let statement = try prepare(
            "SELECT token,authorization FROM reconciliation WHERE id=1"
        )
        defer { sqlite3_finalize(statement) }
        let code = sqlite3_step(statement)
        if code == SQLITE_DONE { return false }
        guard code == SQLITE_ROW else { throw Failure.database(code) }
        let size = sqlite3_column_bytes(statement, 0)
        guard size > 0 && size <= 65_536,
              let raw = sqlite3_column_blob(statement, 0) else {
            throw Failure.invalidInput
        }
        let savedToken = Data(bytes: raw, count: Int(size))
        let savedAuthorization = Int(sqlite3_column_int64(statement, 1))
        return savedAuthorization == authorization && savedToken == token
    }

    func baseline() throws -> Baseline? {
        let statement = try prepare("SELECT token,authorization FROM baseline WHERE id=1")
        defer { sqlite3_finalize(statement) }
        let code = sqlite3_step(statement)
        if code == SQLITE_DONE { return nil }
        guard code == SQLITE_ROW else { throw Failure.database(code) }
        let size = sqlite3_column_bytes(statement, 0)
        guard size > 0 && size <= 65_536,
              let raw = sqlite3_column_blob(statement, 0) else { throw Failure.invalidInput }
        return Baseline(token: Data(bytes: raw, count: Int(size)),
                        authorization: Int(sqlite3_column_int64(statement, 1)))
    }

    /// One PhotoKit change record AND its next token commit atomically. A
    /// crash anywhere rolls back both so replay cannot skip the changed IDs.
    /// Callers must verify exact Owner, PhotoKit authorization and source
    /// generation before every invocation; this store performs no uploads.
    func apply(inserted: Set<String>, updated: Set<String>, deleted: Set<String>,
               expectedToken: Data, nextToken: Data, authorization: Int) throws -> Applied {
        try validateToken(expectedToken)
        try validateToken(nextToken)
        try execute("BEGIN IMMEDIATE")
        var committed = false
        defer { if !committed { try? execute("ROLLBACK") } }
        guard let previous = try baseline() else { throw Failure.missingBaseline }
        guard previous.authorization == authorization,
              previous.token == expectedToken else { throw Failure.baselineChanged }
        var added = 0, changed = 0, missing = 0
        for id in inserted {
            try upsert(id: id, priority: 2)
            added += 1
        }
        for id in updated where !inserted.contains(id) {
            try upsert(id: id, priority: 1)
            changed += 1
        }
        for id in deleted where !inserted.contains(id) && !updated.contains(id) {
            try markMissing(id: id)
            missing += 1
        }
        let statement = try prepare("UPDATE baseline SET token=? WHERE id=1 AND authorization=?")
        defer { sqlite3_finalize(statement) }
        try bind(nextToken, into: statement, position: 1)
        guard sqlite3_bind_int64(statement, 2, Int64(authorization)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
        guard sqlite3_changes(database) == 1 else { throw Failure.baselineChanged }
        try execute("COMMIT")
        committed = true
        return Applied(inserted: added, updated: changed, deleted: missing)
    }

    /// Aggregate locally captured change states in SQLite rather than
    /// materializing an unbounded list of private PhotoKit identifiers.
    /// An absent baseline must be checked by the Owner-scoped caller.
    func counts() throws -> Counts {
        let statement = try prepare("SELECT state,COUNT(*) FROM entries GROUP BY state")
        defer { sqlite3_finalize(statement) }
        var totals = Counts()
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_DONE { return totals }
            guard code == SQLITE_ROW,
                  let raw = sqlite3_column_text(statement, 0),
                  let state = ItemState(rawValue: String(cString: raw)) else {
                throw Failure.database(code == SQLITE_ROW ? SQLITE_MISMATCH : code)
            }
            let count = Int(sqlite3_column_int64(statement, 1))
            guard count >= 0 else { throw Failure.invalidInput }
            switch state {
            case .pending: totals.pending = count
            case .failed: totals.failed = count
            case .confirmed: totals.confirmed = count
            case .missingLocal: totals.missingLocal = count
            }
        }
    }

    /// Read at most 64 pending records; never create a 100k-asset Swift array.
    /// New additions outrank edited items. Later change events outrank older.
    func pending(limit: Int = 64) throws -> [Pending] {
        guard (1...64).contains(limit) else { throw Failure.invalidInput }
        let statement = try prepare("SELECT asset_id,revision,priority FROM entries WHERE state='pending' ORDER BY priority DESC,queue_order DESC LIMIT ?")
        defer { sqlite3_finalize(statement) }
        guard sqlite3_bind_int(statement, 1, Int32(limit)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        var results: [Pending] = []
        results.reserveCapacity(limit)
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_DONE { return results }
            guard code == SQLITE_ROW, let raw = sqlite3_column_text(statement, 0) else {
                throw Failure.database(code)
            }
            results.append(Pending(localIdentifier: String(cString: raw),
                                   revision: sqlite3_column_int64(statement, 1),
                                   priority: Int(sqlite3_column_int(statement, 2))))
        }
    }

    /// Compare-and-set after the shared original writer returns a verified
    /// Node receipt, or a proven item-local failure. A concurrent PhotoKit edit
    /// increments the row revision, so an old callback cannot clear new work.
    @discardableResult
    func settle(_ candidate: Pending, result: Settled) throws -> Bool {
        try validateIdentifier(candidate.localIdentifier)
        guard candidate.revision > 0 else { throw Failure.invalidInput }
        let statement = try prepare(
            "UPDATE entries SET state=? WHERE asset_id=? AND revision=? AND state='pending'"
        )
        defer { sqlite3_finalize(statement) }
        try bind(result.rawValue, into: statement, position: 1)
        try bind(candidate.localIdentifier, into: statement, position: 2)
        guard sqlite3_bind_int64(statement, 3, candidate.revision) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
        return sqlite3_changes(database) == 1
    }

    /// Settle only if the PhotoKit change baseline is still the exact
    /// checkpoint whose candidate revision was consumed. This prevents a
    /// delayed uploader callback from confirming an asset while newer
    /// persistent changes are waiting to be replayed.
    @discardableResult
    func settle(_ candidate: Pending, result: Settled,
                expectedBaselineToken: Data,
                authorization: Int) throws -> Bool {
        try validateIdentifier(candidate.localIdentifier)
        try validateToken(expectedBaselineToken)
        guard candidate.revision > 0, authorization > 0 else {
            throw Failure.invalidInput
        }
        try execute("BEGIN IMMEDIATE")
        var committed = false
        defer { if !committed { try? execute("ROLLBACK") } }
        guard let current = try baseline(),
              current.authorization == authorization,
              current.token == expectedBaselineToken else {
            throw Failure.baselineChanged
        }
        let statement = try prepare(
            "UPDATE entries SET state=? WHERE asset_id=? AND revision=? AND state='pending'"
        )
        defer { sqlite3_finalize(statement) }
        try bind(result.rawValue, into: statement, position: 1)
        try bind(candidate.localIdentifier, into: statement, position: 2)
        guard sqlite3_bind_int64(statement, 3, candidate.revision) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
        let changed = sqlite3_changes(database) == 1
        try execute("COMMIT")
        committed = true
        return changed
    }

    /// Bounded failed-item listing. These rows are only item-local failures
    /// proven safe to retry by the original writer; unknown ACKs never enter
    /// this state and remain in the separate receipt-review ledger.
    func failed(limit: Int = 64) throws -> [Pending] {
        guard (1...64).contains(limit) else { throw Failure.invalidInput }
        let statement = try prepare(
            "SELECT asset_id,revision,priority FROM entries WHERE state='failed' ORDER BY priority DESC,queue_order DESC LIMIT ?"
        )
        defer { sqlite3_finalize(statement) }
        guard sqlite3_bind_int(statement, 1, Int32(limit)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        var results: [Pending] = []
        results.reserveCapacity(limit)
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_DONE { return results }
            guard code == SQLITE_ROW, let raw = sqlite3_column_text(statement, 0) else {
                throw Failure.database(code)
            }
            results.append(Pending(
                localIdentifier: String(cString: raw),
                revision: sqlite3_column_int64(statement, 1),
                priority: Int(sqlite3_column_int(statement, 2))
            ))
        }
    }

    /// Explicit user retry only after a fresh PhotoKit baseline check. The
    /// SQLite transaction prevents a stale UI action from requeueing a row
    /// after a newer PhotoKit change has been observed.
    @discardableResult
    func retryFailed(_ candidate: Pending,
                     expectedBaselineToken: Data,
                     authorization: Int) throws -> Bool {
        try validateIdentifier(candidate.localIdentifier)
        try validateToken(expectedBaselineToken)
        guard candidate.revision > 0, authorization > 0 else {
            throw Failure.invalidInput
        }
        try execute("BEGIN IMMEDIATE")
        var committed = false
        defer { if !committed { try? execute("ROLLBACK") } }
        guard let current = try baseline(),
              current.authorization == authorization,
              current.token == expectedBaselineToken else {
            throw Failure.baselineChanged
        }
        let statement = try prepare(
            "UPDATE entries SET state='pending' WHERE asset_id=? AND revision=? AND state='failed'"
        )
        defer { sqlite3_finalize(statement) }
        try bind(candidate.localIdentifier, into: statement, position: 1)
        guard sqlite3_bind_int64(statement, 2, candidate.revision) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
        let changed = sqlite3_changes(database) == 1
        try execute("COMMIT")
        committed = true
        return changed
    }

    /// One indexed state read for a visible PhotoKit item, not a 100k ID map.
    func status(for localIdentifier: String) throws -> ItemStatus? {
        try validateIdentifier(localIdentifier)
        let statement = try prepare("SELECT revision,state FROM entries WHERE asset_id=?")
        defer { sqlite3_finalize(statement) }
        try bind(localIdentifier, into: statement, position: 1)
        let code = sqlite3_step(statement)
        if code == SQLITE_DONE { return nil }
        guard code == SQLITE_ROW,
              let raw = sqlite3_column_text(statement, 1),
              let state = ItemState(rawValue: String(cString: raw)) else {
            throw Failure.database(code == SQLITE_ROW ? SQLITE_MISMATCH : code)
        }
        return ItemStatus(revision: sqlite3_column_int64(statement, 0), state: state)
    }

    private func validateToken(_ bytes: Data) throws {
        guard !bytes.isEmpty, bytes.count <= 65_536 else { throw Failure.invalidInput }
    }

    private func validateIdentifier(_ id: String) throws {
        guard !id.isEmpty, id.utf8.count <= 1024, !id.contains("\u{0}") else {
            throw Failure.invalidInput
        }
    }

    private func upsert(id: String, priority: Int) throws {
        try validateIdentifier(id)
        try execute("UPDATE sequence SET value=value+1 WHERE id=1")
        let sql = "INSERT INTO entries(asset_id,revision,priority,queue_order,state) VALUES(?,1,?,(SELECT value FROM sequence WHERE id=1),'pending') ON CONFLICT(asset_id) DO UPDATE SET revision=entries.revision+1,priority=MAX(entries.priority,excluded.priority),queue_order=excluded.queue_order,state='pending'"
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        try bind(id, into: statement, position: 1)
        guard sqlite3_bind_int(statement, 2, Int32(priority)) == SQLITE_OK else {
            throw Failure.database(sqlite3_errcode(database))
        }
        try stepDone(statement)
    }

    private func markMissing(id: String) throws {
        try validateIdentifier(id)
        // Keep the record and receipt history. Deleting a local original must
        // NEVER send a delete to the Server or count it as uploaded.
        let statement = try prepare("UPDATE entries SET state='missingLocal' WHERE asset_id=?")
        defer { sqlite3_finalize(statement) }
        try bind(id, into: statement, position: 1)
        try stepDone(statement)
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        let code = sqlite3_prepare_v2(database, sql, -1, &statement, nil)
        guard code == SQLITE_OK, let statement else { throw Failure.database(code) }
        return statement
    }

    private func execute(_ sql: String) throws {
        let code = sqlite3_exec(database, sql, nil, nil, nil)
        guard code == SQLITE_OK else { throw Failure.database(code) }
    }

    private func bind(_ data: Data, into statement: OpaquePointer, position: Int32) throws {
        let code = data.withUnsafeBytes {
            sqlite3_bind_blob(statement, position, $0.baseAddress,
                              Int32($0.count), transient)
        }
        guard code == SQLITE_OK else { throw Failure.database(code) }
    }

    private func bind(_ value: String, into statement: OpaquePointer, position: Int32) throws {
        let code = sqlite3_bind_text(statement, position, value, -1, transient)
        guard code == SQLITE_OK else { throw Failure.database(code) }
    }

    private func stepDone(_ statement: OpaquePointer) throws {
        let code = sqlite3_step(statement)
        guard code == SQLITE_DONE else { throw Failure.database(code) }
    }
}
