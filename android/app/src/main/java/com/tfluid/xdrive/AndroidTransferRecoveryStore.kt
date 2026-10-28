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

/** Encrypted, private, no-backup crash *uncertainty markers*.
 * This never stores a SAF URI, upload session, source filename, access/refresh
 * token or any content bytes. A lost key/corrupt journal is reported as an
 * unreadable recovery state, never as "no interrupted transfers". */
internal class AndroidTransferRecoveryStore(
    context: Context,
    private val preferencesName: String = "xdrive-native-transfer-recovery-v1",
    private val keyAlias: String = "xdrive-android-transfer-recovery-v1",
) : TransferRecoveryStore {
    private val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    @Synchronized
    override fun read(): List<TransferRecoveryMarker> {
        val raw = try { preferences.getString(PREF_KEY, null) }
            catch (e: Exception) { throw unreadable(e) } ?: return emptyList()
        var clearBytes: ByteArray? = null
        return try {
            require(raw.length in 28..MAX_ENCODED_BYTES)
            val sealed = Base64.decode(raw, Base64.NO_WRAP)
            require(sealed.size > NONCE_BYTES + 16)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(),
                GCMParameterSpec(128, sealed.copyOfRange(0, NONCE_BYTES)))
            cipher.updateAAD(AAD)
            clearBytes = cipher.doFinal(sealed.copyOfRange(NONCE_BYTES, sealed.size))
            val json = JSONObject(String(clearBytes, Charsets.UTF_8))
            require(json.length() == 2 && json.getInt("version") == 1)
            val items = json.getJSONArray("entries")
            require(items.length() <= NativeTransferRecoveryLedger.MAX_UNCONFIRMED_TRANSFERS)
            val decoded = (0 until items.length()).map { i ->
                val item = items.getJSONObject(i)
                require(item.length() == 5)
                TransferRecoveryMarker(
                    id = item.getString("id"),
                    owner = TransferRecoveryOwner(item.getString("server"),
                        item.getString("username")),
                    kind = TransferRecoveryKind.valueOf(item.getString("kind")),
                    startedAtUnixMillis = item.getLong("started_at_ms"),
                )
            }
            require(decoded.map { it.id }.toSet().size == decoded.size)
            decoded
        } catch (e: Exception) {
            // Do not delete the record on decryption/format failure; a source
            // may have committed on Go before process death. Owner must be
            // warned through the caller's explicit unreadable state.
            throw unreadable(e)
        } finally {
            clearBytes?.fill(0)
        }
    }

    @Synchronized
    override fun write(entries: List<TransferRecoveryMarker>) {
        require(entries.size <= NativeTransferRecoveryLedger.MAX_UNCONFIRMED_TRANSFERS &&
            entries.map { it.id }.toSet().size == entries.size)
        if (entries.isEmpty()) {
            // Only a verified ACK / user reconciliation may call this path.
            check(preferences.edit().remove(PREF_KEY).commit()) {
                "Failed to durably clear verified transfer marker"
            }
            return
        }
        var clear: ByteArray? = null
        try {
            val items = JSONArray()
            for (entry in entries) {
                items.put(JSONObject()
                    .put("id", entry.id)
                    .put("server", entry.owner.server)
                    .put("username", entry.owner.username)
                    .put("kind", entry.kind.name)
                    .put("started_at_ms", entry.startedAtUnixMillis))
            }
            clear = JSONObject().put("version", 1)
                .put("entries", items).toString().toByteArray(Charsets.UTF_8)
            require(clear.size <= MAX_PLAINTEXT_BYTES)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(AAD)
            val data = cipher.iv + cipher.doFinal(clear)
            require(data.size <= MAX_ENCODED_BYTES)
            // commit(), not apply(): callers must await durable confirmation
            // BEFORE sending even one upload/session request or SAF write.
            check(preferences.edit().putString(PREF_KEY,
                Base64.encodeToString(data, Base64.NO_WRAP)).commit()) {
                "Transfer recovery marker was not durably persisted"
            }
        } catch (e: Exception) {
            throw IllegalStateException("Encrypted transfer checkpoint write failed", e)
        } finally {
            clear?.fill(0)
        }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val previous = keyStore.getKey(keyAlias, null) as? SecretKey
        if (previous != null) return previous
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
        IllegalStateException("Encrypted transfer recovery journal unreadable", cause)

    private companion object {
        const val PREF_KEY = "sealed-v1"
        const val NONCE_BYTES = 12
        const val MAX_PLAINTEXT_BYTES = 20 * 1024
        const val MAX_ENCODED_BYTES = 28 * 1024
        val AAD = "xdrive:android:transfer-recovery:v1".toByteArray(Charsets.UTF_8)
    }
}
