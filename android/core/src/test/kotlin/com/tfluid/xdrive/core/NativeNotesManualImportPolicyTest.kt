package com.tfluid.xdrive.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeNotesManualImportPolicyTest {
    private val noteID = "12345678-1234-1234-1234-123456789abc"
    private val asset = "00000000-0000-4000-8000-000000000001.png"
    private val serverPath = "_assets/$noteID/$asset"

    @Test fun onlyExplicitlyReferencedLocalImagesAreSelected() {
        val markdown = "# 标题\n\n![一](images/one.png)\n![二](two.webp)\n![重复](images/one.png)"
        assertEquals(listOf("one.png", "two.webp"),
            NativeNotesManualImportPolicy.references(markdown))
        assertEquals(listOf("one.png", "two.webp"),
            NativeNotesManualImportPolicy.selectedImages(
                listOf("one.png", "two.webp"), listOf("one.png", "two.webp", "unused.jpg")))
    }

    @Test fun sameFilenameFromDifferentDirectoriesIsRejectedAsAmbiguous() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeNotesManualImportPolicy.references(
                "![first](first/photo.png)\n![second](second/photo.png)")
        }
    }

    @Test fun remoteAbsoluteTraversalAndUnsupportedImagesAreRejected() {
        listOf(
            "https://example.com/a.png", "/tmp/a.png", "../a.png",
            "images/../../a.png", "file:///a.png", "data:image/png;base64,AA",
            "images/%2e%2e/a.png", "images/a.svg", "images/a.png?download=1",
        ).forEach { path ->
            assertThrows(IllegalArgumentException::class.java) {
                NativeNotesManualImportPolicy.localImageFilename(path)
            }
        }
    }

    @Test fun missingDuplicateAndExcessImagesFailClosed() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeNotesManualImportPolicy.selectedImages(listOf("a.png"), emptyList())
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativeNotesManualImportPolicy.selectedImages(emptyList(), listOf("a.png", "a.png"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            NativeNotesManualImportPolicy.selectedImages(
                emptyList(), (0..NativeNotesManualImportPolicy.maxImages).map { "$it.png" })
        }
    }

    @Test fun imageReferencesAreReplacedOnlyByVerifiedSameNoteAssetPaths() {
        val markdown = "# 标题\n![图](images/one.png)\n![另一个](two.webp)"
        val changed = NativeNotesManualImportPolicy.replacing(
            markdown, "one.png", serverPath, noteID)
        assertTrue(changed.contains("![图]($serverPath)"))
        assertTrue(changed.contains("![另一个](two.webp)"))
        assertFalse(changed.contains("images/one.png"))
        assertThrows(IllegalArgumentException::class.java) {
            NativeNotesManualImportPolicy.replacing(
                markdown, "one.png", "_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/$asset", noteID)
        }
    }
}
