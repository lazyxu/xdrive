package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeLocalViewerReturnTest {
    private val photo = NativeLocalViewerItemKey(21L, false, "camera", 2000L)
    private val video = NativeLocalViewerItemKey(22L, true, "camera", 1999L)
    private val rows = listOf(photo, video)

    @Test fun returnsExactTileWithinSameAuthorizedPageAndSource() {
        val wall = NativeLocalViewerReturnAnchor(video, false, null, 7)
        assertEquals(1, nativeLocalViewerReturnIndex(wall, rows, false, null, 7, true))
        val album = NativeLocalViewerReturnAnchor(video, true, "camera", 7)
        assertEquals(1, nativeLocalViewerReturnIndex(album, rows, true, "camera", 7, true))
    }

    @Test fun rejectsRevokedGrantDifferentAlbumOrNewGeneration() {
        val anchor = NativeLocalViewerReturnAnchor(photo, true, "camera", 7)
        assertNull(nativeLocalViewerReturnIndex(anchor, rows, true, "camera", 7, false))
        assertNull(nativeLocalViewerReturnIndex(anchor, rows, true, "other", 7, true))
        assertNull(nativeLocalViewerReturnIndex(anchor, rows, false, null, 7, true))
        assertNull(nativeLocalViewerReturnIndex(anchor, rows, true, "camera", 8, true))
        assertNull(nativeLocalViewerReturnIndex(anchor, rows, true, null, 7, true))
    }

    @Test fun reusedNumericIdOrEvictedTileIsNeverFocused() {
        val anchor = NativeLocalViewerReturnAnchor(photo, false, null, 5)
        val reused = photo.copy(isVideo = true, addedAtSeconds = 2001)
        assertNull(nativeLocalViewerReturnIndex(anchor, listOf(reused), false, null, 5, true))
        assertNull(nativeLocalViewerReturnIndex(anchor, listOf(video), false, null, 5, true))
        assertEquals(0, nativeLocalViewerReturnIndex(anchor, rows, false, null, 5, true))
    }

    @Test fun refusesUnboundedWallAsMalformedReturnContext() {
        val anchor = NativeLocalViewerReturnAnchor(photo, false, null, 2)
        val oversized = List(NativeLocalMediaStore.MAX_WALL_ITEMS + 1) { photo }
        assertNull(nativeLocalViewerReturnIndex(anchor, oversized, false, null, 2, true))
        assertNull(nativeLocalViewerReturnIndex(null, rows, false, null, 2, true))
    }
}
