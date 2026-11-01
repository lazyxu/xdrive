package com.tfluid.xdrive

import com.tfluid.xdrive.core.GalleryTimelineGroup
import com.tfluid.xdrive.core.GalleryTimelineSets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The quick scales must be backed by a real Server Owner timeline index. */
class NativeGalleryTimeDockTest {
    private val group = GalleryTimelineGroup("2026-10-30", 42, 10)
    private val sets = GalleryTimelineSets(
        year = listOf(group.copy(key = "2026")),
        month = listOf(group.copy(key = "2026-10")),
        day = listOf(group),
    )

    @Test fun fourNativeScalesFollowPhotosTimelineOrder() {
        assertEquals(listOf("year", "month", "day", "all"),
            nativeGalleryTimeDockScales.map { it.first })
        assertEquals(listOf("年", "月", "日", "全部"),
            nativeGalleryTimeDockScales.map { it.second })
    }

    @Test fun dayUsesRealFullRangeIndexNotVisibleRows() {
        assertTrue(nativeGalleryTimeDockEnabled("day", sets, busy = false))
        assertFalse(nativeGalleryTimeDockEnabled("day",
            sets.copy(day = emptyList()), busy = false))
        assertTrue(nativeGalleryTimeDockEnabled("all",
            sets.copy(year = emptyList(), month = emptyList(), day = emptyList()),
            busy = false))
        assertFalse(nativeGalleryTimeDockEnabled("unknown", sets, busy = false))
    }

    @Test fun loadingDisablesAllJumpButtons() {
        for ((scale, _) in nativeGalleryTimeDockScales)
            assertFalse(nativeGalleryTimeDockEnabled(scale, sets, busy = true))
    }
}
