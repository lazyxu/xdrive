package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guard against navigating before Owner root verification or after user intent. */
class NativeGalleryFirstLandingTest {
    private val ownerRoot = DriveNode(1, null, "", "dir", revision = 3)
    private val initialFiles = DriveState(
        screen = Screen.FILES,
        nativeUiSessionId = 42,
        loaded = true,
        path = listOf(ownerRoot),
    )
    private val filesTab = NativeHomeNavigation().select(NativeHomeTab.FILES)

    @Test fun freshVerifiedOwnerRootOpensGalleryExactlyOnce() {
        assertTrue(nativeGalleryFirstLandingAllowed(true, filesTab, initialFiles))
        assertFalse(nativeGalleryFirstLandingAllowed(false, filesTab, initialFiles))
        assertFalse(nativeGalleryFirstLandingAllowed(true,
            filesTab.select(NativeHomeTab.ALL), initialFiles))
        assertFalse(nativeGalleryFirstLandingAllowed(true,
            filesTab.select(NativeHomeTab.DYNAMIC), initialFiles))
        assertFalse(nativeGalleryFirstLandingAllowed(true,
            filesTab.select(NativeHomeTab.GALLERY), initialFiles))
    }

    @Test fun neverNavigateWhileLoginOrOwnerRootIsUnverified() {
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(nativeUiSessionId = 0)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(loaded = false)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(path = emptyList())))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(screen = Screen.LOGIN)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(screen = Screen.PASSWORD)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(loading = true, discardableReadInFlight = false)))
    }

    @Test fun userOperationsOrOtherFilesRoutesAlwaysWin() {
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(fileUploadActive = true)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(fileDownloadActive = true)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(destinationKind = FilesTransferKind.COPY)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(fileUploadPickerParent = 1)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(filesSection = FilesSection.SEARCH)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(browseSelectionMode = true)))
        assertFalse(nativeGalleryFirstLandingAllowed(true, filesTab,
            initialFiles.copy(selected = DriveNode(2, 1, "photo.jpg", "file", 10, 1))))
    }
}
