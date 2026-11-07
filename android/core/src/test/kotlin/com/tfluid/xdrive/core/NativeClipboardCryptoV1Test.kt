package com.tfluid.xdrive.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same fixed vectors as tests/fixtures/clipboard-v1-interoperability.json.
 * Validate the JVM/Android provider against real WebCrypto ciphertext.
 */
class NativeClipboardCryptoV1Test {
    private val crypto = NativeClipboardCryptoV1
    private val salt = "AAECAwQFBgcICQoLDA0ODw=="
    private val scope = "https://clipboard.example.test:42"
    private val passphrase = "xDrive cross-platform test 2026!"
    private val expectedKey = "f859ab57d42b666950c02f8cb1be409d33c4e5ef41108ff2a2fc979884b35a65"
    private val checkNonce = "8ODQwLCgkIBwYFBA"
    private val checkCiphertext = "qOw85Hz0ilewRguONOrXWuJxRLeKUOJJ+hntOlwMn3bpt1yByOjwipg="

    @Test fun pbkdf2AndVaultCanaryMatchWebCrypto() {
        val key = crypto.deriveKey(passphrase, salt)
        try {
            assertEquals(expectedKey, key.joinToString("") { "%02x".format(it.toInt() and 255) })
            crypto.verifyVault(key, scope, checkNonce, checkCiphertext)
            assertThrows(SecurityException::class.java) {
                crypto.verifyVault(key, scope.replace(":42", ":43"), checkNonce, checkCiphertext)
            }
            assertThrows(SecurityException::class.java) {
                val wrong = crypto.deriveKey(passphrase + " incorrect", salt)
                try { crypto.verifyVault(wrong, scope, checkNonce, checkCiphertext) }
                finally { wrong.fill(0) }
            }
        } finally { key.fill(0) }
    }

    @Test fun fixedUnicodeAndLinkCiphertextsMatchWebCrypto() {
        val key = crypto.deriveKey(passphrase, salt)
        try {
            val cases = listOf(
                Triple("843c9d15-1011-4a5b-a8d6-393995c9b8ad", "AAECAwQFBgcICQoL", "IgzZe24sn5HJ8UZIdJFp36N60C1flWPsyBwpXa6U2HQy47AmFZ7qXEQtX33UzI6IZFHfbvsbdAAATDyJT7DaUceUPs9PAOXcDkGXY4b/M3ZJtcpb"),
                Triple("1a44b191-36b3-4ef8-adc3-9f6ae2084df1", "DA0ODxAREhMUFRYX", "N2HsIS+C87irkgMZ4j2Q0agCr4OMbsmkOxdDthVprcOzXEvBgjk2PGjb3lPm5mdV"),
            )
            val contents = listOf(
                "中文 Clipboard — iOS · Android · Desktop · DSM\n第二行 🌐",
                "https://example.org/path?q=hello",
            )
            for ((index, vector) in cases.withIndex()) {
                val (eventID, nonce, ciphertext) = vector
                val text = contents[index]
                val kind = crypto.kind(text)
                assertEquals(text, crypto.decrypt(key, scope, eventID, kind, nonce, ciphertext))
                val sealed = crypto.encrypt(key, scope, eventID, text,
                    java.util.Base64.getDecoder().decode(nonce))
                assertEquals(kind, sealed.kind)
                assertEquals(ciphertext, sealed.ciphertext)
                assertThrows(Exception::class.java) {
                    crypto.decrypt(key, scope, eventID,
                        if (kind == "text/plain") "text/uri-list" else "text/plain", nonce, ciphertext)
                }
                assertThrows(Exception::class.java) {
                    crypto.decrypt(key, scope,
                        "00000000-0000-4000-8000-000000000002", kind, nonce, ciphertext)
                }
                assertThrows(Exception::class.java) {
                    crypto.decrypt(key, scope, eventID, kind, nonce,
                        ciphertext.replaceRange(0..0, "A"))
                }
            }
        } finally { key.fill(0) }
    }

    @Test fun malformedAndOversizedInputsFailClosed() {
        val key = crypto.deriveKey(passphrase, salt)
        try {
            assertThrows(Exception::class.java) {
                crypto.encrypt(key, scope, "not-uuid", "secret")
            }
            assertThrows(Exception::class.java) {
                crypto.encrypt(key, scope, "00000000-0000-4000-8000-000000000002", "")
            }
            assertThrows(Exception::class.java) {
                crypto.encrypt(key, scope, "00000000-0000-4000-8000-000000000002",
                    "a".repeat(65537))
            }
            assertThrows(Exception::class.java) {
                crypto.decrypt(key, scope, "00000000-0000-4000-8000-000000000002",
                    "text/plain", "AAAA", "AA==")
            }
            assertTrue(crypto.kind("  https://example.org/path?q=hello  ") == "text/uri-list")
        } finally { key.fill(0) }
    }
}
