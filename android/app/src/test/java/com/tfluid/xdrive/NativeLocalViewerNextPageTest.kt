package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exact one-page, gesture-triggered local Viewer continuation; no MediaStore
 * access or permissions are fabricated by these pure policy tests. */
class NativeLocalViewerNextPageTest {
    private val keys = listOf(
        NativeLocalViewerItemKey(3L, false, "camera", 300L),
        NativeLocalViewerItemKey(2L, true, "camera", 200L),
        NativeLocalViewerItemKey(1L, false, "camera", 100L),
    )
    private val source = NativeLocalVideoSourceKey(
        keys.last(), "content://media/external/images/media/1")
    private val request = NativeLocalViewerNextPageIntent(
        source = source, sessionId = 17L, generation = 3,
        wallRevision = 9, albumsOnly = true, albumId = "camera",
        mediaKind = "", cursor = NativeLocalPageKey(100L, 1L), requestId = 4,
    )

    private fun decide(
        intent: NativeLocalViewerNextPageIntent = request,
        current: NativeLocalVideoSourceKey? = source,
        items: List<NativeLocalViewerItemKey> = keys,
        sessionId: Long = 17L,
        generation: Int = 3,
        wallRevision: Int = 9,
        albumsOnly: Boolean = true,
        albumId: String? = "camera",
        mediaKind: String = "",
        readable: Boolean = true,
        pageIntent: Int = 4,
        consumed: Int = 4,
        busy: Boolean = false,
        error: Boolean = false,
    ) = nativeLocalViewerNextPageDecision(
        request = intent, activeSource = current, loaded = items,
        sessionId = sessionId, generation = generation, wallRevision = wallRevision,
        albumsOnly = albumsOnly, albumId = albumId, mediaKind = mediaKind,
        readable = readable, pageIntent = pageIntent, consumedPageIntent = consumed,
        busy = busy, hasError = error,
    )

    @Test fun onlyLastVerifiedLoadedMediaMayRequestExactlyOneNewPage() {
        assertTrue(nativeLocalViewerCanRequestNextPage(
            loadedIndex = 2, loadedCount = 3, exhausted = false,
            hasCursor = true, busy = false, hasError = false,
            pending = false, readable = true))
        for (index in listOf<Int?>(null, 0, 1)) {
            assertFalse(nativeLocalViewerCanRequestNextPage(
                index, 3, false, true, false, false, false, true))
        }
        assertFalse(nativeLocalViewerCanRequestNextPage(
            2, 3, exhausted = true, true, false, false, false, true))
        assertFalse(nativeLocalViewerCanRequestNextPage(
            2, 3, false, hasCursor = false, false, false, false, true))
        assertFalse(nativeLocalViewerCanRequestNextPage(
            2, 3, false, true, busy = true, false, false, true))
        assertFalse(nativeLocalViewerCanRequestNextPage(
            2, 3, false, true, false, hasError = true, false, true))
        assertFalse(nativeLocalViewerCanRequestNextPage(
            2, 3, false, true, false, false, pending = true, true))
        assertFalse(nativeLocalViewerCanRequestNextPage(
            2, 3, false, true, false, false, false, readable = false))
        assertFalse(nativeLocalViewerCanRequestNextPage(
            512, 513, false, true, false, false, false, true))
    }

    @Test fun aRequestStaysPendingUntilItsExactPageCompletes() {
        assertEquals(NativeLocalNextPageDecision.WAITING, decide(consumed = 3))
        assertEquals(NativeLocalNextPageDecision.WAITING, decide(busy = true))
        assertEquals(NativeLocalNextPageDecision.END, decide())
        assertEquals(NativeLocalNextPageDecision.FAILED, decide(error = true))
    }

    @Test fun completedKeysetPageAdvancesToVerifiedNextRowAfterBoundedAppend() {
        val after = keys + NativeLocalViewerItemKey(0L + 4, false, "camera", 99L)
        assertEquals(NativeLocalNextPageDecision.ADVANCE, decide(items = after))
        // The oldest 64 rows may be evicted to enforce the 512-tile memory
        // bound; the active last-item key must still be in the new wall.
        val tail = keys.drop(1) + NativeLocalViewerItemKey(4L, false, "camera", 99L)
        assertEquals(NativeLocalNextPageDecision.ADVANCE, decide(items = tail))
    }

    @Test fun sourceOwnerGrantAlbumFilterAndCursorGenerationCannotBeReused() {
        assertEquals(NativeLocalNextPageDecision.STALE, decide(readable = false))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(sessionId = 18L))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(generation = 4))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(wallRevision = 10))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(albumsOnly = false))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(albumId = "other"))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(mediaKind = "video"))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(pageIntent = 5))
        assertEquals(NativeLocalNextPageDecision.STALE,
            decide(current = source.copy(uri = "content://media/another-volume/1")))
        assertEquals(NativeLocalNextPageDecision.STALE,
            decide(items = keys.dropLast(1)))
        assertEquals(NativeLocalNextPageDecision.STALE,
            decide(intent = request.copy(requestId = 0)))
        assertEquals(NativeLocalNextPageDecision.STALE,
            decide(intent = request.copy(cursor = NativeLocalPageKey(100L, 0L))))
        assertEquals(NativeLocalNextPageDecision.STALE,
            decide(intent = request.copy(cursor = NativeLocalPageKey(99L, 1L))))
    }
}
