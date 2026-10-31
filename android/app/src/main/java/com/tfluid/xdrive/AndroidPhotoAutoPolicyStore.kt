package com.tfluid.xdrive

import android.content.Context
import com.tfluid.xdrive.core.ServerAddress
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

/**
 * Explicit Owner-and-device-scoped WorkManager opt-in, NOT a backup task log.
 * Only a random consent epoch, hashed identity and run state are retained.
 * Go finalize receipts and the separate NativePhotoBackupLedger remain the
 * sole authority for marking originals uploaded or retryable.
 */
internal class AndroidPhotoAutoPolicyStore(
    context: Context,
    preferenceName: String = "xdrive-photo-auto-policy-v1",
) {
    private val prefs = context.applicationContext.getSharedPreferences(
        preferenceName, Context.MODE_PRIVATE)

    internal data class Consent(
        val scopeHash: String,
        val epoch: String,
        val status: String,
        val enabled: Boolean,
    ) {
        init {
            require(nativeBackupHex(scopeHash) &&
                UUID.fromString(epoch).toString() == epoch)
            require(status in ALLOWED_STATUSES)
        }
    }

    fun snapshot(): Consent? = synchronized(guard) { readUnsafe() }

    fun enable(owner: NativePhotoBackupOwner): Consent = synchronized(guard) {
        val next = Consent(scopeHash(owner), UUID.randomUUID().toString(),
            STATUS_WAITING, enabled = true)
        writeUnsafe(next)
        next
    }

    fun matches(owner: NativePhotoBackupOwner, epoch: String): Boolean =
        synchronized(guard) {
            readUnsafe()?.let {
                it.enabled && it.epoch == epoch &&
                    it.scopeHash == scopeHash(owner) &&
                    it.status != STATUS_NEEDS_REVIEW
            } == true
        }

    fun updateIfCurrent(
        owner: NativePhotoBackupOwner, epoch: String, status: String,
    ): Boolean = synchronized(guard) {
        require(status in ALLOWED_STATUSES)
        val old = readUnsafe() ?: return@synchronized false
        if (!old.enabled || old.scopeHash != scopeHash(owner) ||
            old.epoch != epoch) return@synchronized false
        writeUnsafe(old.copy(status = status))
        true
    }

    /** Pre-proof status is permissible only for the SAME stored consent
     * epoch/hash, never based solely on an unverified local username. */
    fun updateBySnapshot(captured: Consent, status: String): Boolean =
        synchronized(guard) {
            require(status in ALLOWED_STATUSES)
            val old = readUnsafe() ?: return@synchronized false
            if (!old.enabled || old.epoch != captured.epoch ||
                old.scopeHash != captured.scopeHash)
                return@synchronized false
            writeUnsafe(old.copy(status = status))
            true
        }

    fun disable(): Unit = synchronized(guard) {
        check(prefs.edit().remove(KEY).commit()) {
            "Photo automatic backup opt-out did not commit"
        }
    }

    private fun writeUnsafe(value: Consent) {
        val raw = JSONObject()
            .put("version", 1).put("scope", value.scopeHash)
            .put("epoch", value.epoch).put("status", value.status)
            .put("enabled", value.enabled).toString()
        check(prefs.edit().putString(KEY, raw).commit()) {
            "Photo automatic backup consent was not saved"
        }
    }

    private fun readUnsafe(): Consent? {
        val raw = prefs.getString(KEY, null) ?: return null
        return try {
            require(raw.length in 1..512)
            val json = JSONObject(raw)
            require(json.length() == 5 && json.getInt("version") == 1)
            Consent(json.getString("scope"), json.getString("epoch"),
                json.getString("status"), json.getBoolean("enabled"))
        } catch (error: Exception) {
            // Never use a malformed opt-in to allow any background writes.
            throw IllegalStateException("Photo backup consent unreadable", error)
        }
    }

    internal companion object {
        const val STATUS_WAITING = "waiting"
        const val STATUS_RUNNING = "running"
        const val STATUS_SCANNED = "scanned_not_complete"
        const val STATUS_NEEDS_REVIEW = "needs_receipt_review"
        const val STATUS_REQUIRES_SESSION = "requires_session"
        const val STATUS_REQUIRES_PERMISSION = "requires_full_media_grant"
        val ALLOWED_STATUSES = setOf(STATUS_WAITING, STATUS_RUNNING,
            STATUS_SCANNED, STATUS_NEEDS_REVIEW,
            STATUS_REQUIRES_SESSION, STATUS_REQUIRES_PERMISSION)
        private const val KEY = "consent-v1"
        private val guard = Any()
    }

    private fun scopeHash(owner: NativePhotoBackupOwner): String {
        require(ServerAddress.parse(owner.serverOrigin).url == owner.serverOrigin)
        // Root revision changes on normal uploads; Owner/device cannot.
        val body = listOf(owner.serverOrigin, owner.instanceId,
            owner.ownerId.toString(), owner.username,
            owner.rootNodeId.toString(), owner.deviceId)
            .joinToString("\u0000")
        return MessageDigest.getInstance("SHA-256")
            .digest(body.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}
