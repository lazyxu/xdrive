package com.tfluid.xdrive

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Source-agnostic contract; actual MediaStore provider resolution remains
 * Android instrumentation-only and does not assume device access. */
class NativeLocalStillFallbackPolicyTest {
    @Test fun successfulOriginalSkipsThumbnailRead() = runTest {
        var thumbnailReads = 0
        val result = readLocalStillWithFallback(
            original = { "actual-original" },
            thumbnail = { thumbnailReads++; "fallback" },
        )
        assertEquals(NativeLocalStillRead.Original("actual-original"), result)
        assertEquals(0, thumbnailReads)
    }

    @Test fun failedOriginalMayDisplayOnlyTruthfullyLabeledThumbnail() = runTest {
        var thumbnailReads = 0
        val result = readLocalStillWithFallback(
            original = { throw IllegalArgumentException("unsupported codec") },
            thumbnail = { thumbnailReads++; "derived-system-thumbnail" },
        )
        assertEquals(NativeLocalStillRead.Thumbnail("derived-system-thumbnail"), result)
        assertEquals(1, thumbnailReads)
    }

    @Test fun explicitRetryKeepsPriorThumbnailAndNeverReadsItTwice() = runTest {
        var thumbnailReads = 0
        val degraded = readLocalStillWithFallback(
            previousThumbnail = "previous-fallback",
            original = { throw IllegalStateException("original still unavailable") },
            thumbnail = { thumbnailReads++; "should-not-read" },
        )
        assertEquals(NativeLocalStillRead.Thumbnail("previous-fallback"), degraded)
        assertEquals(0, thumbnailReads)

        val recovered = readLocalStillWithFallback(
            previousThumbnail = "previous-fallback",
            original = { "verified-original" },
            thumbnail = { thumbnailReads++; "should-not-read" },
        )
        assertEquals(NativeLocalStillRead.Original("verified-original"), recovered)
        assertEquals(0, thumbnailReads)
    }

    @Test fun unrecognizedOrRevokedThumbnailNeverClaimsSuccess() = runTest {
        val empty = readLocalStillWithFallback(
            original = { throw IllegalStateException("decode failed") },
            thumbnail = { null as String? },
        )
        assertEquals(NativeLocalStillRead.Failed, empty)
        val denied = readLocalStillWithFallback(
            original = { throw IllegalStateException("decode failed") },
            thumbnail = { throw SecurityException("revoked") },
        )
        assertEquals(NativeLocalStillRead.Failed, denied)
    }

    @Test fun explicitCancellationNeverRequestsThumbnail() = runTest {
        var thumbnailFetched = false
        try {
            readLocalStillWithFallback(
                original = { throw CancellationException("Viewer closed") },
                thumbnail = { thumbnailFetched = true; "wrong" },
            )
            throw AssertionError("cancelled original should not degrade")
        } catch (_: CancellationException) {
            assertFalse(thumbnailFetched)
        }
    }

    @Test fun noncooperativeOldOriginalFailureCannotFetchAfterNavigation() = runTest {
        val blocked = CompletableDeferred<Unit>()
        var thumbnailFetched = false
        val old = async {
            readLocalStillWithFallback(
                original = {
                    withContext(NonCancellable) { blocked.await() }
                    throw IllegalStateException("stale decode failure")
                },
                thumbnail = { thumbnailFetched = true; "stale" },
            )
        }
        runCurrent()
        old.cancel()
        blocked.complete(Unit)
        runCurrent()
        assertTrue(old.isCancelled)
        assertFalse(thumbnailFetched)
    }
}
