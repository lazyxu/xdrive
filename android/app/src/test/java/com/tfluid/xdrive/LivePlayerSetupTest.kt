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
