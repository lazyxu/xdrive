package com.tfluid.xdrive

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.XDriveClipboardTargetCrypto
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Separately authorized Clipboard device key, stored as authenticated,
 * scoped ciphertext under a hardware-backed AndroidKeyStore key when available.
 * This is NOT an UploadSession, SourceRun, Photo grant or Agent credential.
 * The public/private keypair is created only on an explicit Owner action.
 */
internal class AndroidClipboardDeviceKeyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(
        "xdrive-clipboard-device-key-v1", Context.MODE_PRIVATE)

    @Synchronized
    fun loadOrCreate(scope: NativePhotoBackupScope, deviceID: String): XDriveClipboardTargetCrypto.DeviceKey {
        require(UUID.fromString(deviceID).toString() == deviceID)
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(
            listOf(scope.origin, scope.serverInstanceId, scope.ownerId.toString(),
                scope.username, scope.rootId.toString(), deviceID)
                .joinToString("|").toByteArray(StandardCharsets.UTF_8))
        val current = prefs.getString("sealed-v1", null)
        if (current != null) {
            val envelope = Base64.decode(current, Base64.NO_WRAP)
            require(envelope.size in (12 + 16 + 32 + 36 + 32 + 2 + 45)..512)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, envelope.copyOfRange(0, 12)))
            cipher.updateAAD("xdrive-clipboard-device-key-v1".toByteArray(StandardCharsets.UTF_8))
            val clear = cipher.doFinal(envelope.copyOfRange(12, envelope.size))
            try {
                val bytes = ByteBuffer.wrap(clear)
                val scopeFingerprint = ByteArray(32).also { bytes.get(it) }
                val id = ByteArray(36).also { bytes.get(it) }
                val pubRaw = ByteArray(32).also { bytes.get(it) }
                val keyLength = bytes.short.toInt() and 0xffff
                check(keyLength in 45..200 && bytes.remaining() == keyLength)
                check(MessageDigest.isEqual(fingerprint, scopeFingerprint) &&
                    id.toString(StandardCharsets.US_ASCII) == deviceID) {
                    "Clipboard Owner/device changed; explicit reset required"
                }
                val secret = ByteArray(keyLength).also { bytes.get(it) }
                return XDriveClipboardTargetCrypto.DeviceKey(
                    java.util.Base64.getEncoder().encodeToString(pubRaw), secret)
            } finally { clear.fill(0) }
        }
        val generated = XDriveClipboardTargetCrypto.newDeviceKey()
        val pubRaw = java.util.Base64.getDecoder().decode(generated.publicKeyBase64)
        check(pubRaw.size == 32 && generated.pkcs8Private.size in 45..200)
        val id = deviceID.toByteArray(StandardCharsets.US_ASCII)
        val clear = ByteBuffer.allocate(32 + id.size + 32 + 2 + generated.pkcs8Private.size)
            .put(fingerprint).put(id).put(pubRaw).putShort(generated.pkcs8Private.size.toShort())
            .put(generated.pkcs8Private).array()
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
            cipher.updateAAD("xdrive-clipboard-device-key-v1".toByteArray(StandardCharsets.UTF_8))
            val sealed = cipher.iv + cipher.doFinal(clear)
            check(sealed.size <= 512)
            check(prefs.edit().putString("sealed-v1",
                Base64.encodeToString(sealed, Base64.NO_WRAP)).commit()) {
                "Clipboard private key could not be securely persisted"
            }
            return generated
        } catch (failure: Exception) {
            generated.pkcs8Private.fill(0)
            throw failure
        } finally { clear.fill(0) }
    }

    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val saved = store.getKey("xdrive-clipboard-device-key-v1", null) as? SecretKey
        if (saved != null) return saved
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder("xdrive-clipboard-device-key-v1",
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
}
