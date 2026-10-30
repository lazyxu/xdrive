package com.tfluid.xdrive

import android.net.Uri
import android.provider.MediaStore
import org.junit.Assert.*
import org.junit.Test

/** Provider state changes cannot silently redirect a confirmed one-shot backup. */
class NativePhotoInventorySnapshotTest {
    private val photo = NativePhotoOriginalCandidate(
        localId = 21L,
        uri = Uri.parse("content://media/external/images/media/21"),
        isVideo = false, mimeType = "image/jpeg", sizeBytes = 1000L,
        modifiedAtSeconds = 200L,
    )

    @Test fun exactSelectedPhotoMatchesOnlyUnchangedVisibleProviderRow(): Unit {
        assertTrue(nativePhotoSnapshotMatches(photo, 21, "image/jpeg",
            1000, 200, false, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, "image/jpeg",
            1000, 200, true, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, "image/jpeg",
            1000, 200, false, true))
    }

    @Test fun replacedIdSizeMimeOrTimestampMustDenyOriginal(): Unit {
        assertFalse(nativePhotoSnapshotMatches(photo, 22, "image/jpeg",
            1000, 200, false, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, "image/jpeg",
            1001, 200, false, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, "image/png",
            1000, 200, false, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, "video/mp4",
            1000, 200, false, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, "image/jpeg",
            1000, 201, false, false))
        assertFalse(nativePhotoSnapshotMatches(photo, 21, null,
            1000, 200, false, false))
    }

    @Test fun mediaKindAndUriAreCanonicalNotCallerProvided(): Unit {
        val wrongUri = photo.copy(uri = Uri.parse("content://media/external/file/21"))
        assertFalse(nativePhotoSnapshotMatches(wrongUri, 21, "image/jpeg",
            1000, 200, false, false))
        val video = photo.copy(isVideo = true,
            uri = Uri.parse("content://media/external/video/media/21"),
            mimeType = "video/mp4")
        assertTrue(nativePhotoSnapshotMatches(video, 21, "video/mp4",
            1000, 200, false, false))
        assertFalse(nativePhotoSnapshotMatches(video, 21, "image/jpeg",
            1000, 200, false, false))
    }
}
