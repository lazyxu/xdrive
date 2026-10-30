package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Pure provider data regression; Android content URI behavior has emulator tests. */
class NativePhotoInventorySnapshotTest {
    private fun matches(
        id: Long = 21L, mime: String? = "image/jpeg",
        size: Long = 1000L, modified: Long = 200L,
        pending: Boolean = false, trashed: Boolean = false,
    ): Boolean = nativePhotoSnapshotMatches(
        selectedId = 21L, selectedIsVideo = false,
        selectedMimeType = "image/jpeg", selectedSize = 1000L,
        selectedModified = 200L,
        id = id, mimeType = mime, size = size, modified = modified,
        isPending = pending, isTrashed = trashed,
    )

    @Test fun exactSelectedOriginalRequiresVisibleProviderRow(): Unit {
        assertTrue(matches())
        assertFalse(matches(pending = true))
        assertFalse(matches(trashed = true))
    }

    @Test fun replacedIdSizeMimeTimestampOrNullMimeCannotBeBackupReady(): Unit {
        assertFalse(matches(id = 22))
        assertFalse(matches(size = 1001))
        assertFalse(matches(mime = "image/png"))
        assertFalse(matches(mime = "video/mp4"))
        assertFalse(matches(modified = 201))
        assertFalse(matches(mime = null))
    }

    @Test fun videoIsCheckedAgainstVideoMimeAndNeverImageMime(): Unit {
        fun videoObserved(mime: String?) = nativePhotoSnapshotMatches(
            selectedId = 25, selectedIsVideo = true, selectedMimeType = "video/mp4",
            selectedSize = 555, selectedModified = 8,
            id = 25, mimeType = mime, size = 555, modified = 8,
            isPending = false, isTrashed = false,
        )
        assertTrue(videoObserved("video/mp4"))
        assertFalse(videoObserved("image/jpeg"))
    }
}
