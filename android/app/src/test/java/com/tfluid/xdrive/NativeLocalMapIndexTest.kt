package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativeLocalMapIndexTest {
    @Test fun rejectsInvalidCoordinatesWithoutIncrementingCount() {
        val original = NativeLocalMapIndex<String>()
        assertSame(original, original.append(Double.NaN, 1.0, "bad"))
        assertSame(original, original.append(91.0, 1.0, "bad"))
        assertSame(original, original.append(0.0, Double.POSITIVE_INFINITY, "bad"))
        assertEquals(
            NativeLocalMapIndex.keyFor(20.0, -180.0, 0),
            NativeLocalMapIndex.keyFor(20.0, 180.0, 0),
        )
    }

    @Test fun preservesAllCountsWhenSpreadingAndCoarseningOverSixtyFourCells() {
        var index = NativeLocalMapIndex<Int>()
        for (i in 0 until 4096) {
            val latitude = -80.0 + (i % 90) * 1.5
            val longitude = -170.0 + (i % 200) * 1.6
            index = index.append(latitude, longitude, i)
        }
        assertEquals(4096, index.locatedCount)
        assertTrue(index.cells.size <= NativeLocalMapIndex.MAX_CELLS)
        assertEquals(4096, index.cells.sumOf { it.count })
        assertTrue(index.level > 0)
        assertTrue(index.cells.all {
            it.members.isNotEmpty() &&
                it.members.size <= NativeLocalMapIndex.MAX_PREVIEW_ITEMS &&
                it.count >= it.members.size
        })
    }

    @Test fun readsOnlyCanonicalIso6709VideoLocations() {
        assertEquals(37.4219 to -122.0840, nativeVideoGps("+37.4219-122.0840/"))
        assertEquals(-33.86 to 151.2, nativeVideoGps("-33.86+151.200/"))
        assertNull(nativeVideoGps("37.42,-122.08"))
        assertNull(nativeVideoGps("+91.0+001.000/"))
        assertNull(nativeVideoGps("+22.2+181.000/"))
        assertNull(nativeVideoGps(null))
    }

    @Test fun sameCellCountsMoreThanBoundedPreviewAndPreservesEarliestMembers() {
        var index = NativeLocalMapIndex<Int>()
        for (i in 0..142) index = index.append(35.0, 139.0, i)
        val cell = index.cells.single()
        assertEquals(143, cell.count)
        assertEquals((0 until 48).toList(), cell.members)
        assertEquals(143, index.locatedCount)
    }

    @Test fun totalsAndPreviewMembersSurviveMergeOfSparseNearbyCells() {
        var index = NativeLocalMapIndex<Int>()
        for (i in 0 until 80) index = index.append(
            -60.0 + i * 1.4, -170.0 + i * 4.0, i)
        val sourceIds = index.cells.flatMap { it.members }
        assertEquals(80, index.cells.sumOf { it.count })
        assertTrue(index.cells.size <= NativeLocalMapIndex.MAX_CELLS)
        assertTrue(sourceIds.distinct().size == sourceIds.size)
    }
}
