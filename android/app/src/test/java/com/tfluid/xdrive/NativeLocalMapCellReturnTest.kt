package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Never restore the focus of a different page, Owner or recycled MediaStore ID. */
class NativeLocalMapCellReturnTest {
    private fun photo(id: Long, added: Long, album: String = "camera") =
        NativeLocalViewerItemKey(id, false, album, added)

    @Test fun sameAuthorizedCellPageReturnsToLastViewedItemNotInitialTap() {
        val rows = listOf(photo(101, 150), photo(102, 149), photo(103, 148))
        assertEquals(0, nativeLocalMapCellReturnIndex(rows[0], rows))
        assertEquals(2, nativeLocalMapCellReturnIndex(rows[2], rows))
    }

    @Test fun numericIdWithDifferentDateOrAlbumNeverReceivesFocus() {
        val rows = listOf(photo(101, 150), photo(102, 149))
        assertNull(nativeLocalMapCellReturnIndex(photo(101, 999), rows))
        assertNull(nativeLocalMapCellReturnIndex(photo(101, 150, "other"), rows))
        assertNull(nativeLocalMapCellReturnIndex(null, rows))
        assertNull(nativeLocalMapCellReturnIndex(photo(101, 150), emptyList()))
    }

    @Test fun cellReaderCannotPublishMoreThanFortyEightViewerTargets() {
        val rows = List(NativeLocalMapIndex.MAX_PREVIEW_ITEMS) { i ->
            photo(i.toLong() + 1L, 100L - i)
        }
        assertEquals(47, nativeLocalMapCellReturnIndex(rows.last(), rows))
        assertNull(nativeLocalMapCellReturnIndex(
            rows.last(), rows + photo(100, 1)))
    }

    @Test fun changedMediaKindIsNotAnIdenticalReturnTarget() {
        val still = photo(5, 100)
        val video = still.copy(isVideo = true)
        assertNull(nativeLocalMapCellReturnIndex(still, listOf(video)))
    }
}
