package com.tfluid.xdrive

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exact bounded MediaStore DATE_ADDED grouping, never a full-library index. */
class NativeLocalDateWindowTest {
    private fun seconds(text: String) = Instant.parse(text).epochSecond
    private val utc = ZoneId.of("UTC")

    @Test fun fourScalesAndContiguousPagesKeepExactLoadedIndices() {
        assertEquals(listOf("year","month","day","all"),
            nativeLocalDateWindowScales.map { it.first })
        val rows = listOf(
            seconds("2026-11-01T10:00:00Z"),
            seconds("2026-11-01T09:00:00Z"),
            seconds("2026-10-31T23:00:00Z"),
            seconds("2025-12-31T10:00:00Z"),
        )
        val months = nativeLocalDateWindowGroups(rows, "month", utc)
        assertEquals(listOf("2026-11","2026-10","2025-12"), months.map { it.key })
        assertEquals(listOf(0,2,3), months.map { it.firstIndex })
        assertEquals(listOf(2,1,1), months.map { it.count })
        assertEquals("2026年11月", months.first().label)
        assertEquals(listOf("2026","2025"),
            nativeLocalDateWindowGroups(rows, "year", utc).map { it.key })
        assertEquals(4, nativeLocalDateWindowGroups(rows, "day", utc).sumOf { it.count })
        assertTrue(nativeLocalDateWindowGroups(rows, "all", utc).isEmpty())
    }

    @Test fun timezoneBoundaryAndUnknownTimestampsAreExplicit() {
        val rows = listOf(
            seconds("2026-11-01T08:30:00Z"),
            seconds("2026-11-01T06:30:00Z"),
            0L, -1L,
        )
        val groups = nativeLocalDateWindowGroups(rows, "day",
            ZoneId.of("America/Los_Angeles"))
        assertEquals(listOf("2026-11-01","2026-10-31","unknown"),
            groups.map { it.key })
        assertEquals(listOf(1,1,2), groups.map { it.count })
        assertEquals("加入日期未知", groups.last().label)
    }

    @Test fun onlyBoundedRowsCanBuildAnIndex() {
        val items = List(NativeLocalMediaStore.MAX_WALL_ITEMS) {
            seconds("2026-01-01T00:00:00Z")
        }
        assertEquals(1, nativeLocalDateWindowGroups(items, "year", utc).size)
        assertThrows(IllegalArgumentException::class.java) {
            nativeLocalDateWindowGroups(items + 1L, "month", utc)
        }
    }
}
