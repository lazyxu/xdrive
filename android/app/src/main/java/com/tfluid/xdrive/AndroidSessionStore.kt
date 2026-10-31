package com.tfluid.xdrive

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.tfluid.xdrive.core.AuthSession
import com.tfluid.xdrive.core.ServerAddress
import com.tfluid.xdrive.core.XDriveService
import com.tfluid.xdrive.core.ApiException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Only a rotating refresh credential is durable. Access tokens and passwords stay in memory. */
data class SavedDriveSession(val server: String, val username: String, val refreshToken: String) {
    override fun toString() = "SavedDriveSession(server=$server, username=[redacted], refreshToken=[redacted])"
}

interface DriveSessionPersistence {
    fun load(): SavedDriveSession?
    fun save(server: String, session: AuthSession)
    fun clear()
    /** Null means this host does not provide a coordinated remembered refresh.
     * The foreground and WorkManager Android hosts use the same rotation gate. */
    suspend fun coordinatedRefresh(
        service: XDriveService, server: String, username: String,
    ): AuthSession? = null

    /** Native Android also owns a distinct, encrypted transfer uncertainty
     * journal. Other test/host persistence implementations may omit it. */
    fun transferRecovery(): DriveTransferRecoveryBridge? = null
}

/**
 * Android Keystore AES-GCM, private preferences and no Android backup.
 * Never persist the key, plaintext credentials, or an HTTP-origin refresh token.
 * Keystore loss/corruption fails closed and returns to the normal login form.
 */
internal class AndroidSessionStore(
    context: Context,
    preferenceName: String = "auth-session",
    private val keyAlias: String = "xdrive-android-session-v1",
) : DriveSessionPersistence {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(preferenceName, Context.MODE_PRIVATE)
    private val recoveryBridge by lazy {
        AndroidDriveTransferRecoveryBridge(context.applicationContext)
    }
    override fun transferRecovery(): DriveTransferRecoveryBridge = recoveryBridge

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(keyAlias, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }

    override fun save(server: String, session: AuthSession) {
        // HTTP is an explicitly risky manual connection, never a background credential.
        val origin = ServerAddress.parse(server).url
        require(origin.startsWith("https://"))
        require(session.username.isNotBlank() && session.refreshToken.isNotBlank())
        val plain = JSONObject()
            .put("server", origin)
            .put("username", session.username)
            .put("refresh", session.refreshToken)
            .toString().toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(AAD)
        val sealed = cipher.iv + cipher.doFinal(plain)
        // commit() reports an actual persistence failure rather than claiming success.
        try {
            synchronized(persistenceGuard) {
                // Manual login under a different Owner or HTTPS installation
                // revokes the former photo schedule before new credentials
                // become current. Coordinated refresh keeps the same identity.
                val previous = load()
                if (previous != null &&
                    (previous.server != origin ||
                        previous.username != session.username)) {
                    AndroidPhotoAutoBackupScheduler.disable(app)
                }
                check(prefs.edit().putString(PREF_KEY,
                    Base64.encodeToString(sealed, Base64.NO_WRAP)).commit())
            }
        } finally { plain.fill(0) }
    }

    override fun load(): SavedDriveSession? {
        val encrypted = prefs.getString(PREF_KEY, null) ?: return null
        return try {
            val bytes = Base64.decode(encrypted, Base64.DEFAULT)
            require(bytes.size > IV_BYTES + 16)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_BYTES)))
            cipher.updateAAD(AAD)
            val decoded = cipher.doFinal(bytes.copyOfRange(IV_BYTES, bytes.size))
            val data = JSONObject(String(decoded, Charsets.UTF_8))
            decoded.fill(0)
            val server = ServerAddress.parse(data.getString("server")).url
            val username = data.getString("username")
            val refresh = data.getString("refresh")
            require(username.isNotBlank() && refresh.isNotBlank())
            SavedDriveSession(server, username, refresh)
        } catch (_: Exception) {
            clear()
            null
        }
    }

    override fun clear() {
        // Revoke the WorkManager grant BEFORE deleting credentials. A running
        // photo job then fails its consent check, even if it held an old bearer.
        synchronized(persistenceGuard) {
            AndroidPhotoAutoBackupScheduler.disable(app)
            check(prefs.edit().remove(PREF_KEY).commit()) {
                "Android remembered session was not cleared"
            }
        }
    }

    /**
     * One process-wide refresh rotation for UI and WorkManager.
     *
     * The transport uses the latest *persisted* refresh secret, not an old
     * Controller copy. After a network ACK, a fresh committed-state comparison
     * prevents logout, server switch or another login from resurrecting the
     * previous Owner. Only the current exact Owner's newly rotated credential
     * is atomically saved. No second background session store is created.
     */
    override suspend fun coordinatedRefresh(
        service: XDriveService, server: String, username: String,
    ): AuthSession = refreshMutex.withLock {
        val origin = ServerAddress.parse(server).url
        check(origin == server && username.isNotBlank())
        val original = load() ?: throw ApiException(401, "Remembered session unavailable")
        check(original.server == server && original.username == username) {
            "Photo backup Owner or Server changed before refresh"
        }
        val latest = service.refresh(original.refreshToken)
        check(latest.username == username) {
            "Rotated session belongs to another Owner"
        }
        synchronized(persistenceGuard) {
            val current = load() ?: throw ApiException(401, "Session revoked")
            check(current.server == original.server &&
                current.username == original.username &&
                current.refreshToken == original.refreshToken) {
                "Photo session was replaced during refresh"
            }
            save(server, latest)
        }
        latest
    }

    private companion object {
        val refreshMutex = Mutex()
        val persistenceGuard = Any()
        const val KEY_ALIAS = "xdrive-android-session-v1"
        const val PREF_KEY = "sealed-v1"
        const val IV_BYTES = 12
        val AAD = "xdrive:android:auth:v1".toByteArray(Charsets.UTF_8)
    }
}
