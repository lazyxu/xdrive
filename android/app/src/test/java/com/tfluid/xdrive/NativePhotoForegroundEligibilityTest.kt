package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The foreground writer may start only from an authenticated safe Gallery root. */
class NativePhotoForegroundEligibilityTest {
    private val ready = DriveState(
        screen = Screen.GALLERY, nativeUiSessionId = 31L,
    )

    @Test fun authenticatedGalleryAllowsOneUserApprovedForegroundWriter() {
        assertTrue(ready.canStartNativePhotoForeground())
        assertFalse(ready.copy(screen = Screen.FILES).canStartNativePhotoForeground())
        assertFalse(ready.copy(screen = Screen.CONNECT).canStartNativePhotoForeground())
        assertFalse(ready.copy(nativeUiSessionId = 0L).canStartNativePhotoForeground())
        assertFalse(ready.copy(loading = true).canStartNativePhotoForeground())
    }

    @Test fun cannotStartDuringOtherWritersViewerMapOrUnsafeEdits() {
        assertFalse(ready.copy(fileUploadActive = true).canStartNativePhotoForeground())
        assertFalse(ready.copy(fileDownloadActive = true).canStartNativePhotoForeground())
        assertFalse(ready.copy(destinationKind = FilesTransferKind.COPY)
            .canStartNativePhotoForeground())
        assertFalse(ready.copy(galleryMapOpen = true).canStartNativePhotoForeground())
        assertFalse(ready.copy(gallerySelectionMode = true).canStartNativePhotoForeground())
        assertFalse(ready.copy(galleryMetadataWriteAttempted = true)
            .canStartNativePhotoForeground())
        assertFalse(ready.copy(galleryAlbumCreateAttempted = true)
            .canStartNativePhotoForeground())
        assertFalse(ready.copy(galleryAlbumEditAttempted = true)
            .canStartNativePhotoForeground())
        assertFalse(ready.copy(fileUploadPickerParent = 1L)
            .canStartNativePhotoForeground())
        assertFalse(ready.copy(fileExportPending = DriveNode(
            2, 1, "photo.jpg", "file", 5, 1)).canStartNativePhotoForeground())
    }
}
