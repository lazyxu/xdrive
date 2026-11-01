package com.tfluid.xdrive

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

/** Exact full-prefix keyset groups, not a 512-row snapshot of all media URIs. */
class NativeLocalFullDateIndexTest {
    private fun key(t: String, id: Long) =
        NativeLocalPageKey(Instant.parse(t).epochSecond, id)
    private val dayA = "2026-11-01T10:00:00Z"
    private val dayB = "2026-10-31T10:00:00Z"

    @Test fun anchorsCrossProviderPageAndFindOlderThanWindow() {
        val builder = NativeLocalFullDateIndexBuilder(ZoneId.of("UTC"))
        val a = key(dayA, 105)
        val b = key(dayA, 104)
        val c = key(dayB, 103)
        val d = key("2025-12-30T10:00:00Z", 102)
        assertTrue(builder.append(listOf(a, b)))
        assertTrue(builder.append(listOf(c, d)))
        val index = builder.snapshot(complete = true)
        assertTrue(index.complete)
        assertEquals(4, index.scanned)
        assertEquals(listOf("2026-11", "2026-10", "2025-12"),
            index.months.map { it.key })
        assertEquals(listOf(0,2,3), index.months.map { it.firstIndex })
        assertEquals(listOf(null,b,c), index.months.map { it.before })
        assertEquals(listOf(2,1,1), index.months.map { it.count })
        assertEquals(listOf("2026","2025"), index.years.map { it.key })
        assertEquals(4, index.days.sumOf { it.count })
        assertTrue(index.forScale("all").isEmpty())
    }

    @Test fun timezoneAndUnknownDatesKeepFirstKeysetAnchor() {
        val builder = NativeLocalFullDateIndexBuilder(
            ZoneId.of("America/Los_Angeles"))
        val newer = key("2026-11-01T08:30:00Z", 8)
        val older = key("2026-11-01T06:30:00Z", 7)
        val noDate = NativeLocalPageKey(0, 6)
        assertTrue(builder.append(listOf(newer,older,noDate)))
        val index = builder.snapshot(true)
        assertEquals(listOf("2026-11-01","2026-10-31","unknown"),
            index.days.map { it.key })
        assertEquals(listOf(null,newer,older), index.days.map { it.before })
        assertEquals("加入日期未知", index.days.last().label)
    }

    @Test fun rejectsRepeatedKeyAndDoesNotTurnBudgetLimitIntoCompletion() {
        val builder = NativeLocalFullDateIndexBuilder(ZoneId.of("UTC"), maxGroups = 3)
        val first = key(dayA, 5)
        assertTrue(builder.append(listOf(first)))
        assertFalse(builder.append(listOf(key(dayB, 4))))
        assertEquals(1, builder.scanned)
        val partial = builder.snapshot(complete = false, groupBudgetHit = true)
        assertFalse(partial.complete)
        assertTrue(partial.groupBudgetHit)
        assertThrows(IllegalStateException::class.java) {
            builder.append(listOf(first))
        }
    }

    @Test fun manySameDayRowsUseOneGroupNotOnePhotoObjectPerItem() {
        val builder = NativeLocalFullDateIndexBuilder(ZoneId.of("UTC"))
        val base = Instant.parse(dayA).epochSecond
        repeat(128) { page ->
            val keys = (0 until 512).map { i ->
                NativeLocalPageKey(base, 90000L - page * 512 - i)
            }
            assertTrue(builder.append(keys))
        }
        val index = builder.snapshot(false)
        assertEquals(65536, index.scanned)
        assertEquals(1, index.years.size)
        assertEquals(1, index.months.size)
        assertEquals(1, index.days.size)
        assertEquals(65536, index.days.single().count)
        assertFalse(index.complete)
    }

    @Test fun allReloadsActualNewestAfterBoundedWallEviction() {
        assertFalse(nativeLocalMustRestartNewest(0, 0, null))
        assertTrue(nativeLocalMustRestartNewest(128, 0, null))
        assertTrue(nativeLocalMustRestartNewest(0, 1536, NativeLocalPageKey(200, 5)))
        assertTrue(nativeLocalMustRestartNewest(0, 0, NativeLocalPageKey(200, 5)))
    }

    @Test fun zeroMediaCanProduceCompleteEmptyIndex() {
        val snapshot = NativeLocalFullDateIndexBuilder(ZoneId.of("UTC"))
            .snapshot(true)
        assertTrue(snapshot.complete)
        assertTrue(snapshot.days.isEmpty())
        assertEquals(0, snapshot.scanned)
    }
}
