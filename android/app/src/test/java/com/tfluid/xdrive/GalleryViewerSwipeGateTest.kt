package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GalleryViewerSwipeGateTest {
    @Test fun visibleDragTracksFingerOnlyForHorizontalUnzoomedNavigation() {
        assertEquals(-110f, galleryPhotoDragTranslation(-110f, 8f, 360f, true), 0.01f)
        assertEquals(82f, galleryPhotoDragTranslation(200f, 0f, 82f, true), 0.01f)
        assertEquals(-12f, galleryPhotoDragTranslation(-100f, 0f, 360f, false), 0.01f)
        assertEquals(0f, galleryPhotoDragTranslation(-20f, 60f, 360f, true), 0.01f)
        assertEquals(0f, galleryPhotoDragTranslation(-4f, 0f, 360f, true), 0.01f)
        assertEquals(0f, galleryPhotoDragTranslation(Float.NaN, 0f, 360f, true), 0.01f)
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertTrue(fence.canFollowSwipe())
        fence.liveHoldActivated()
        assertFalse(fence.canFollowSwipe())
        fence.beginGesture()
        assertTrue(fence.canFollowSwipe())
    }

    private fun gesture(
        fence: GalleryLiveHoldSwipeFence,
        dx: Float = -100f,
        dy: Float = 8f,
        duration: Long = 180L,
        threshold: Float = 72f,
        single: Boolean = true,
        zoom1x: Boolean = true,
        deliberate: Float = Float.POSITIVE_INFINITY,
    ): Boolean = fence.mayShift(dx, dy, duration, threshold, single, zoom1x, deliberate)

    @Test fun ordinaryHorizontalSwipeWorksBothDirectionsAtOneX() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertTrue(gesture(fence))
        fence.beginGesture()
        assertTrue(gesture(fence, dx = 110f))
        assertTrue(gesture(fence, dx = 72f, dy = 0f))
    }

    @Test fun slowDeliberateLongDragMayPageButDiagonalAndLiveHoldCannot() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertTrue(gesture(fence, dx = -180f, dy = 12f,
            duration = 1800L, deliberate = 110f))
        assertFalse(gesture(fence, dx = -90f, dy = 8f,
            duration = 1800L, deliberate = 110f))
        assertFalse(gesture(fence, dx = -180f, dy = 190f,
            duration = 1800L, deliberate = 110f))
        fence.liveHoldActivated()
        assertFalse(gesture(fence, dx = -180f, duration = 1800L, deliberate = 110f))
    }

    @Test fun liveLongPressThenDragCannotTriggerPageTurnOnRelease() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        fence.liveHoldActivated()
        // The Live hold observer can already have signaled false when this
        // dragged finger crosses touch slop. The latch must still suppress UP.
        assertFalse(gesture(fence, dx = -140f, duration = 720L))
        assertFalse(gesture(fence, dx = 200f, duration = 799L))
        fence.beginGesture()
        assertTrue(gesture(fence, dx = -140f)) // a *new* swipe still works
    }

    @Test fun pinchZoomVerticalHoldAndSlowSwipeNeverTurnPage() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertFalse(gesture(fence, single = false))
        assertFalse(gesture(fence, zoom1x = false))
        assertFalse(gesture(fence, dx = 35f))
        assertFalse(gesture(fence, dx = 80f, dy = 90f))
        assertFalse(gesture(fence, duration = 801L))
        assertFalse(gesture(fence, duration = -1L))
    }

    @Test fun malformedCoordinatesAndThresholdFailClosed() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertFalse(gesture(fence, dx = Float.NaN))
        assertFalse(gesture(fence, dy = Float.POSITIVE_INFINITY))
        assertFalse(gesture(fence, threshold = Float.NaN))
        assertFalse(gesture(fence, threshold = 0f))
        assertFalse(gesture(fence, threshold = -1f))
        assertFalse(gesture(fence, dx = 0f))
    }

    @Test fun differentViewerItemUsesFreshFenceWithoutStickyHold() {
        val previousPhoto = GalleryLiveHoldSwipeFence()
        previousPhoto.beginGesture()
        previousPhoto.liveHoldActivated()
        assertFalse(gesture(previousPhoto))

        val newPhoto = GalleryLiveHoldSwipeFence()
        newPhoto.beginGesture()
        assertTrue(gesture(newPhoto))
    }
}
