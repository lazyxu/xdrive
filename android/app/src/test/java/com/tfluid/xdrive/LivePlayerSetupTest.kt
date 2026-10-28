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
        val result = createPreparedLiveResource(
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
        val result = createPreparedLiveResource(
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
        val result = createPreparedLiveResource(
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
        val result = createPreparedLiveResource(
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
        assertNull(createPreparedLiveResource(
            build = { badPlayer },
            prepare = { throw IllegalStateException("failed") },
            release = { it.releases++ },
        ))
        assertEquals(1, badPlayer.releases)
        assertSame(goodPlayer, createPreparedLiveResource(
            build = { goodPlayer },
            prepare = { it.prepared = true },
            release = { it.releases++ },
        ))
        assertTrue(goodPlayer.prepared)
        assertEquals(0, goodPlayer.releases)
    }
}
