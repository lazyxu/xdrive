package com.tfluid.xdrive.core

import org.junit.Assert.*
import org.junit.Test

/** Pure JVM protocol regressions; production listener uses this exact parser. */
class XDriveClipboardSSECursorTest {
    private fun frame(cursor: XDriveClipboardSSECursor, vararg lines: String): Boolean =
        lines.fold(false) { _, line -> cursor.acceptLine(line) }

    @Test fun syncAndChangeYieldOnlyInvalidationAndMonotonicCursor() {
        val decoder = XDriveClipboardSSECursor()
        assertTrue(frame(decoder, "retry: 2000", "event: sync", "data: {}", ""))
        assertEquals(0L, decoder.cursor)
        assertTrue(frame(decoder, "id: 17", "event: change", "data: {}", ""))
        assertEquals(17L, decoder.cursor)
        assertFalse(frame(decoder, ": ping", "id: 17", "event: change", "data: {}", ""))
        assertEquals(17L, decoder.cursor)
        assertTrue(frame(decoder, "id: 18", "event: change", "data: {}", ""))
        assertEquals(18L, decoder.cursor)
    }

    @Test fun partialFrameMustNotNotifyAndReconnectPreservesCursor() {
        val first = XDriveClipboardSSECursor(22)
        assertFalse(first.acceptLine("id: 23"))
        assertFalse(first.acceptLine("event: change"))
        val second = XDriveClipboardSSECursor(first.cursor)
        assertFalse(frame(second, "id: 22", "event: change", "data: {}", ""))
        assertTrue(frame(second, "event: sync", "data: {}", ""))
        assertTrue(frame(second, "id: 24", "event: change", "data: {}", ""))
        assertEquals(24L, second.cursor)
    }

    @Test fun rejectInvalidCursorOversizeAndSecretPayload() {
        val decoder = XDriveClipboardSSECursor()
        for (line in listOf("id: -1", "id: 0", "id: 9999999999999999999999999",
            "event: clipboard-plaintext", "data: secret", "data: {\"nonce\":\"leak\"}",
            "unknown: value", "x".repeat(4097))) {
            assertThrows(IllegalArgumentException::class.java) {
                XDriveClipboardSSECursor().acceptLine(line)
            }
        }
        assertFalse(decoder.acceptLine(": ping"))
    }

    @Test fun streamWithoutDataOrValidIdNeverSignals() {
        assertFalse(frame(XDriveClipboardSSECursor(), "event: change", "data: {}", ""))
        assertFalse(frame(XDriveClipboardSSECursor(), "event: sync", ""))
    }
}
