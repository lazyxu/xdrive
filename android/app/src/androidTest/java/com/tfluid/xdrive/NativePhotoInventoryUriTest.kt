package com.tfluid.xdrive

import android.net.Uri
import org.junit.Assert.*
import org.junit.Test

/** Android runtime-only ContentUris check; no Robolectric dependency in JVM tests. */
class NativePhotoInventoryUriTest {
    private fun candidate(isVideo: Boolean, uri: String) = NativePhotoOriginalCandidate(
        localId = 21, uri = Uri.parse(uri), isVideo = isVideo,
        mimeType = if (isVideo) "video/mp4" else "image/jpeg",
        sizeBytes = 5, modifiedAtSeconds = 1,
    )

    @Test fun mediaTypeAndUriMustMatchProviderCollection(): Unit {
        assertTrue(nativePhotoCanonicalUriMatches(candidate(
            false, "content://media/external/images/media/21")))
        assertFalse(nativePhotoCanonicalUriMatches(candidate(
            false, "content://media/external/file/21")))
        assertFalse(nativePhotoCanonicalUriMatches(candidate(
            false, "content://media/external/video/media/21")))
        assertTrue(nativePhotoCanonicalUriMatches(candidate(
            true, "content://media/external/video/media/21")))
        assertFalse(nativePhotoCanonicalUriMatches(candidate(
            true, "content://media/external/images/media/21")))
    }
}
