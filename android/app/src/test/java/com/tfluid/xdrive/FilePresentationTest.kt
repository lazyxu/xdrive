package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Test

class FilePresentationTest {
    @Test fun invalidOrUnknownSavedFilesViewFailsToList() {
        assertEquals(FileViewMode.LIST, FileViewMode.fromPreference(null))
        assertEquals(FileViewMode.LIST, FileViewMode.fromPreference("unexpected"))
        assertEquals(FileViewMode.LIST, FileViewMode.fromPreference("list"))
        assertEquals(FileViewMode.GRID, FileViewMode.fromPreference("GRID"))
    }

    @Test fun sessionFolderAnchorsRestoreOnlyTheirOwnPathAndAreBounded() {
        val anchors = FilesViewportAnchors(capacity = 2)
        val root = listOf(1L)
        val child = listOf(1L, 2L)
        val other = listOf(3L)
        assertEquals(0, anchors.position(root))
        anchors.record(root, 50)
        anchors.record(child, 13)
        assertEquals(50, anchors.position(root))
        anchors.record(other, 6)
        assertEquals(2, anchors.count())
        assertEquals(0, anchors.position(child)) // LRU eviction
        assertEquals(50, anchors.position(root))
        assertEquals(6, anchors.position(other))
        anchors.record(emptyList(), 99)
        anchors.record(root, -1)
        assertEquals(2, anchors.count())
        assertEquals(50, anchors.position(root))
        // A new in-memory Files session starts without a prior owner's path.
        assertEquals(0, FilesViewportAnchors().position(root))
    }

    @Test fun canonicalFilenameKinds() {
        assertEquals("folder", fileKind("dir.jpg", true))
        listOf(
            "PHOTO.JPG" to "image", ".gitignore" to "file", "a." to "file",
            "README" to "file", "movie.MOV" to "video", "notes.txt" to "text",
            "code.kt" to "code", "book.pdf" to "pdf", "data.csv" to "spreadsheet",
            "slides.pptx" to "presentation", "archive.zip" to "archive", "unknown.ext" to "file",
        ).forEach { (name, kind) -> assertEquals(name, kind, fileKind(name, false)) }
    }
}
