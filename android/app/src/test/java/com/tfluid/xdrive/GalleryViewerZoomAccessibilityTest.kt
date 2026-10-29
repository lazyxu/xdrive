package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class GalleryViewerZoomAccessibilityTest {
    @Test fun boundsAndDescriptionsMatchNativePinchRange() {
        assertEquals(1.5f, galleryAccessibleZoomStep(1f, 1), 0f)
        assertEquals(2f, galleryAccessibleZoomStep(1.5f, 1), 0f)
        assertEquals(1f, galleryAccessibleZoomStep(1f, -1), 0f)
        assertEquals(5f, galleryAccessibleZoomStep(4.9f, 1), 0f)
        assertEquals(4.5f, galleryAccessibleZoomStep(5f, -1), 0f)
        assertEquals(5f, galleryAccessibleZoomStep(99f, 1), 0f)
        assertEquals(1f, galleryAccessibleZoomStep(Float.NaN, -1), 0f)
        assertEquals(1.5f, galleryAccessibleZoomStep(Float.POSITIVE_INFINITY, 1), 0f)
        assertEquals("图片缩放 100%", galleryAccessibleZoomLabel(1f))
        assertEquals("图片缩放 150%", galleryAccessibleZoomLabel(1.5f))
        assertEquals("图片缩放 500%", galleryAccessibleZoomLabel(99f))
        assertEquals("图片缩放 100%", galleryAccessibleZoomLabel(Float.NaN))
    }

    @Test fun repeatedA11yZoomNeverEscapesOneToFive() {
        var zoom = 1f
        repeat(20) { zoom = galleryAccessibleZoomStep(zoom, 1) }
        assertEquals(5f, zoom, 0f)
        repeat(30) { zoom = galleryAccessibleZoomStep(zoom, -1) }
        assertEquals(1f, zoom, 0f)
    }

    @Test fun unsupportedDirectionCannotMutateViewer() {
        for (d in listOf(-2, 0, 2)) try {
            galleryAccessibleZoomStep(2f, d)
            fail("Unsupported TalkBack direction accepted")
        } catch (_: IllegalArgumentException) { }
    }
}
