package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class GalleryViewerFilmstripPolicyTest {
    @Test fun windowIsBoundedAndKeepsActiveTile() {
        assertTrue(galleryViewerFilmstripWindow(0, 0).isEmpty())
        assertTrue(galleryViewerFilmstripWindow(1, 0).isEmpty())
        assertTrue(galleryViewerFilmstripWindow(100000, -1).isEmpty())
        assertTrue(galleryViewerFilmstripWindow(100000, 100000).isEmpty())
        assertEquals(0..8, galleryViewerFilmstripWindow(100000, 0))
        assertEquals(46..54, galleryViewerFilmstripWindow(100000, 50))
        assertEquals(99991..99999, galleryViewerFilmstripWindow(100000, 99999))
        assertEquals(0..3, galleryViewerFilmstripWindow(4, 2))
        for (index in listOf(0, 1, 8, 9, 50, 99999)) {
            val range = galleryViewerFilmstripWindow(100000, index)
            assertTrue(index in range)
            assertTrue(range.count() <= GALLERY_VIEWER_FILMSTRIP_MAX_TILES)
        }
    }

    @Test fun currentOwnerSessionAndExactLoadedObjectsAreMandatory() {
        data class Row(val id: Long, val revision: Long)
        val a = Row(10L, 1L)
        val b = Row(20L, 1L)
        val c = Row(30L, 1L)
        val entries = listOf(a, b, c)
        assertTrue(galleryViewerFilmstripSelectionAllowed(b, b, a, entries, true))
        assertTrue(galleryViewerFilmstripSelectionAllowed(b, b, c, entries, true))
        assertFalse(galleryViewerFilmstripSelectionAllowed(b, b, b, entries, true))
        assertFalse(galleryViewerFilmstripSelectionAllowed(b, b, a, entries, false))
        assertFalse(galleryViewerFilmstripSelectionAllowed(null, b, a, entries, true))
        // A-B-A session replacement with equal Node IDs cannot replay callbacks.
        assertFalse(galleryViewerFilmstripSelectionAllowed(
            Row(20L, 1L), b, a, entries, true))
        assertFalse(galleryViewerFilmstripSelectionAllowed(
            b, b, Row(10L, 1L), entries, true))
        assertFalse(galleryViewerFilmstripSelectionAllowed(
            b, b, a, listOf(Row(10L, 1L), Row(20L, 1L)), true))
    }
}
