package com.tfluid.xdrive

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Actual production PDF touch policy without a fake Owner network reader. */
class NativePdfTouchGesturesTest {
    @Test fun twoFingerScaleIsBoundedToOneThroughFour() {
        val viewport = IntSize(200, 160)
        assertEquals(2f, nativePdfTouchResult(
            1f, Offset.Zero, 2f, Offset.Zero, viewport).zoom, 0f)
        assertEquals(4f, nativePdfTouchResult(
            3f, Offset.Zero, 5f, Offset.Zero, viewport).zoom, 0f)
        val returned = nativePdfTouchResult(
            2f, Offset(20f, 10f), 0.01f, Offset(50f, 50f), viewport)
        assertEquals(1f, returned.zoom, 0f)
        assertEquals(Offset.Zero, returned.pan)
    }

    @Test fun magnifiedPanIsClampedToCurrentViewport() {
        val result = nativePdfTouchResult(
            2f, Offset.Zero, 1f, Offset(1000f, -1000f), IntSize(200, 160))
        assertEquals(2f, result.zoom, 0f)
        assertEquals(Offset(100f, -80f), result.pan)
        val smaller = nativePdfTouchResult(
            2f, Offset(100f, -80f), 1f, Offset(-65f, 20f), IntSize(200, 160))
        assertEquals(Offset(35f, -60f), smaller.pan)
    }

    @Test fun invalidGestureValuesNeverProduceNanOrInvisiblePan() {
        val result = nativePdfTouchResult(
            Float.NaN, Offset(Float.NaN, Float.POSITIVE_INFINITY),
            Float.NaN, Offset(Float.NaN, 42f), IntSize(-1, -1))
        assertTrue(result.zoom.isFinite())
        assertTrue(result.pan.x.isFinite() && result.pan.y.isFinite())
        assertEquals(1f, result.zoom, 0f)
        assertEquals(Offset.Zero, result.pan)
    }
}
