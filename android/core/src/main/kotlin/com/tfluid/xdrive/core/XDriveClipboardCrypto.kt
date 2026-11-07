package com.tfluid.xdrive.core

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Exact shared Web AES-GCM v1 text wire contract. Keys only live in memory. */
object XDriveClipboardCrypto {
    const val MAX_TEXT_BYTES = 65536
    const val ITERATIONS = 310000
    private const val CHECK_EVENT_ID = "00000000-0000-4000-8000-000000000001"
    private const val CHECK_TEXT = "xDrive Clipboard Vault v1"
    private val uriPattern = Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)

    data class Wire(
        val clientEventID: String, val kind: String,
        val nonce: String, val ciphertext: String,
    )
    fun mediaKind(text: String): String =
        if (uriPattern.matches(text.trim())) "text/uri-list" else "text/plain"

    fun deriveKey(passphrase: String, saltBase64: String): SecretKeySpec {
        require(passphrase.length in 12..256) { "剪贴板口令须为 12–256 个字符" }
        val salt = Base64.getDecoder().decode(saltBase64)
        require(salt.size == 16) { "剪贴板盐长度无效" }
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, ITERATIONS, 256)
        val derived = try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally { spec.clearPassword() }
        return try {
            require(derived.size == 32)
            SecretKeySpec(derived, "AES")
        } finally { derived.fill(0) }
    }
    private fun aad(scope: String, eventID: String, kind: String): ByteArray =
        "xdrive-clipboard-v1|$scope|$eventID|$kind".toByteArray(Charsets.UTF_8)

    fun encrypt(text: String, key: SecretKeySpec, scope: String,
        eventID: String = UUID.randomUUID().toString().lowercase()): Wire {
        val bytes = text.toByteArray(Charsets.UTF_8)
        require(bytes.size in 1..MAX_TEXT_BYTES && eventID.length == 36)
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val kind = mediaKind(text)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD(aad(scope, eventID, kind))
        val encrypted = cipher.doFinal(bytes)
        return Wire(eventID, kind, Base64.getEncoder().encodeToString(iv),
            Base64.getEncoder().encodeToString(encrypted))
    }
    fun decrypt(item: Wire, key: SecretKeySpec, scope: String): String {
        require(item.kind == "text/plain" || item.kind == "text/uri-list")
        require(runCatching { UUID.fromString(item.clientEventID) }.isSuccess)
        val iv = Base64.getDecoder().decode(item.nonce)
        val encrypted = Base64.getDecoder().decode(item.ciphertext)
        require(iv.size == 12 && encrypted.size in 17..MAX_TEXT_BYTES + 16)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD(aad(scope, item.clientEventID, item.kind))
        val plain = cipher.doFinal(encrypted)
        require(plain.size in 1..MAX_TEXT_BYTES)
        return Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(plain)).toString()
    }
    fun newCheck(key: SecretKeySpec, scope: String): Wire =
        encrypt(CHECK_TEXT, key, scope, CHECK_EVENT_ID)
    fun verifyCheck(key: SecretKeySpec, scope: String, nonce: String, ciphertext: String) {
        val ok = runCatching {
            decrypt(Wire(CHECK_EVENT_ID, "text/plain", nonce, ciphertext), key, scope)
        }.getOrNull()
        require(ok == CHECK_TEXT) { "剪贴板口令错误或验证密文损坏" }
    }
}
