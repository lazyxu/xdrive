package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativeUploadProgressTest {
    @Test fun uploadedAllChunksStillCannotPaintOneHundredBeforeFinalize() {
        assertEquals(0f, nativePendingUploadProgress(0L, 1024L)!!, 0.00001f)
        assertEquals(0.5f, nativePendingUploadProgress(512L, 1024L)!!, 0.00001f)
        assertTrue(nativePendingUploadProgress(1024L, 1024L)!! < 1f)
        assertTrue(nativeUploadAwaitingFinalReceipt(true, 1024L, 1024L))
        assertFalse(nativeUploadAwaitingFinalReceipt(false, 1024L, 1024L))
    }

    @Test fun zeroByteUploadIsIndeterminateEvenWhileServerCommits() {
        assertNull(nativePendingUploadProgress(0L, 0L))
        assertNull(nativePendingUploadProgress(50L, -1L))
        assertFalse(nativeUploadAwaitingFinalReceipt(true, 0L, 0L))
    }

    @Test fun malformedOrStaleChunkCountersRemainBounded() {
        assertEquals(0f, nativePendingUploadProgress(-2L, 500L)!!, 0f)
        assertEquals(0.999f, nativePendingUploadProgress(900L, 500L)!!, 0f)
        assertTrue(nativeUploadAwaitingFinalReceipt(true, 900L, 500L))
        assertFalse(nativeUploadAwaitingFinalReceipt(true, 0L, 500L))
    }

    @Test fun hugeFilesCannotRoundUnfinishedTransferUpToOne() {
        val almostComplete = nativePendingUploadProgress(Long.MAX_VALUE - 1L,
            Long.MAX_VALUE)!!
        assertTrue(almostComplete < 1f)
        assertEquals(0.999f, almostComplete, 0.000001f)
        assertFalse(nativeUploadAwaitingFinalReceipt(true,
            Long.MAX_VALUE - 1L, Long.MAX_VALUE))
        assertTrue(nativeUploadAwaitingFinalReceipt(true,
            Long.MAX_VALUE, Long.MAX_VALUE))
    }
}
