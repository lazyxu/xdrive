package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** JVM lifecycle contract, independent of a specific OEM codec stack. */
class LivePlayerSetupTest {
    private class DummyPlayer {
        var prepared = false
        var releases = 0
    }

    @Test fun successfulPrepareRetainsLivePlayerForNormalDisposableRelease() {
        val player = DummyPlayer()
        val result = createPreparedMediaResource(
            build = { player },
            prepare = { it.prepared = true },
            release = { it.releases++ },
        )
        assertSame(player, result)
        assertTrue(player.prepared)
        assertEquals(0, player.releases)
    }

    @Test fun mediaSourceOrPrepareFailureReleasesAllocatedPlayerExactlyOnce() {
        val player = DummyPlayer()
        val result = createPreparedMediaResource(
            build = { player },
            prepare = { throw IllegalStateException("synthetic codec error") },
            release = { it.releases++ },
        )
        assertNull(result)
        assertEquals(1, player.releases)
    }

    @Test fun buildFailureHasNoPlayerToReleaseAndReturnsUnavailable() {
        var attempts = 0
        var releases = 0
        val result = createPreparedMediaResource(
            build = {
                attempts++
                throw IllegalStateException("synthetic unavailable decoder")
            },
            prepare = { _: DummyPlayer -> fail("must not prepare") },
            release = { _: DummyPlayer -> releases++ },
        )
        assertNull(result)
        assertEquals(1, attempts)
        assertEquals(0, releases)
    }

    @Test fun vendorReleaseFailureCannotMaskOriginalSetupFailureOrCrashComposition() {
        val player = DummyPlayer()
        val result = createPreparedMediaResource(
            build = { player },
            prepare = { throw IllegalArgumentException("synthetic bad source") },
            release = { it.releases++; throw IllegalStateException("synthetic release failure") },
        )
        assertNull(result)
        assertEquals(1, player.releases)
    }

    @Test fun aFreshVerifiedHoldCanTryAgainAfterPreviousLeaseFailed() {
        val badPlayer = DummyPlayer()
        val goodPlayer = DummyPlayer()
        assertNull(createPreparedMediaResource(
            build = { badPlayer },
            prepare = { throw IllegalStateException("failed") },
            release = { it.releases++ },
        ))
        assertEquals(1, badPlayer.releases)
        assertSame(goodPlayer, createPreparedMediaResource(
            build = { goodPlayer },
            prepare = { it.prepared = true },
            release = { it.releases++ },
        ))
        assertTrue(goodPlayer.prepared)
        assertEquals(0, goodPlayer.releases)
    }

    @Test fun liveMotionOnlyStartsAfterRealForegroundHoldAndReadyStill() {
        assertFalse(liveMotionMayStart(false, true, true, false))
        assertFalse(liveMotionMayStart(true, false, true, false))
        assertFalse(liveMotionMayStart(true, true, false, false))
        assertTrue(liveMotionMayStart(true, true, true, false))
    }

    @Test fun cloudLivePhotoRequiresDecodedStillAndDefaultZoom() {
        assertTrue(galleryLivePhotoHoldAllowed(true, true, 1f))
        assertTrue(galleryLivePhotoHoldAllowed(true, true, 1.001f))
        assertFalse(galleryLivePhotoHoldAllowed(false, true, 1f))
        assertFalse(galleryLivePhotoHoldAllowed(true, false, 1f))
        assertFalse(galleryLivePhotoHoldAllowed(true, true, 1.01f))
        assertFalse(galleryLivePhotoHoldAllowed(true, true, 2f))
        assertFalse(galleryLivePhotoHoldAllowed(true, true, 5f))
        assertFalse(galleryLivePhotoHoldAllowed(true, true, 0.5f))
        assertFalse(galleryLivePhotoHoldAllowed(true, true, Float.NaN))
        assertFalse(galleryLivePhotoHoldAllowed(true, true, Float.POSITIVE_INFINITY))
    }

    @Test fun magnificationOrStillEvictionRevokesCurrentLiveHold() {
        var held = true
        val stillReady = true
        // A valid hold starts only while the still is decoded and at 1x.
        assertTrue(held && galleryLivePhotoHoldAllowed(true, stillReady, 1f))
        // Even before the observer's cancellation callback runs, the Viewer
        // must pass held=false to the Media3 effect at magnified zoom.
        assertFalse(held && galleryLivePhotoHoldAllowed(true, stillReady, 2f))
        held = false // zoom action clears the original press intent
        assertFalse(held && galleryLivePhotoHoldAllowed(true, stillReady, 1f))
        assertFalse(held && galleryLivePhotoHoldAllowed(true, false, 1f))
    }

    @Test fun missingOwnerMotionLeaseIsTerminalOnlyWhileCurrentHoldIsActive() {
        assertTrue(liveMotionUnavailableAfterRead(
            activeHold = true, sourceReturned = false))
        assertFalse(liveMotionUnavailableAfterRead(
            activeHold = false, sourceReturned = false))
        assertFalse(liveMotionUnavailableAfterRead(
            activeHold = true, sourceReturned = true))
        assertFalse(liveMotionUnavailableAfterRead(
            activeHold = false, sourceReturned = true))
    }

    @Test fun loadingIndicatorNeverOverlaysTerminalLiveMotionStatus() {
        assertTrue(liveMotionPendingIndicatorAllowed(
            ended = false, failed = false, playerSetupFailed = false))
        assertFalse(liveMotionPendingIndicatorAllowed(
            ended = false, failed = true, playerSetupFailed = false))
        assertFalse(liveMotionPendingIndicatorAllowed(
            ended = false, failed = false, playerSetupFailed = true))
        assertFalse(liveMotionPendingIndicatorAllowed(
            ended = true, failed = false, playerSetupFailed = false))
    }

    @Test fun heldPointerSurvivingStopCannotRestartMotionOnResume() {
        // App was visible and motion legitimately played.
        assertTrue(liveMotionMayStart(true, true, true, false))
        // STOP must cut off the active stream immediately.
        assertFalse(liveMotionMayStart(true, true, false, true))
        // ON_START alone never reopens the stream with the stale press.
        assertFalse(liveMotionMayStart(true, true, true, true))
        // A new explicit user press (after release) reauthorizes one lease.
        assertTrue(liveMotionMayStart(true, true, true, false))
    }
}
