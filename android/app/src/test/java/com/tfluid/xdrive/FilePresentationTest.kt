package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Test

class FilePresentationTest {
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
