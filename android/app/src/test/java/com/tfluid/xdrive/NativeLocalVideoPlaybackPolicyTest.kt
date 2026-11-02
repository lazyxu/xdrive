package com.tfluid.xdrive

import androidx.lifecycle.Lifecycle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Local MediaStore Viewer contracts; no physical photo, cloud token or codec
 * is required for these bounded navigation/foreground policy checks. */
class NativeLocalVideoPlaybackPolicyTest {
    private val item = NativeLocalViewerItemKey(41L, true, "camera", 987L)

    @Test fun sameMediaStoreIdWithDifferentUriRequiresNewPlayerAndMotionIntent() {
        val old = NativeLocalVideoSourceKey(
            item, "content://media/external/video/media/41")
        val replacement = NativeLocalVideoSourceKey(
            item, "content://media/external_primary/video/media/41")
        assertFalse(old == replacement)
        assertEquals(old, old.copy())
        assertFalse(old == old.copy(item = item.copy(addedAtSeconds = 988L)))
    }

    @Test fun localMotionNeverAutoplaysOnLateSourceAfterBackground() {
        assertFalse(nativeLocalVideoMayAutoPlay(true, Lifecycle.State.CREATED))
        assertFalse(nativeLocalVideoMayAutoPlay(true, Lifecycle.State.INITIALIZED))
        assertFalse(nativeLocalVideoMayAutoPlay(true, Lifecycle.State.DESTROYED))
        assertTrue(nativeLocalVideoMayAutoPlay(true, Lifecycle.State.STARTED))
        assertTrue(nativeLocalVideoMayAutoPlay(true, Lifecycle.State.RESUMED))
        // An ordinary video always requires a deliberate play action.
        assertFalse(nativeLocalVideoMayAutoPlay(false, Lifecycle.State.RESUMED))
    }

    private fun swipe(
        dx: Float, dy: Float = 0f, elapsed: Long = 300L,
        y: Float = 150f, height: Float = 300f, single: Boolean = true,
        previous: Boolean = true, next: Boolean = true,
    ) = nativeLocalVideoSwipeDirection(
        deltaX = dx, deltaY = dy, elapsedMillis = elapsed,
        startY = y, surfaceHeight = height,
        headerPx = 52f, thresholdPx = 72f,
        singlePointer = single,
        previousAvailable = previous, nextAvailable = next,
    )

    @Test fun onlyQuickHorizontalOneFingerSwipesInsideVideoContentNavigate() {
        assertEquals(1, swipe(-180f))
        assertEquals(-1, swipe(180f))
        assertEquals(1, swipe(-72f))
        assertNull(swipe(0f))
        assertNull(swipe(-71f))
        assertNull(swipe(-180f, dy = 160f))
        assertNull(swipe(-180f, elapsed = 801L))
        assertNull(swipe(-180f, elapsed = -1L))
        assertNull(swipe(-180f, single = false))
    }

    @Test fun seekingHeaderAndUnavailableNeighborsNeverAdvance() {
        assertNull(swipe(-180f, y = 0f))
        assertNull(swipe(-180f, y = 51f))
        assertNull(swipe(-180f, y = 235f)) // bottom 22% contains Media3 seek
        assertNull(swipe(180f, y = 301f))
        assertNull(swipe(-180f, next = false))
        assertNull(swipe(180f, previous = false))
        assertNull(swipe(-180f, height = 0f))
    }

    @Test fun malformedPointerCoordinatesCannotNavigate() {
        assertNull(swipe(Float.NaN))
        assertNull(swipe(Float.POSITIVE_INFINITY))
        assertNull(swipe(-200f, dy = Float.NaN))
        assertNull(swipe(-200f, y = Float.NaN))
        assertNull(swipe(-200f, height = Float.POSITIVE_INFINITY))
    }
}
