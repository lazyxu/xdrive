package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativePdfZoomAccessibilityTest {
    @Test fun realPdfRangeStepsHalfAnXFromOneToFour() {
        assertEquals(1.5f, nativePdfAccessibleZoomStep(1f, 1), 0f)
        assertEquals(2f, nativePdfAccessibleZoomStep(1.5f, 1), 0f)
        assertEquals(1f, nativePdfAccessibleZoomStep(1f, -1), 0f)
        assertEquals(4f, nativePdfAccessibleZoomStep(3.9f, 1), 0f)
        assertEquals(3.5f, nativePdfAccessibleZoomStep(4f, -1), 0f)
        assertEquals(4f, nativePdfAccessibleZoomStep(100f, 1), 0f)
    }

    @Test fun malformedScaleCannotLeakNaNOrInfinityToCompose() {
        assertEquals(1.5f, nativePdfAccessibleZoomStep(Float.NaN, 1), 0f)
        assertEquals(1f, nativePdfAccessibleZoomStep(Float.NEGATIVE_INFINITY, -1), 0f)
        assertEquals(1.5f, nativePdfAccessibleZoomStep(Float.POSITIVE_INFINITY, 1), 0f)
        assertEquals("PDF 第 1 / 2 页，缩放 100%",
            nativePdfAccessibleZoomDescription(0, 2, Float.NaN))
    }

    @Test fun currentPageAndZoomAlwaysAnnounceRealIdentity() {
        assertEquals("PDF 第 1 / 9 页，缩放 100%",
            nativePdfAccessibleZoomDescription(0, 9, 1f))
        assertEquals("PDF 第 3 / 9 页，缩放 250%",
            nativePdfAccessibleZoomDescription(2, 9, 2.5f))
        assertEquals("PDF 第 9 / 9 页，缩放 400%",
            nativePdfAccessibleZoomDescription(100, 9, 4f))
        assertEquals("PDF 第 1 / 1 页，缩放 100%",
            nativePdfAccessibleZoomDescription(-100, 0, 0f))
    }

    @Test fun onlySupportedZoomDirectionsAndBoundaries() {
        var value = 1f
        repeat(25) { value = nativePdfAccessibleZoomStep(value, 1) }
        assertEquals(4f, value, 0f)
        repeat(25) { value = nativePdfAccessibleZoomStep(value, -1) }
        assertEquals(1f, value, 0f)
        for (invalid in listOf(0, 2, -2)) {
            try {
                nativePdfAccessibleZoomStep(2f, invalid)
                fail("Unsupported zoom direction accepted")
            } catch (_: IllegalArgumentException) { }
        }
    }
}
