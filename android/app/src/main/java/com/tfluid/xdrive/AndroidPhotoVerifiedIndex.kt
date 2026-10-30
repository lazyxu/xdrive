package com.tfluid.xdrive

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.tfluid.xdrive.core.ServerAddress
import java.security.MessageDigest

/**
 * Large verified-only photo/video index. The existing small encrypted intent
 * ledger remains the authority for all in-flight / UNKNOWN_ACK attempts.
 *
 * A row can enter here ONLY after the caller has used
 * NativePhotoBackupLedger.acknowledgeVerified with an exact real Go receipt.
 * Missing row NEVER means safe retry: consult the intent ledger first.
 *
 * SQLite provides atomic commits and indexed lookups at 100k+ scale. No raw
 * MediaStore ID, content URI, filename, location, album, token or media bytes
 * are stored; asset and version keys are prehashed by the source adapter.
 */
internal class AndroidPhotoVerifiedIndex(
    context: Context,
    databaseName: String = "xdrive-native-photo-verified-v1.db",
    private val maxRows: Int = MAX_ENTRIES,
) : SQLiteOpenHelper(context.applicationContext, databaseName, null, 1) {
    init {
        require(databaseName.length in 1..128 &&
            databaseName.matches(Regex("[A-Za-z0-9_.-]+")))
        require(maxRows in 1..MAX_ENTRIES)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE verified (" +
                "scope_hash TEXT NOT NULL, asset_key TEXT NOT NULL, " +
                "resource TEXT NOT NULL, version_key TEXT NOT NULL, " +
                "sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, " +
                "node_id INTEGER NOT NULL, node_revision INTEGER NOT NULL, " +
                "PRIMARY KEY (scope_hash, asset_key, resource))"
        )
        db.execSQL(
            "CREATE TABLE quota (id INTEGER PRIMARY KEY CHECK (id = 1), " +
                "row_count INTEGER NOT NULL CHECK (row_count >= 0))"
        )
        db.execSQL("INSERT INTO quota (id, row_count) VALUES (1, 0)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw IllegalStateException("Unsupported photo verified index schema")
    }

    override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw IllegalStateException("Photo verified index downgrade refused")
    }

    /**
     * Ledger-verified receipt is the only admissible input. An uncertain or
     * merely planned upload is never included in the completed index.
     */
    @Synchronized
    fun recordVerified(intent: NativePhotoBackupIntent) {
        require(intent.phase == NativePhotoBackupPhase.VERIFIED &&
            intent.verifiedNodeId != null && intent.verifiedNodeRevision != null)
        val db = writableDatabase
        val ownerKey = scopeHash(intent.owner)
        val keys = arrayOf(ownerKey, intent.assetKey, intent.resource.name)
        db.beginTransaction()
        try {
            val previous = findRow(db, keys)
            if (previous == null) {
                val count = globalCount(db)
                check(count < maxRows) {
                    "Photo verified index capacity reached; refusing silent drop"
                }
                db.execSQL("UPDATE quota SET row_count = row_count + 1 WHERE id = 1")
            } else if (previous == rowFrom(intent)) {
                db.setTransactionSuccessful()
                return
            }
            val values = ContentValues().apply {
                put("scope_hash", ownerKey)
                put("asset_key", intent.assetKey)
                put("resource", intent.resource.name)
                put("version_key", intent.versionKey)
                put("sha256", intent.originalSha256)
                put("bytes", intent.sizeBytes)
                put("node_id", requireNotNull(intent.verifiedNodeId))
                put("node_revision", requireNotNull(intent.verifiedNodeRevision))
            }
            check(db.insertWithOnConflict(
                "verified", null, values, SQLiteDatabase.CONFLICT_REPLACE
            ) != -1L) { "Photo verified receipt was not persisted" }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /**
     * Exact Owner/device/asset/resource VERSION lookup. A different original
     * is not marked backed up; pending state is checked by the separate intent
     * ledger before any write attempt.
     */
    @Synchronized
    fun findVerified(
        owner: NativePhotoBackupOwner,
        assetKey: String,
        versionKey: String,
        resource: NativePhotoBackupResource,
        sha256: String,
        sizeBytes: Long,
    ): NativePhotoIndexedReceipt? {
        require(nativeBackupHex(assetKey) && nativeBackupHex(versionKey) &&
            nativeBackupHex(sha256) && sizeBytes > 0)
        val row = findRow(readableDatabase,
            arrayOf(scopeHash(owner), assetKey, resource.name)) ?: return null
        return if (row.versionKey == versionKey && row.sha256 == sha256 &&
            row.bytes == sizeBytes)
            NativePhotoIndexedReceipt(row.nodeId, row.nodeRevision)
        else null
    }

    @Synchronized
    fun totalIndexed(): Long = globalCount(readableDatabase)

    private fun globalCount(db: SQLiteDatabase): Long =
        db.rawQuery("SELECT row_count FROM quota WHERE id = 1", null).use { c ->
            check(c.moveToFirst())
            val result = c.getLong(0)
            check(result >= 0 && !c.moveToNext())
            result
        }

    private fun findRow(db: SQLiteDatabase, key: Array<String>): IndexedRow? =
        db.rawQuery(
            "SELECT version_key, sha256, bytes, node_id, node_revision " +
                "FROM verified WHERE scope_hash = ? AND asset_key = ? AND resource = ?",
            key,
        ).use { c ->
            if (!c.moveToFirst()) return@use null
            val value = IndexedRow(
                c.getString(0), c.getString(1),
                c.getLong(2), c.getLong(3), c.getLong(4),
            )
            check(nativeBackupHex(value.versionKey) &&
                nativeBackupHex(value.sha256) && value.bytes > 0 &&
                value.nodeId > 0 && value.nodeRevision > 0 && !c.moveToNext()) {
                "Corrupt photo verified index row"
            }
            value
        }

    private fun rowFrom(intent: NativePhotoBackupIntent) = IndexedRow(
        intent.versionKey, intent.originalSha256, intent.sizeBytes,
        requireNotNull(intent.verifiedNodeId),
        requireNotNull(intent.verifiedNodeRevision),
    )

    private data class IndexedRow(
        val versionKey: String,
        val sha256: String,
        val bytes: Long,
        val nodeId: Long,
        val nodeRevision: Long,
    )

    private fun scopeHash(owner: NativePhotoBackupOwner): String {
        // No root revision: directory revisions may change whenever new
        // children are created. Owner, instance, root ID and Device are stable.
        require(ServerAddress.parse(owner.serverOrigin).url == owner.serverOrigin)
        val scope = listOf(
            owner.serverOrigin, owner.instanceId, owner.ownerId.toString(),
            owner.username, owner.rootNodeId.toString(), owner.deviceId,
        ).joinToString("\u0000")
        return MessageDigest.getInstance("SHA-256")
            .digest(scope.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private companion object {
        const val MAX_ENTRIES = 250_000
    }
}

/** Owner-verified Node receipt; never a local filename or uploaded-byte count. */
internal data class NativePhotoIndexedReceipt(
    val nodeId: Long,
    val nodeRevision: Long,
) {
    init { require(nodeId > 0 && nodeRevision > 0) }
}
