package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeLocalViewerSwipeTest {
    @Test fun unzoomedOneFingerLeftAndRightDragMapToBoundedNeighbors() {
        assertEquals(1, nativeLocalViewerSwipeDirection(-128f, 64f, false))
        assertEquals(-1, nativeLocalViewerSwipeDirection(128f, 64f, false))
        assertEquals(1, nativeLocalViewerSwipeDirection(-64f, 64f, false))
    }

    @Test fun aTapMinorDragOrMagnifiedPanNeverNavigates() {
        assertNull(nativeLocalViewerSwipeDirection(0f, 64f, false))
        assertNull(nativeLocalViewerSwipeDirection(-63f, 64f, false))
        assertNull(nativeLocalViewerSwipeDirection(300f, 64f, true))
        assertNull(nativeLocalViewerSwipeDirection(Float.NaN, 64f, false))
        assertNull(nativeLocalViewerSwipeDirection(Float.POSITIVE_INFINITY, 64f, false))
        assertNull(nativeLocalViewerSwipeDirection(-300f, Float.NaN, false))
        assertNull(nativeLocalViewerSwipeDirection(-300f, 0f, false))
    }

    @Test fun navigationStillHonorsTheExistingLoadedPhotoIdentityAndEdges() {
        val first = NativeLocalViewerItemKey(30L, false, "camera", 3000)
        val second = NativeLocalViewerItemKey(29L, true, "camera", 2900)
        val page = listOf(first, second)
        assertEquals(1, nativeLocalViewerNeighborIndex(
            page, first, nativeLocalViewerSwipeDirection(-130f, 64f, false)!!))
        assertNull(nativeLocalViewerNeighborIndex(
            page, second, nativeLocalViewerSwipeDirection(-130f, 64f, false)!!))
        assertNull(nativeLocalViewerNeighborIndex(
            page, first.copy(addedAtSeconds = 9999), 1))
    }
}
