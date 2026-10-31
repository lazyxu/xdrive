package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeCloudViewerReturnTest {
    private val original = NativeCloudViewerKey(40, 3)
    private val anchor = NativeCloudViewerReturnAnchor(
        original, "manual:family", "", "", "captured", "asc", 5)

    private fun find(a: NativeCloudViewerReturnAnchor? = anchor,
        rows: List<NativeCloudViewerKey> = listOf(NativeCloudViewerKey(39, 1), original),
        album: String? = "manual:family", query: String = "",
        kind: String = "", sort: String = "captured",
        dir: String = "asc", epoch: Long = 5) =
        nativeCloudViewerReturnIndex(a, rows, album, query, kind, sort, dir, epoch)

    @Test fun exactAuthorizedSourceIsReturnedAtItsActualPosition() {
        assertEquals(1, find())
    }

    @Test fun rejectsOtherAlbumQueryKindSortDirectionAndTimeJump() {
        assertNull(find(album = "manual:other"))
        assertNull(find(query = "sunset"))
        assertNull(find(kind = "video"))
        assertNull(find(sort = "name"))
        assertNull(find(dir = "desc"))
        assertNull(find(epoch = 6))
    }

    @Test fun rejectsEvictionNodeRevisionReplacementAndMissingAnchor() {
        assertNull(find(rows = listOf(NativeCloudViewerKey(40, 4))))
        assertNull(find(rows = listOf(NativeCloudViewerKey(41, 3))))
        assertNull(find(a = null))
        assertNull(find(a = anchor.copy(source = NativeCloudViewerKey(0, 3))))
    }
}
