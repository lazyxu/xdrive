package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Navigation only traverses loaded source keys, never the full device library. */
class NativeLocalViewerLoadedNavigationTest {
    private val first = NativeLocalViewerItemKey(31L, false, "camera", 1234L)
    private val second = NativeLocalViewerItemKey(30L, true, "camera", 1233L)
    private val last = NativeLocalViewerItemKey(29L, false, "camera", 1232L)
    private val page = listOf(first, second, last)

    @Test fun traversesOneExistingNeighborWithoutInventingMoreItems() {
        assertEquals(0, nativeLocalViewerLoadedIndex(page, first))
        assertEquals(1, nativeLocalViewerNeighborIndex(page, first, 1))
        assertEquals(0, nativeLocalViewerNeighborIndex(page, second, -1))
        assertEquals(2, nativeLocalViewerNeighborIndex(page, second, 1))
        assertNull(nativeLocalViewerNeighborIndex(page, first, -1))
        assertNull(nativeLocalViewerNeighborIndex(page, last, 1))
        assertNull(nativeLocalViewerNeighborIndex(page, second, 0))
        assertNull(nativeLocalViewerNeighborIndex(page, second, 2))
    }

    @Test fun rejectsEvictedOrReusedIdsWithChangedMediaKindAlbumOrTimestamp() {
        assertNull(nativeLocalViewerLoadedIndex(page, first.copy(isVideo = true)))
        assertNull(nativeLocalViewerNeighborIndex(page, second.copy(albumId = "other"), -1))
        assertNull(nativeLocalViewerNeighborIndex(page, second.copy(addedAtSeconds = 3333), 1))
        assertNull(nativeLocalViewerNeighborIndex(emptyList(), first, 1))
    }

    @Test fun refusesOversizedWallAndReturnsFocusToLastVisitedExactItem() {
        assertNull(nativeLocalViewerNeighborIndex(
            List(NativeLocalMediaStore.MAX_WALL_ITEMS + 1) { first }, first, 1))
        val next = page[nativeLocalViewerNeighborIndex(page, first, 1)!!]
        val anchor = NativeLocalViewerReturnAnchor(next, false, null, 7)
        assertEquals(1, nativeLocalViewerReturnIndex(anchor, page, false, null, 7, true))
        assertNull(nativeLocalViewerReturnIndex(anchor, page, false, null, 8, true))
    }
}
