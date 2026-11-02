package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Exact one-page, gesture-triggered local Viewer continuation. These pure
 * policy tests do not fabricate MediaStore permissions or provider results. */
class NativeLocalViewerNextPageTest {
    private val keys = listOf(
        NativeLocalViewerItemKey(3L, false, "camera", 300L),
        NativeLocalViewerItemKey(2L, true, "camera", 200L),
        NativeLocalViewerItemKey(1L, false, "camera", 100L),
    )
    private val source = NativeLocalVideoSourceKey(
        keys.last(), "content://media/external/images/media/1")
    private val request = NativeLocalViewerNextPageIntent(
        source = source,
        sessionId = 17L,
        generation = 3,
        wallRevision = 9,
        albumsOnly = true,
        albumId = "camera",
        mediaKind = "",
        cursor = NativeLocalPageKey(100L, 1L),
        requestId = 4,
    )

    private fun canRequest(
        index: Int?,
        count: Int,
        exhausted: Boolean = false,
        cursor: Boolean = true,
        busy: Boolean = false,
        error: Boolean = false,
        pending: Boolean = false,
        readable: Boolean = true,
    ) = nativeLocalViewerCanRequestNextPage(
        loadedIndex = index,
        loadedCount = count,
        exhausted = exhausted,
        hasCursor = cursor,
        busy = busy,
        hasError = error,
        pending = pending,
        readable = readable,
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
        request = intent,
        activeSource = current,
        loaded = items,
        sessionId = sessionId,
        generation = generation,
        wallRevision = wallRevision,
        albumsOnly = albumsOnly,
        albumId = albumId,
        mediaKind = mediaKind,
        readable = readable,
        pageIntent = pageIntent,
        consumedPageIntent = consumed,
        busy = busy,
        hasError = error,
    )

    @Test fun onlyLastLoadedItemMayRequestOneBoundedNextPage() {
        assertTrue(canRequest(index = 2, count = 3))
        assertFalse(canRequest(index = null, count = 3))
        assertFalse(canRequest(index = 0, count = 3))
        assertFalse(canRequest(index = 1, count = 3))
        assertFalse(canRequest(index = 2, count = 3, exhausted = true))
        assertFalse(canRequest(index = 2, count = 3, cursor = false))
        assertFalse(canRequest(index = 2, count = 3, busy = true))
        assertFalse(canRequest(index = 2, count = 3, error = true))
        assertFalse(canRequest(index = 2, count = 3, pending = true))
        assertFalse(canRequest(index = 2, count = 3, readable = false))
        assertFalse(canRequest(index = 512, count = 513))
    }

    @Test fun aRequestWaitsForItsOwnPageAndNeverSkipsOnFailure() {
        assertEquals(NativeLocalNextPageDecision.WAITING, decide(consumed = 3))
        assertEquals(NativeLocalNextPageDecision.WAITING, decide(busy = true))
        assertEquals(NativeLocalNextPageDecision.END, decide())
        assertEquals(NativeLocalNextPageDecision.FAILED, decide(error = true))
    }

    @Test fun completedKeysetPageAdvancesOnlyToVerifiedNewNeighbor() {
        val appended = keys + NativeLocalViewerItemKey(4L, false, "camera", 99L)
        assertEquals(NativeLocalNextPageDecision.ADVANCE, decide(items = appended))
        // Bounded wall eviction may drop the oldest rows, but the current
        // exact item remains loaded and the next verified item follows it.
        val bounded = listOf(
            NativeLocalViewerItemKey(2L, true, "camera", 200L),
            NativeLocalViewerItemKey(1L, false, "camera", 100L),
            NativeLocalViewerItemKey(4L, false, "camera", 99L),
        )
        assertEquals(NativeLocalNextPageDecision.ADVANCE, decide(items = bounded))
    }

    @Test fun permissionOwnerAlbumFilterAndCursorChangesRejectStaleRequests() {
        assertEquals(NativeLocalNextPageDecision.STALE, decide(readable = false))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(sessionId = 18L))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(generation = 4))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(wallRevision = 10))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(albumsOnly = false))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(albumId = "other"))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(mediaKind = "video"))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(pageIntent = 5))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(
            current = source.copy(uri = "content://media/external_primary/images/media/1")))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(items = keys.dropLast(1)))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(
            intent = request.copy(requestId = 0)))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(
            intent = request.copy(cursor = NativeLocalPageKey(100L, 0L))))
        assertEquals(NativeLocalNextPageDecision.STALE, decide(
            intent = request.copy(cursor = NativeLocalPageKey(99L, 1L))))
    }
}
