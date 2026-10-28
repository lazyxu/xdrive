package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.FileBrowseArrangement
import com.tfluid.xdrive.core.FileBrowseGroupIndex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilesBrowseGroupingTest {
    private val grouping = FileBrowseArrangement(group = "type")
    private val groups = listOf(
        FileBrowseGroupIndex("folder", 2, 0),
        FileBrowseGroupIndex("ext:jpg", 3, 2),
    )
    private val nodes = (0..4).map { index ->
        DriveNode((index + 2).toLong(), 1,
            if (index < 2) "dir-$index" else "photo-$index.jpg",
            if (index < 2) "dir" else "file", revision = 1)
    }

    @Test fun groupsMatchRealServerSpansAcrossPagesNotLocalFileTypes() {
        val first = filesBrowseVisualRows(nodes.take(3), 0, grouping, groups)
        assertEquals(5, first.size) // Two headers + three actual Owner rows.
        assertEquals("group:0:folder", first.first().stableKey)
        assertEquals("group:2:ext:jpg", first[3].stableKey)
        assertEquals("node:4", first[4].stableKey)
        val more = filesBrowseVisualRows(nodes.drop(3), 3, grouping, groups)
        assertEquals(3, more.size)
        assertEquals("group:2:ext:jpg", more.first().stableKey)
        assertEquals("node:5", more[1].stableKey)
        assertEquals("node:6", more[2].stableKey)

        // A window starting in the middle of an indexed group has a real
        // heading even when the original logical group begins far above.
        val deepIndex = listOf(
            FileBrowseGroupIndex("folder", 1, 0),
            FileBrowseGroupIndex("ext:jpg", 99_999, 1),
        )
        val deep = filesBrowseVisualRows(nodes.take(2), 89_995, grouping, deepIndex)
        assertEquals(3, deep.size)
        assertEquals("group:1:ext:jpg", deep.first().stableKey)
        assertEquals("node:2", deep[1].stableKey)
    }

    @Test fun absentIndexDoesNotInventBucketsFromLoadedSparseRows() {
        val unindexed = filesBrowseVisualRows(nodes, 1000, grouping, emptyList())
        assertEquals(5, unindexed.size)
        assertTrue(unindexed.all { it is FilesBrowseVisualRow.File })
        val ungrouped = filesBrowseVisualRows(nodes, 0,
            FileBrowseArrangement(), groups)
        assertEquals(5, ungrouped.size)
        assertTrue(ungrouped.all { it is FilesBrowseVisualRow.File })
        val malformed = filesBrowseVisualRows(nodes, 999, grouping, groups)
        assertEquals(5, malformed.size)
        assertFalse(malformed.any { it is FilesBrowseVisualRow.Header })
    }

    @Test fun labelsUseSamePwaCanonicalBuckets() {
        assertEquals("文件夹", filesBrowseGroupLabel(grouping, "folder"))
        assertEquals("JPG", filesBrowseGroupLabel(grouping, "ext:jpg"))
        assertEquals("其他文件", filesBrowseGroupLabel(grouping, "other"))
        assertEquals("2026年10月", filesBrowseGroupLabel(
            FileBrowseArrangement(group = "modified"), "month:2026-10"))
        assertEquals("日期未知", filesBrowseGroupLabel(
            FileBrowseArrangement(group = "modified"), "unknown"))
        val size = FileBrowseArrangement(group = "size")
        assertEquals("小于 1 MiB", filesBrowseGroupLabel(size, "tiny"))
        assertEquals("1–100 MiB", filesBrowseGroupLabel(size, "small"))
        assertEquals("100 MiB–1 GiB", filesBrowseGroupLabel(size, "medium"))
        assertEquals("1 GiB 及以上", filesBrowseGroupLabel(size, "large"))
    }
}
