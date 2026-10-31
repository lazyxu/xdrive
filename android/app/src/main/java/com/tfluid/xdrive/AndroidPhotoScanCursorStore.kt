package com.tfluid.xdrive

import android.content.Context
import com.tfluid.xdrive.core.ServerAddress
import java.security.MessageDigest
import org.json.JSONObject

/**
 * A single small, durable performance hint for the *next* user-approved
 * MediaStore batch. The encrypted intent ledger and Go's verified receipts
 * remain the ONLY upload/replay authority.
 *
 * Stores no bearer, device credential, photo bytes, filename, URI, GPS or
 * album; the scope is a SHA-256 digest and the cursor is a numeric MediaStore
 * row ID. This checkpoint does not need an additional encryption format.
 */
internal class AndroidPhotoScanCursorStore(
    context: Context,
    preferenceName: String = "xdrive-photo-scan-cursor-v1",
) {
    private val prefs = context.applicationContext.getSharedPreferences(
        preferenceName, Context.MODE_PRIVATE)

    @Synchronized
    fun readFor(owner: NativePhotoBackupOwner): Long {
        val saved = readStored() ?: return 0L
        return if (saved.scopeHash == hashOwner(owner)) saved.afterId else 0L
    }

    /**
     * Caller may commit only after a real Go VERIFIED receipt or an exact
     * verified-only SQLite skip. UNKNOWN_ACK never enters this method.
     */
    @Synchronized
    fun advanceVerified(
        owner: NativePhotoBackupOwner,
        expectedAfterId: Long,
        confirmedAfterId: Long,
    ) {
        require(expectedAfterId >= 0 && confirmedAfterId > expectedAfterId)
        val scope = hashOwner(owner)
        val previous = readStored()
        if (previous == null || previous.scopeHash != scope) {
            check(expectedAfterId == 0L) { "Photo scan Owner changed" }
        } else {
            check(previous.afterId == expectedAfterId) {
                "Photo scan cursor changed; reload before continuing"
            }
        }
        save(Checkpoint(scope, confirmedAfterId))
    }

    /**
     * Reset at the end of a verified keyset sweep, so newly added or edited
     * originals may be detected on the next separately approved scan.
     * A complete sweep is NOT proof that every asset has an upload receipt.
     */
    @Synchronized
    fun finishSweep(owner: NativePhotoBackupOwner, expectedAfterId: Long) {
        require(expectedAfterId >= 0)
        val saved = readStored()
        val scope = hashOwner(owner)
        if (saved == null || saved.scopeHash != scope) {
            check(expectedAfterId == 0L) { "Owner scan checkpoint not current" }
        } else check(saved.afterId == expectedAfterId) {
            "Photo scan checkpoint changed before sweep finish"
        }
        save(Checkpoint(scope, 0L))
    }

    /** Only after a verified current Owner requests a complete rescan. */
    @Synchronized
    fun resetFor(owner: NativePhotoBackupOwner) {
        save(Checkpoint(hashOwner(owner), 0L))
    }

    private fun save(value: Checkpoint) {
        val body = JSONObject()
            .put("version", 1)
            .put("scope_hash", value.scopeHash)
            .put("after_id", value.afterId)
            .toString()
        check(prefs.edit().putString(KEY, body).commit()) {
            "Photo scan cursor could not be committed"
        }
    }

    private fun readStored(): Checkpoint? {
        val raw = try { prefs.getString(KEY, null) }
            catch (e: Exception) { throw IllegalStateException("Unreadable photo scan cursor", e) }
            ?: return null
        return try {
            require(raw.length in 1..512)
            val doc = JSONObject(raw)
            require(doc.length() == 3 && doc.getInt("version") == 1)
            val scope = doc.getString("scope_hash")
            val after = doc.getLong("after_id")
            require(nativeBackupHex(scope) && after >= 0)
            Checkpoint(scope, after)
        } catch (e: Exception) {
            // Never hide data loss as a new scan while unknown ACK may exist.
            throw IllegalStateException("Photo scan checkpoint corrupt", e)
        }
    }

    private fun hashOwner(owner: NativePhotoBackupOwner): String {
        require(ServerAddress.parse(owner.serverOrigin).url == owner.serverOrigin)
        // Root revision intentionally excluded: uploads change it.
        val body = listOf(owner.serverOrigin, owner.instanceId,
            owner.ownerId.toString(), owner.username,
            owner.rootNodeId.toString(), owner.deviceId).joinToString("\u0000")
        return MessageDigest.getInstance("SHA-256")
            .digest(body.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private data class Checkpoint(val scopeHash: String, val afterId: Long)

    private companion object { const val KEY = "scan-v1" }
}
