package com.tfluid.xdrive.core

import org.junit.Assert.*
import org.junit.Test

/** Pure deterministic BD09 camera timing, Owner epoch and cache regressions.
 * No SDK/provider/network mock or imaginary map tile is needed. */
class OwnerBd09ViewportGateTest {
    private val world = OwnerBd09Bounds.WORLD
    private fun bounds(i: Int) = OwnerBd09Bounds(
        130.0 + i * .01, 30.0, 131.0 + i * .01, 31.0)
    private fun cells(i: Int = 0) = OwnerBd09MapCells(
        listOf(OwnerBd09Cell(0, 0, 1,
            assetId = 100L + i, nodeId = 200L + i, nodeRevision = 1,
            latitude = 30.5, longitude = 130.5 + i * .01)), 1)
    private fun fetch(result: Bd09ViewportDecision?): Bd09ViewportPermit =
        (result as Bd09ViewportDecision.Fetch).permit

    @Test fun idle500msOneInFlightAndOneStartPerSecond() {
        val gate = OwnerBd09ViewportGate()
        assertTrue(gate.moved(bounds(0), 1_000))
        assertNull(gate.poll(1_499))
        val first = fetch(gate.poll(1_500))
        assertEquals(bounds(0), first.bounds)
        assertNull(gate.poll(2_000)) // one in flight
        assertTrue(gate.moved(bounds(1), 1_600))
        assertNull(gate.poll(2_200)) // first still in flight
        assertFalse(gate.succeeded(first, cells(0))) // obsolete motion
        assertNull(gate.poll(2_499)) // rate limit from 1_500
        val second = fetch(gate.poll(2_500))
        assertEquals(bounds(1), second.bounds)
        assertTrue(gate.succeeded(second, cells(1)))
        assertNull(gate.poll(2_501))
        assertEquals(1, gate.cachedCount())
    }

    @Test fun newMotionDropsOldIntentAndOnlyLatestCameraIsRead() {
        val gate = OwnerBd09ViewportGate()
        gate.moved(bounds(0), 100)
        gate.moved(bounds(1), 200)
        gate.moved(bounds(2), 300)
        assertNull(gate.poll(799))
        assertEquals(bounds(2), fetch(gate.poll(800)).bounds)
    }

    @Test fun serverFailureRequiresExplicitRetryNotFramePolling() {
        val gate = OwnerBd09ViewportGate()
        gate.moved(world, 0)
        val permit = fetch(gate.poll(500))
        assertTrue(gate.failed(permit))
        for (clock in listOf(1_500L, 2_000L, 20_000L))
            assertNull(gate.poll(clock))
        gate.moved(world, 30_000) // repeated callback same viewport is not retry authority
        assertNull(gate.poll(30_500))
        assertTrue(gate.retryAfterFailure(31_000))
        assertNull(gate.poll(31_499))
        val retried = fetch(gate.poll(31_500))
        assertEquals(world, retried.bounds)
        assertTrue(gate.succeeded(retried, cells()))
    }

    @Test fun ownerSessionClearsPrivateCacheAndRejectsOldReply() {
        val gate = OwnerBd09ViewportGate()
        gate.moved(world, 0)
        val old = fetch(gate.poll(500))
        gate.clearSession()
        assertFalse(gate.succeeded(old, cells()))
        assertEquals(0, gate.cachedCount())
        gate.moved(world, 600)
        assertNull(gate.poll(1_099))
        val fresh = fetch(gate.poll(1_100))
        assertNotEquals(old.sessionEpoch, fresh.sessionEpoch)
        assertTrue(gate.succeeded(fresh, cells()))
        gate.clearSession()
        assertEquals(0, gate.cachedCount())
        gate.moved(world, 2_000)
        assertTrue(gate.poll(2_500) is Bd09ViewportDecision.Fetch)
    }

    @Test fun sameOwnerSessionCacheIsBoundedAndNeverRefetchedOnReturn() {
        val gate = OwnerBd09ViewportGate(maxCacheEntries = 2)
        var clock = 0L
        for (i in 0..2) {
            gate.moved(bounds(i), clock)
            val permit = fetch(gate.poll(clock + 500))
            // The actual Owner representative must lie inside the viewport.
            assertTrue(gate.succeeded(permit, cells(i)))
            clock += 1_000
        }
        assertEquals(2, gate.cachedCount())
        gate.moved(bounds(2), 3_000)
        val cached = gate.poll(3_500) as Bd09ViewportDecision.Cached
        assertEquals(cells(2), cached.cells)
        assertNull(gate.poll(4_000)) // delivered only once per motion
        gate.moved(bounds(0), 4_100) // LRU has evicted viewport zero
        assertTrue(gate.poll(4_600) is Bd09ViewportDecision.Fetch)
    }

    @Test fun invalidGeometryAndClockRollbackCannotStartAnyGet() {
        val gate = OwnerBd09ViewportGate()
        assertFalse(gate.moved(OwnerBd09Bounds(0.0, 0.0, 1e-12, 1.0), 0))
        assertNull(gate.poll(500))
        gate.moved(world, 1_000)
        assertNull(gate.poll(900))
        assertNull(gate.poll(1_499))
        val ticket = fetch(gate.poll(1_500))
        val invalidSnapshot = OwnerBd09MapCells(
            listOf(OwnerBd09Cell(0, 0, 2, 100, 200, 1, 35.0, 139.0)), 1)
        assertFalse(gate.succeeded(ticket, invalidSnapshot))
        assertEquals(0, gate.cachedCount())
        assertNull(gate.poll(1_700)) // throttle remains in force
        assertNull(gate.poll(20_000)) // bad response never auto-retries
        assertTrue(gate.retryAfterFailure(20_100))
        assertTrue(gate.poll(20_600) is Bd09ViewportDecision.Fetch)
    }

    @Test fun boundedConstructionAndNoUnauthenticatedGlobalRateClaims() {
        for (bad in listOf(-1, 0, 33)) try {
            OwnerBd09ViewportGate(maxCacheEntries = bad)
            fail("Invalid cache bound $bad")
        } catch (_: IllegalArgumentException) {}
        try {
            OwnerBd09ViewportGate(idleMillis = 100)
            fail("Sub-500ms idle accepted")
        } catch (_: IllegalArgumentException) {}
        try {
            OwnerBd09ViewportGate(startIntervalMillis = 100)
            fail("Sub-1000ms throttle accepted")
        } catch (_: IllegalArgumentException) {}
        val gate = OwnerBd09ViewportGate()
        gate.moved(world, 100)
        assertNull(gate.poll(-1))
        assertEquals(0, gate.cachedCount())
    }
}
