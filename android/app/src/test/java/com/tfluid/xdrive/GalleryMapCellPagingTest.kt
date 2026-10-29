package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Pure paging policy tests: no Server calls, tokens or fake map coordinates. */
class GalleryMapCellPagingTest {
    private fun prefetch(
        loaded: Boolean = true, loading: Boolean = false, error: Boolean = false,
        offset: Int = 0, count: Int = 60, total: Long = 125L, last: Int = 58,
        scrolled: Boolean = true, armed: Boolean = true,
    ) = shouldPrefetchMapCellPage(loaded, loading, error,
        offset, count, total, last, scrolled, armed)

    @Test fun nativeMapCellUsesTheSameResponsiveGalleryColumnRule() {
        assertEquals(3, galleryVisibleColumns(390f, 3))
        assertEquals(5, galleryVisibleColumns(768f, 3))
        assertEquals(10, galleryVisibleColumns(2000f, 3).coerceAtMost(10))
    }

    @Test fun initialLayoutAndAutomaticRecompositionDoNotFetchHundredThousandRows() {
        assertFalse(prefetch(scrolled = false))
        assertFalse(prefetch(armed = false))
        assertFalse(prefetch(last = -1))
        assertFalse(prefetch(last = 25))
        assertFalse(prefetch(loaded = false))
        assertFalse(prefetch(loading = true))
        assertFalse(prefetch(error = true))
    }

    @Test fun genuineScrollToCurrentEndGrantsOneAuthenticatedNextPage() {
        assertTrue(prefetch())
        // A consumed edge permit must stay consumed until the grid moves away.
        assertFalse(prefetch(armed = false))
        assertFalse(mapCellEdgeWasLeft(60, 58))
        assertTrue(mapCellEdgeWasLeft(60, 30))
        // The next page retains the original signed cell and its bounded offset.
        assertTrue(prefetch(offset = 0, count = 120, total = 180L, last = 118))
    }

    @Test fun exactLastPageAndOverflowOrInvalidCountsAreNeverPrefetched() {
        assertFalse(prefetch(count = 60, total = 60))
        assertFalse(prefetch(offset = 60, count = 40, total = 100))
        assertFalse(prefetch(offset = -1))
        assertFalse(prefetch(count = 0))
        assertFalse(prefetch(total = -1))
        assertFalse(prefetch(offset = Int.MAX_VALUE, count = 60,
            total = Long.MAX_VALUE))
        // A signed response may say no more rows; never invent a global page.
        assertFalse(prefetch(offset = 0, count = 60, total = 59))
    }

    @Test fun shortCellNeedsUserScrollOrManualLoadMore() {
        assertFalse(prefetch(count = 2, total = 20, last = 2, scrolled = false))
        assertTrue(prefetch(count = 2, total = 20, last = 2, scrolled = true))
        assertFalse(mapCellEdgeWasLeft(2, 0))
    }

    @Test fun previouslyScrolledButIdleGridNeverLoadsNextOwnerPage() {
        // Previous code retained a sticky "userScrolled=true" after the
        // fling ended. An async image/layout update could then trigger GET.
        assertFalse(prefetch(count = 60, total = 180L, last = 59,
            scrolled = false, armed = true))
        assertFalse(prefetch(count = 120, total = 180L, last = 118,
            scrolled = false, armed = true))
        // A real active movement at the current edge still loads one page.
        assertTrue(prefetch(count = 120, total = 180L, last = 118,
            scrolled = true, armed = true))
    }

    @Test fun layoutReflowAloneCannotRearmConsumedEdge() {
        assertFalse(mapCellCanRearm(120, 33, activelyScrolling = false))
        assertFalse(mapCellCanRearm(120, -1, activelyScrolling = false))
        assertFalse(mapCellCanRearm(120, 118, activelyScrolling = true))
        assertTrue(mapCellCanRearm(120, 33, activelyScrolling = true))
        // Initial short list cannot invent a meaningful "left the edge".
        assertFalse(mapCellCanRearm(2, 0, activelyScrolling = true))
    }
}
