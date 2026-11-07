package com.tfluid.xdrive.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Checks the SAME production crypto used by the Android Compose Clipboard.
 * Fixed vectors are identical to tests/fixtures/clipboard-v1-interoperability.json.
 */
class NativeClipboardCryptoV1Test {
    private val crypto = XDriveClipboardCrypto
    private val salt = "AAECAwQFBgcICQoLDA0ODw=="
    private val scope = "https://clipboard.example.test:42"
    private val passphrase = "xDrive cross-platform test 2026!"
    private val expectedKey = "f859ab57d42b666950c02f8cb1be409d33c4e5ef41108ff2a2fc979884b35a65"
    private val canaryNonce = "8ODQwLCgkIBwYFBA"
    private val canaryCiphertext = "qOw85Hz0ilewRguONOrXWuJxRLeKUOJJ+hntOlwMn3bpt1yByOjwipg="

    @Test fun pbkdf2CanaryAndOwnerAADMustAgreeWithWebCrypto() {
        val key = crypto.deriveKey(passphrase, salt)
        assertEquals(expectedKey, key.encoded.joinToString("") {
            "%02x".format(it.toInt() and 255)
        })
        crypto.verifyCheck(key, scope, canaryNonce, canaryCiphertext)
        assertThrows(Exception::class.java) {
            crypto.verifyCheck(key, scope.replace(":42", ":43"), canaryNonce,
                canaryCiphertext)
        }
        val wrong = crypto.deriveKey(passphrase + " incorrect", salt)
        assertThrows(Exception::class.java) {
            crypto.verifyCheck(wrong, scope, canaryNonce, canaryCiphertext)
        }
    }

    @Test fun realNativeCipherDecryptsFixedWebUnicodeAndURLRecords() {
        val key = crypto.deriveKey(passphrase, salt)
        val rows = listOf(
            XDriveClipboardCrypto.Wire(
                "843c9d15-1011-4a5b-a8d6-393995c9b8ad", "text/plain",
                "AAECAwQFBgcICQoL",
                "IgzZe24sn5HJ8UZIdJFp36N60C1flWPsyBwpXa6U2HQy47AmFZ7qXEQtX33UzI6IZFHfbvsbdAAATDyJT7DaUceUPs9PAOXcDkGXY4b/M3ZJtcpb",
            ) to "中文 Clipboard — iOS · Android · Desktop · DSM\n第二行 🌐",
            XDriveClipboardCrypto.Wire(
                "1a44b191-36b3-4ef8-adc3-9f6ae2084df1", "text/uri-list",
                "DA0ODxAREhMUFRYX",
                "N2HsIS+C87irkgMZ4j2Q0agCr4OMbsmkOxdDthVprcOzXEvBgjk2PGjb3lPm5mdV",
            ) to "https://example.org/path?q=hello",
        )
        for ((wire, expected) in rows) {
            assertEquals(expected, crypto.decrypt(wire, key, scope))
            val emitted = crypto.encrypt(expected, key, scope, wire.clientEventID)
            assertEquals(wire.kind, emitted.kind)
            assertEquals(expected, crypto.decrypt(emitted, key, scope))
            assertThrows(Exception::class.java) {
                crypto.decrypt(wire.copy(kind =
                    if (wire.kind == "text/plain") "text/uri-list" else "text/plain"), key, scope)
            }
            assertThrows(Exception::class.java) {
                crypto.decrypt(wire.copy(clientEventID =
                    "00000000-0000-4000-8000-000000000002"), key, scope)
            }
            assertThrows(Exception::class.java) {
                crypto.decrypt(wire, key, scope.replace(":42", ":43"))
            }
            val corrupt = wire.ciphertext.replaceRange(0..0,
                if (wire.ciphertext[0] == 'A') "B" else "A")
            assertThrows(Exception::class.java) {
                crypto.decrypt(wire.copy(ciphertext = corrupt), key, scope)
            }
        }
    }

    @Test fun invalidAndOversizedContentIsRejected() {
        val key = crypto.deriveKey(passphrase, salt)
        assertThrows(Exception::class.java) { crypto.encrypt("", key, scope) }
        assertThrows(Exception::class.java) { crypto.encrypt("a".repeat(65537), key, scope) }
        assertThrows(Exception::class.java) {
            crypto.decrypt(XDriveClipboardCrypto.Wire(
                "00000000-0000-4000-8000-000000000002", "text/plain", "AAAA", "AA=="),
                key, scope)
        }
        assertEquals("text/uri-list", crypto.mediaKind(
            " https://example.org/path?q=hello "))
        assertTrue(key.encoded.size == 32)
    }
}
