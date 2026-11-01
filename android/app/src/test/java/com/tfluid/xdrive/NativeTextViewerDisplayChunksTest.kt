package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A screen may chunk 1 MiB of text, but it must not corrupt a
 * Unicode glyph or a CRLF line ending at a Compose item boundary. */
class NativeTextViewerDisplayChunksTest {
    @Test fun emojiCrossing4096CodeUnitBoundaryRemainsWhole() {
        val content = "a".repeat(4095) + "😀" + "尾部"
        val chunks = nativeTextViewerDisplayChunks(content)
        assertEquals(content, chunks.joinToString(separator = ""))
        assertEquals(4095, chunks.first().length)
        assertTrue(chunks.all { it.length <= 4096 })
        assertFalse(chunks.any { chunk ->
            Character.isHighSurrogate(chunk.last()) ||
                Character.isLowSurrogate(chunk.first())
        })
    }

    @Test fun crlfIsKeptTogetherAcrossChunkBoundary() {
        val content = "x".repeat(4095) + "\r\n" + "next"
        val chunks = nativeTextViewerDisplayChunks(content)
        assertEquals(content, chunks.joinToString(separator = ""))
        assertEquals(4095, chunks.first().length)
        assertFalse(chunks.any { it.endsWith("\r") || it.startsWith("\n") })
    }

    @Test fun emptyShortAndOneMegabyteInputsRemainBoundedAndLossless() {
        assertTrue(nativeTextViewerDisplayChunks("").isEmpty())
        assertEquals(listOf("readme"), nativeTextViewerDisplayChunks("readme"))
        val content = "a".repeat(1024 * 1024)
        val chunks = nativeTextViewerDisplayChunks(content)
        assertEquals(256, chunks.size)
        assertTrue(chunks.all { it.length == 4096 })
        assertEquals(content, chunks.joinToString(separator = ""))
    }

    @Test fun smallBoundaryNeverSplitsAdjacentSupplementaryCodePoints() {
        val content = "📷📷🚀📷"
        val chunks = nativeTextViewerDisplayChunks(content, maxUnits = 3)
        assertEquals(content, chunks.joinToString(separator = ""))
        assertTrue(chunks.all { it.isNotEmpty() && it.length <= 3 })
        assertFalse(chunks.any { chunk ->
            Character.isHighSurrogate(chunk.last()) ||
                Character.isLowSurrogate(chunk.first())
        })
    }
}
