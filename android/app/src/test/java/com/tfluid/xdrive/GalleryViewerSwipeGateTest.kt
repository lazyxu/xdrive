package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GalleryViewerSwipeGateTest {
    private fun gesture(
        fence: GalleryLiveHoldSwipeFence,
        dx: Float = -100f,
        dy: Float = 8f,
        duration: Long = 180L,
        threshold: Float = 72f,
        single: Boolean = true,
        zoom1x: Boolean = true,
    ): Boolean = fence.mayShift(dx, dy, duration, threshold, single, zoom1x)

    @Test fun ordinaryHorizontalSwipeWorksBothDirectionsAtOneX() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertTrue(gesture(fence))
        fence.beginGesture()
        assertTrue(gesture(fence, dx = 110f))
        assertTrue(gesture(fence, dx = 72f, dy = 0f))
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

    @Test fun aDragFollowsTheFingerAndOnlyResistsUnavailableEdges() {
        assertTrue(galleryPhotoFingerDrag(-120f, 2f, 390f, true, true,
            true, true) == -120f)
        assertTrue(galleryPhotoFingerDrag(120f, 2f, 390f, true, true,
            true, true) == 120f)
        assertTrue(kotlin.math.abs(galleryPhotoFingerDrag(-120f, 2f, 390f, true, true,
            true, false) + 21.6f) < 0.01f)
        assertTrue(kotlin.math.abs(galleryPhotoFingerDrag(120f, 2f, 390f, true, true,
            false, true) - 21.6f) < 0.01f)
        assertTrue(galleryPhotoFingerDrag(-800f, 1f, 390f, true, true,
            true, true) == -390f)
        assertTrue(galleryPhotoFingerDrag(-10f, 180f, 390f, true, true,
            true, true) == 0f)
        assertTrue(galleryPhotoFingerDrag(100f, 0f, 390f, false, true,
            true, true) == 0f)
        assertTrue(galleryPhotoFingerDrag(100f, 0f, 390f, true, false,
            true, true) == 0f)
        assertTrue(galleryPhotoFingerDrag(Float.NaN, 0f, 390f, true, true,
            true, true) == 0f)
    }

    @Test fun aLongHeldLivePhotoCannotPreviewASecondPage() {
        val fence = GalleryLiveHoldSwipeFence()
        fence.beginGesture()
        assertTrue(fence.mayPreviewFingerDrag())
        fence.liveHoldActivated()
        assertFalse(fence.mayPreviewFingerDrag())
        fence.beginGesture()
        assertTrue(fence.mayPreviewFingerDrag())
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
