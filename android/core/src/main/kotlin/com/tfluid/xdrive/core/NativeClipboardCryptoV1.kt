package com.tfluid.xdrive.core

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Wire-compatible with ui/shared/src/clipboard-crypto.ts (Web/PWA).
 * This is plaintext-in-memory-only crypto, not an Owner credential or a storage API.
 * The caller must verify current Owner before/after each HTTP action and wipe
 * its active key when the Owner/session/foreground lifetime ends.
 */
object NativeClipboardCryptoV1 {
    const val ITERATIONS = 310_000
    const val MAX_TEXT_BYTES = 64 * 1024
    private const val NONCE_LENGTH = 12
    private const val AUTH_TAG_BITS = 128
    private const val KEY_BITS = 256
    private const val VERIFIER_EVENT_ID = "00000000-0000-4000-8000-000000000001"
    private const val VERIFIER_TEXT = "xDrive Clipboard Vault v1"
    private val uuid = Regex("^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$")
    private val uri = Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)

    data class Sealed(val kind: String, val nonce: String, val ciphertext: String)

    fun kind(text: String): String =
        if (uri.matches(text.trim())) "text/uri-list" else "text/plain"

    fun validText(text: String): Boolean =
        text.toByteArray(Charsets.UTF_8).size in 1..MAX_TEXT_BYTES

    private fun decoded64(value: String): ByteArray {
        require(value.length % 4 == 0 && value.matches(Regex("^[A-Za-z0-9+/]+={0,2}$"))) {
            "Invalid Clipboard base64"
        }
        val decoded = Base64.getDecoder().decode(value)
        require(Base64.getEncoder().encodeToString(decoded) == value) { "Noncanonical Clipboard base64" }
        return decoded
    }

    fun deriveKey(passphrase: String, salt: String): ByteArray {
        require(passphrase.length in 12..256) { "Invalid Clipboard passphrase" }
        val saltBytes = decoded64(salt)
        require(saltBytes.size == 16) { "Invalid Clipboard KDF salt" }
        val spec = PBEKeySpec(passphrase.toCharArray(), saltBytes, ITERATIONS, KEY_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
                .also { require(it.size == KEY_BITS / 8) }
        } finally {
            spec.clearPassword()
            saltBytes.fill(0)
        }
    }

    private fun aad(scope: String, eventID: String, kind: String): ByteArray {
        require(scope.isNotBlank() && scope.length <= 512 && !scope.contains('\u0000')) {
            "Invalid Clipboard Owner scope"
        }
        require(uuid.matches(eventID)) { "Invalid Clipboard event ID" }
        require(kind == "text/plain" || kind == "text/uri-list") { "Invalid Clipboard media kind" }
        return "xdrive-clipboard-v1|$scope|$eventID|$kind".toByteArray(Charsets.UTF_8)
    }

    fun encrypt(
        key: ByteArray, scope: String, eventID: String, text: String,
        nonce: ByteArray = ByteArray(NONCE_LENGTH).also(SecureRandom()::nextBytes),
    ): Sealed {
        require(key.size == KEY_BITS / 8 && nonce.size == NONCE_LENGTH && validText(text)) {
            "Invalid Clipboard encryption input"
        }
        val kind = kind(text)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"),
            GCMParameterSpec(AUTH_TAG_BITS, nonce))
        cipher.updateAAD(aad(scope, eventID, kind))
        val ciphertext = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        return Sealed(kind, Base64.getEncoder().encodeToString(nonce),
            Base64.getEncoder().encodeToString(ciphertext))
    }

    fun decrypt(
        key: ByteArray, scope: String, eventID: String, kind: String,
        nonce: String, ciphertext: String,
    ): String {
        require(key.size == KEY_BITS / 8) { "Invalid Clipboard key" }
        val nonceBytes = decoded64(nonce)
        val encrypted = decoded64(ciphertext)
        require(nonceBytes.size == NONCE_LENGTH && encrypted.size in 17..(MAX_TEXT_BYTES + 16)) {
            "Invalid Clipboard encrypted item"
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"),
            GCMParameterSpec(AUTH_TAG_BITS, nonceBytes))
        cipher.updateAAD(aad(scope, eventID, kind))
        val plaintext = cipher.doFinal(encrypted)
        return try {
            val decoded = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(plaintext)).toString()
            require(validText(decoded)) { "Invalid Clipboard UTF-8 payload" }
            decoded
        } finally {
            plaintext.fill(0)
        }
    }

    fun sealVaultVerifier(key: ByteArray, scope: String): Sealed =
        encrypt(key, scope, VERIFIER_EVENT_ID, VERIFIER_TEXT)

    /** Wrong passphrase, wrong Owner, or a damaged verifier always fail closed. */
    fun verifyVault(key: ByteArray, scope: String, nonce: String, ciphertext: String) {
        try {
            check(decrypt(key, scope, VERIFIER_EVENT_ID, "text/plain", nonce, ciphertext) ==
                VERIFIER_TEXT)
        } catch (_: Exception) {
            throw SecurityException("Clipboard verifier or password invalid")
        }
    }
}
