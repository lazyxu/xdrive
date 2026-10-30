package com.tfluid.xdrive

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.tfluid.xdrive.core.NativeAndroidDeviceEnrollment
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.NativePhotoOwnerPreflight
import com.tfluid.xdrive.core.XDriveService
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * The one-time Go /devices Android identity credential is needed across app
 * restarts for future Owner-authorized backup. It is NOT an Agent credential
 * and it never authorizes an upload without a fresh Owner bearer/preflight.
 *
 * A single explicitly enrolled Owner/device is kept in private, sealed local
 * storage. Switching Owner simply hides the record; replacing any enrollment
 * requires a separate explicit revoke/reset, not an automatic network retry.
 * No photo URI, media ID, local filename, bearer or task history is stored.
 */
internal class AndroidPhotoDeviceCredentialStore(
    context: Context,
    private val preferenceName: String = "xdrive-photo-device-credential-v1",
    private val keyAlias: String = "xdrive-photo-device-credential-v1",
) {
    private val prefs = context.applicationContext.getSharedPreferences(
        preferenceName, Context.MODE_PRIVATE,
    )

    @Synchronized
    fun readFor(verifiedOwner: NativePhotoBackupScope): NativeAndroidDeviceEnrollment? =
        readStored()?.takeIf { sameOwner(it.owner, verifiedOwner) }?.device

    /**
     * Read-only resumption after a restart. The on-disk token is NOT proof:
     * verify live /me + /nodes/root, scope it to one Owner and then GET
     * /devices/self with the same bearer and exact private device credential.
     * No POST/re-registration, upload, heartbeat or scope escalation occurs.
     */
    suspend fun verifyExisting(
        service: XDriveService,
        origin: String,
        accessToken: String,
        expectedUsername: String,
        currentSession: () -> Boolean,
    ): Pair<NativePhotoBackupScope, NativeAndroidDeviceEnrollment>? {
        val owner = NativePhotoOwnerPreflight.verify(
            service, origin, accessToken, expectedUsername, currentSession)
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Android device Owner session changed" }
        val device = readFor(owner) ?: return null
        service.verifyNativeAndroidDevice(accessToken, device)
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Android device Owner changed after self verification" }
        return owner to device
    }

    /** Caller must have just verified /me and /nodes/root for this session. */
    @Synchronized
    fun saveVerified(
        verifiedOwner: NativePhotoBackupScope,
        registered: NativeAndroidDeviceEnrollment,
    ) {
        val prior = readStored()
        if (prior != null) {
            check(sameOwner(prior.owner, verifiedOwner) && prior.device == registered) {
                "Device identity already enrolled; explicit reset/revoke is required"
            }
            // Idempotent only for an identical verified Owner and token.
            return
        }
        val clear = JSONObject()
            .put("version", 1)
            .put("origin", verifiedOwner.origin)
            .put("instance", verifiedOwner.serverInstanceId)
            .put("owner_id", verifiedOwner.ownerId)
            .put("username", verifiedOwner.username)
            .put("root_id", verifiedOwner.rootId)
            .put("root_revision", verifiedOwner.rootRevision)
            .put("device_id", registered.deviceId)
            .put("device_token", registered.deviceToken)
            .put("device_name", registered.displayName)
            .put("client_version", registered.clientVersion)
            .toString().toByteArray(Charsets.UTF_8)
        try {
            require(clear.size in 1..MAX_CLEAR_BYTES)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(AAD)
            val sealed = cipher.iv + cipher.doFinal(clear)
            check(sealed.size <= MAX_SEALED_BYTES)
            check(prefs.edit().putString(PREF_KEY,
                Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()) {
                "Device registration could not be durably saved"
            }
        } finally {
            clear.fill(0)
        }
    }

    /** Only an explicit user reset after backing out of all active work. */
    @Synchronized
    fun clearByUser() {
        check(prefs.edit().remove(PREF_KEY).commit()) {
            "Device identity reset could not be committed"
        }
    }

    private fun readStored(): Stored? {
        val encoded = try { prefs.getString(PREF_KEY, null) }
            catch (failure: Exception) {
                throw IllegalStateException("Device credential storage unreadable", failure)
            } ?: return null
        var clear: ByteArray? = null
        return try {
            require(encoded.length in 40..MAX_ENCODED_BYTES)
            val sealed = Base64.decode(encoded, Base64.NO_WRAP)
            require(sealed.size in (NONCE_BYTES + 17)..MAX_SEALED_BYTES)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(),
                GCMParameterSpec(128, sealed.copyOfRange(0, NONCE_BYTES)))
            cipher.updateAAD(AAD)
            clear = cipher.doFinal(sealed.copyOfRange(NONCE_BYTES, sealed.size))
            require(clear!!.size in 1..MAX_CLEAR_BYTES)
            val doc = JSONObject(String(clear!!, Charsets.UTF_8))
            require(doc.length() == 11 && doc.getInt("version") == 1)
            val scope = NativePhotoBackupScope(
                origin = doc.getString("origin"),
                serverInstanceId = doc.getString("instance"),
                ownerId = doc.getLong("owner_id"),
                username = doc.getString("username"),
                rootId = doc.getLong("root_id"),
                rootRevision = doc.getLong("root_revision"),
            )
            val registration = NativeAndroidDeviceEnrollment(
                deviceId = doc.getString("device_id"),
                deviceToken = doc.getString("device_token"),
                displayName = doc.getString("device_name"),
                clientVersion = doc.getString("client_version"),
            )
            Stored(scope, registration)
        } catch (failure: Exception) {
            // Missing/replaced Keystore key, corruption or forged JSON must
            // NEVER turn into a fresh empty record or trigger re-enrollment.
            throw IllegalStateException("Device credential unreadable; re-enrollment requires user action", failure)
        } finally {
            clear?.fill(0)
        }
    }

    private fun sameOwner(
        stored: NativePhotoBackupScope,
        current: NativePhotoBackupScope,
    ): Boolean = stored.origin == current.origin &&
        stored.serverInstanceId == current.serverInstanceId &&
        stored.ownerId == current.ownerId &&
        stored.username == current.username &&
        stored.rootId == current.rootId
    // Root revision is deliberately omitted: it changes after normal uploads.

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val current = store.getKey(keyAlias, null) as? SecretKey
        if (current != null) return current
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }

    private data class Stored(
        val owner: NativePhotoBackupScope,
        val device: NativeAndroidDeviceEnrollment,
    )

    private companion object {
        const val PREF_KEY = "sealed-v1"
        const val NONCE_BYTES = 12
        const val MAX_CLEAR_BYTES = 8192
        const val MAX_SEALED_BYTES = MAX_CLEAR_BYTES + NONCE_BYTES + 16
        const val MAX_ENCODED_BYTES = 12000
        val AAD = "xdrive:android:photo-device-credential:v1".toByteArray(Charsets.UTF_8)
    }
}
