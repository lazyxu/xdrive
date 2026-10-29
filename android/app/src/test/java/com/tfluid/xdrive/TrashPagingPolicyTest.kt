package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Pure range policy; no synthetic HTTP success or unbounded prefetch queue. */
class TrashPagingPolicyTest {
    private fun prefetch(
        loaded: Boolean = true, loading: Boolean = false, error: Boolean = false,
        items: Int = 100, total: Long = 240L, last: Int = 98,
        scrolling: Boolean = true, armed: Boolean = true,
    ) = shouldPrefetchTrashPage(
        loaded, loading, error, items, total, last, scrolling, armed,
    )

    @Test fun firstVisibleLayoutAndRecompositionNeverAutoPageWithoutScroll() {
        assertFalse(prefetch(scrolling = false))
        assertFalse(prefetch(last = -1))
        assertFalse(prefetch(last = 20))
        assertFalse(prefetch(armed = false))
        assertFalse(prefetch(loading = true))
        assertFalse(prefetch(error = true))
        assertFalse(prefetch(loaded = false))
    }

    @Test fun oneRealScrolledEdgeCanFetchOnlyOnePageUntilUserLeaves() {
        assertTrue(prefetch())
        assertFalse(prefetch(armed = false))
        assertFalse(trashEdgeLeft(100, 98))
        assertTrue(trashEdgeLeft(100, 42))
        assertTrue(prefetch(items = 200, total = 240L, last = 199))
        // Merely appending another page is not a user scroll.
        assertFalse(prefetch(items = 200, total = 240L, last = 199,
            scrolling = false))
    }

    @Test fun verifiedEndAndOverflowNeverStartAnotherTrashRead() {
        assertFalse(prefetch(items = 100, total = 100L))
        assertFalse(prefetch(items = 100, total = 99L))
        assertFalse(prefetch(items = 0, total = 100L, last = 0))
        assertFalse(prefetch(items = 100, total = 0L))
        assertFalse(prefetch(items = 100, total = -1L))
        assertFalse(trashHasNextPage(Int.MAX_VALUE, Long.MAX_VALUE))
        assertFalse(prefetch(items = Int.MAX_VALUE, total = Long.MAX_VALUE))
    }

    @Test fun shortTrashHistoryUsesManualLoadButtonInsteadOfLayoutPrefetch() {
        assertTrue(trashHasNextPage(2, 240L))
        assertFalse(prefetch(items = 2, total = 240L, last = 2,
            scrolling = false))
        assertTrue(prefetch(items = 2, total = 240L, last = 2))
        assertFalse(trashEdgeLeft(2, 0))
    }
}
