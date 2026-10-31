package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure SQL-order contract; physical MediaStore permission/provider tests remain separate. */
class NativeLocalMediaStorePagingTest {
    private fun key(time: Long, id: Long) = NativeLocalPageKey(time, id)

    @Test fun validDateAndIdTiesAreStrictlyDescendingAcrossPages() {
        val first = listOf(key(202, 20), key(202, 19), key(201, 999), key(201, 2))
        assertTrue(nativeLocalStrictPageOrder(null, first))
        assertTrue(nativeLocalStrictPageOrder(first.last(),
            listOf(key(201, 1), key(200, 2000), key(200, 1999))))
        assertTrue(nativeLocalStrictPageOrder(first.last(), emptyList()))
    }

    @Test fun providerThatIgnoresKeysetCannotRepeatFirstPageOrScrambleOrder() {
        val prior = key(100, 20)
        assertFalse(nativeLocalStrictPageOrder(prior, listOf(key(100, 20))))
        assertFalse(nativeLocalStrictPageOrder(prior, listOf(key(101, 1))))
        assertFalse(nativeLocalStrictPageOrder(prior, listOf(key(100, 21))))
        assertFalse(nativeLocalStrictPageOrder(prior,
            listOf(key(100, 19), key(100, 19))))
        assertFalse(nativeLocalStrictPageOrder(prior,
            listOf(key(100, 19), key(100, 20))))
        assertFalse(nativeLocalStrictPageOrder(null,
            listOf(key(30, 2), key(31, 1))))
    }

    @Test fun droppedWallHistoryStillUsesLastStableAnchor() {
        // Only 512 tiles are retained, but paging must never use a shifting
        // index: the last visible key still fences the provider's next page.
        val retainedTail = key(5, 10)
        val validOlder = listOf(key(5, 9), key(4, 9000))
        assertTrue(nativeLocalStrictPageOrder(retainedTail, validOlder))
        assertFalse(nativeLocalStrictPageOrder(retainedTail,
            listOf(key(6, 8), key(5, 9))))
        assertFalse(nativeLocalStrictPageOrder(retainedTail,
            listOf(key(5, 10), key(5, 9))))
    }

    @Test fun invalidProviderKeyIsNeverSilentlySkipped() {
        assertFalse(nativeLocalStrictPageOrder(null, listOf(key(-1, 1))))
        assertFalse(nativeLocalStrictPageOrder(null, listOf(key(1, 0))))
        assertFalse(nativeLocalStrictPageOrder(null, listOf(key(1, -1))))
        assertFalse(nativeLocalStrictPageOrder(key(0, 99), listOf(key(0, 100))))
        assertTrue(nativeLocalStrictPageOrder(key(0, 99), listOf(key(0, 98))))
    }
}
