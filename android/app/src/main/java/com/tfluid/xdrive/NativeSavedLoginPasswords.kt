package com.tfluid.xdrive

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.tfluid.xdrive.core.ServerAddress
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

/** Public profile only. No password, refresh token or authorization in Compose or connection prefs. */
data class NativeLoginProfile(val server: String, val lanIp: String, val username: String) {
    // The selected LAN identity is part of the key: changing the route never replays an old secret.
    val id: String get() = "$server\u001f$lanIp\u001f$username"
}

interface NativeSavedLoginStore {
    fun profiles(): List<NativeLoginProfile>
    fun passwordFor(profile: NativeLoginProfile): String?
    fun rememberProfile(profile: NativeLoginProfile): Boolean
    fun savePassword(profile: NativeLoginProfile, password: String): Boolean
    fun removePassword(profile: NativeLoginProfile): Boolean
    fun forgetProfile(profile: NativeLoginProfile): Boolean
}

/** Android Keystore AES-GCM; preferences contain metadata and ciphertext, never plaintext. */
internal class AndroidSavedLoginPasswords(context: Context) : NativeSavedLoginStore {
    private val prefs = context.applicationContext.getSharedPreferences("auth-login-profiles", Context.MODE_PRIVATE)
    private val alias = "xdrive-native-login-password-v1"

    companion object {
        private const val MAX = 12
        fun profile(server: String, lanIp: String, username: String): NativeLoginProfile? {
            if (server.toByteArray(Charsets.UTF_8).size > 512 ||
                lanIp.toByteArray(Charsets.UTF_8).size > 128 ||
                username.isEmpty() || username.toByteArray(Charsets.UTF_8).size > 128 ||
                username != username.trim() || username.any { it.isISOControl() }) return null
            return try {
                val address = ServerAddress.parse(server, false)
                if (!address.url.startsWith("https://")) return null
                com.tfluid.xdrive.core.ConnectionRoute(lanIp = lanIp).validate(address)
                NativeLoginProfile(address.url, lanIp, username)
            } catch (_: Exception) { null }
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }

    private fun secretKey(profile: NativeLoginProfile) =
        "secret:" + Base64.encodeToString(profile.id.toByteArray(Charsets.UTF_8),
            Base64.NO_WRAP or Base64.URL_SAFE)

    private fun serialize(rows: List<NativeLoginProfile>): String {
        val values = JSONArray()
        rows.forEach { item ->
            values.put(JSONObject().put("server", item.server).put("lanIp", item.lanIp)
                .put("username", item.username))
        }
        return values.toString()
    }

    override fun profiles(): List<NativeLoginProfile> {
        val raw = prefs.getString("profiles", null) ?: return emptyList()
        if (raw.length > 16384) return emptyList()
        val array = try { JSONArray(raw) } catch (_: Exception) { return emptyList() }
        val result = ArrayList<NativeLoginProfile>()
        val seen = HashSet<String>()
        for (index in 0 until minOf(array.length(), MAX * 2)) {
            val record = array.optJSONObject(index) ?: continue
            val item = profile(record.optString("server"), record.optString("lanIp"),
                record.optString("username")) ?: continue
            if (seen.add(item.id)) result.add(item)
            if (result.size >= MAX) break
        }
        return result
    }

    private fun updatedProfiles(profile: NativeLoginProfile) =
        (listOf(profile) + profiles().filter { it.id != profile.id }).take(MAX)

    override fun rememberProfile(profile: NativeLoginProfile): Boolean {
        if (profile(profile.server, profile.lanIp, profile.username) != profile) return false
        return prefs.edit().putString("profiles", serialize(updatedProfiles(profile))).commit()
    }

    override fun passwordFor(profile: NativeLoginProfile): String? {
        if (profile(profile.server, profile.lanIp, profile.username) != profile) return null
        val encoded = prefs.getString(secretKey(profile), null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(profile.id.toByteArray(Charsets.UTF_8))
        val plain = cipher.doFinal(bytes.copyOfRange(12, bytes.size))
        return try { String(plain, Charsets.UTF_8).takeIf { it.isNotEmpty() && plain.size <= 4096 } }
        finally { plain.fill(0) }
    }

    override fun savePassword(profile: NativeLoginProfile, password: String): Boolean {
        if (profile(profile.server, profile.lanIp, profile.username) != profile ||
            password.isEmpty() || password.toByteArray(Charsets.UTF_8).size > 4096) return false
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(profile.id.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.iv + cipher.doFinal(password.toByteArray(Charsets.UTF_8))
        return prefs.edit()
            .putString(secretKey(profile), Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("profiles", serialize(updatedProfiles(profile)))
            .commit()
    }

    override fun removePassword(profile: NativeLoginProfile): Boolean =
        prefs.edit().remove(secretKey(profile)).commit()

    override fun forgetProfile(profile: NativeLoginProfile): Boolean =
        prefs.edit().remove(secretKey(profile))
            .putString("profiles", serialize(profiles().filter { it.id != profile.id }))
            .commit()
}
