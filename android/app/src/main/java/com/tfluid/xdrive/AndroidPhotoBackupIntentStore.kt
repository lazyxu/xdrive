package com.tfluid.xdrive

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

/**
 * Distinct encrypted metadata-only native Photo backup checkpoint. No raw
 * MediaStore content URI, path, album name, token, credential, media bytes or
 * private thumbnail is accepted by the serialized schema.
 *
 * This is NOT the existing foreground SAF recovery ledger and NOT an uploader.
 * Caller must not send a byte or create UploadSession until write() commits.
 */
internal class AndroidPhotoBackupIntentStore(
    context: Context,
    private val preferenceName: String = "xdrive-android-photo-backup-intent-v1",
    private val keyAlias: String = "xdrive-android-photo-backup-intent-v1",
) : NativePhotoBackupIntentStore {
    private val prefs = context.applicationContext.getSharedPreferences(
        preferenceName, Context.MODE_PRIVATE)

    @Synchronized
    override fun read(): List<NativePhotoBackupIntent> {
        val raw = try { prefs.getString(PREF_KEY, null) }
            catch (e: Exception) { throw unreadable(e) } ?: return emptyList()
        var clear: ByteArray? = null
        return try {
            require(raw.length in 28..MAX_ENCODED_BYTES)
            val data = Base64.decode(raw, Base64.NO_WRAP)
            require(data.size > NONCE_BYTES + 16)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(),
                GCMParameterSpec(128, data.copyOfRange(0, NONCE_BYTES)))
            cipher.updateAAD(AAD)
            clear = cipher.doFinal(data.copyOfRange(NONCE_BYTES, data.size))
            require(clear!!.size <= MAX_PLAINTEXT_BYTES)
            val json = JSONObject(String(clear!!, Charsets.UTF_8))
            require(json.length() == 2 && json.getInt("version") == 1)
            val rows = json.getJSONArray("entries")
            require(rows.length() <= NativePhotoBackupLedger.MAX_ENTRIES)
            (0 until rows.length()).map { i ->
                val row = rows.getJSONObject(i)
                require(row.length() == 17)
                NativePhotoBackupIntent(
                    id = row.getString("id"),
                    owner = NativePhotoBackupOwner(
                        serverOrigin = row.getString("origin"),
                        instanceId = row.getString("instance"),
                        ownerId = row.getLong("owner_id"),
                        username = row.getString("username"),
                        rootNodeId = row.getLong("root_id"),
                        rootRevision = row.getLong("root_revision"),
                        deviceId = row.getString("device"),
                    ),
                    assetKey = row.getString("asset_key"),
                    versionKey = row.getString("version_key"),
                    resource = NativePhotoBackupResource.valueOf(row.getString("resource")),
                    originalSha256 = row.getString("sha256"),
                    sizeBytes = row.getLong("bytes"),
                    phase = NativePhotoBackupPhase.valueOf(row.getString("phase")),
                    createdAtMillis = row.getLong("created_ms"),
                    verifiedNodeId = if (row.isNull("node_id")) null else row.getLong("node_id"),
                    verifiedNodeRevision = if (row.isNull("node_revision")) null
                        else row.getLong("node_revision"),
                )
            }.also { items ->
                require(items.map { it.id }.toSet().size == items.size)
                require(items.map {
                    listOf(it.owner, it.assetKey, it.versionKey, it.resource)
                }.toSet().size == items.size)
                require(items.count { it.phase == NativePhotoBackupPhase.MAY_HAVE_SENT } <= 1)
            }
        } catch (e: Exception) {
            // Keystore loss, tampering and unparseable data must block writes;
            // never replace an uncertain prior intent with an empty history.
            throw unreadable(e)
        } finally {
            clear?.fill(0)
        }
    }

    @Synchronized
    override fun write(entries: List<NativePhotoBackupIntent>) {
        require(entries.size <= NativePhotoBackupLedger.MAX_ENTRIES &&
            entries.map { it.id }.toSet().size == entries.size &&
            entries.map { listOf(it.owner, it.assetKey, it.versionKey, it.resource) }
                .toSet().size == entries.size &&
            entries.count { it.phase == NativePhotoBackupPhase.MAY_HAVE_SENT } <= 1)
        if (entries.isEmpty()) {
            // Caller may use this only after verified migration or a clean
            // preflight. No method on the public ledger silently clears a
            // possibly submitted upload.
            check(prefs.edit().remove(PREF_KEY).commit()) {
                "Photo intent journal clear did not commit"
            }
            return
        }
        var clear: ByteArray? = null
        try {
            val rows = JSONArray()
            entries.forEach { entry ->
                rows.put(JSONObject()
                    .put("id", entry.id)
                    .put("origin", entry.owner.serverOrigin)
                    .put("instance", entry.owner.instanceId)
                    .put("owner_id", entry.owner.ownerId)
                    .put("username", entry.owner.username)
                    .put("root_id", entry.owner.rootNodeId)
                    .put("root_revision", entry.owner.rootRevision)
                    .put("device", entry.owner.deviceId)
                    .put("asset_key", entry.assetKey)
                    .put("version_key", entry.versionKey)
                    .put("resource", entry.resource.name)
                    .put("sha256", entry.originalSha256)
                    .put("bytes", entry.sizeBytes)
                    .put("phase", entry.phase.name)
                    .put("created_ms", entry.createdAtMillis)
                    .put("node_id", entry.verifiedNodeId ?: JSONObject.NULL)
                    .put("node_revision", entry.verifiedNodeRevision ?: JSONObject.NULL))
            }
            clear = JSONObject().put("version", 1).put("entries", rows)
                .toString().toByteArray(Charsets.UTF_8)
            require(clear!!.size <= MAX_PLAINTEXT_BYTES)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(AAD)
            val sealed = cipher.iv + cipher.doFinal(clear)
            require(sealed.size <= MAX_ENCODED_BYTES)
            check(prefs.edit().putString(PREF_KEY,
                Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()) {
                "Encrypted Photo backup checkpoint did not commit"
            }
        } catch (e: Exception) {
            throw IllegalStateException("Encrypted Photo backup checkpoint failed", e)
        } finally {
            clear?.fill(0)
        }
    }

    private fun key(): SecretKey {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keystore.getKey(keyAlias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }

    private fun unreadable(cause: Exception) =
        IllegalStateException("Encrypted Photo backup journal unreadable", cause)

    private companion object {
        const val PREF_KEY = "sealed-v1"
        const val NONCE_BYTES = 12
        const val MAX_PLAINTEXT_BYTES = 120 * 1024
        const val MAX_ENCODED_BYTES = 200 * 1024
        val AAD = "xdrive:android:photo-backup-intents:v1".toByteArray(Charsets.UTF_8)
    }
}
