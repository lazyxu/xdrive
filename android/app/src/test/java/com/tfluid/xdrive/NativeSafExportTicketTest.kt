package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.GalleryAsset
import org.junit.Assert.*
import org.junit.Test

/** No fake SAF output or network success: verify the exact authenticated
 * Owner/Node revision binding before Android may open a document stream. */
class NativeSafExportTicketTest {
    private val root = DriveNode(1L, name = "", type = "dir", revision = 1L)
    private val folder = DriveNode(3L, parentId = 1L,
        name = "Photos", type = "dir", revision = 2L)
    private val photo = DriveNode(27L, parentId = 3L,
        name = "photo.jpg", type = "file", size = 4096L, revision = 7L)

    private fun files(): DriveState = DriveState(
        screen = Screen.FILES, filesSection = FilesSection.BROWSE,
        server = "https://drive.example", username = "owner",
        loaded = true, path = listOf(root, folder), items = listOf(photo),
        fileExportPending = photo, fileExportOrigin = Screen.FILES,
    )

    private fun gallery(): DriveState {
        val asset = GalleryAsset(photo, "image", hasThumbnail = true)
        return DriveState(
            screen = Screen.GALLERY, server = "https://drive.example",
            username = "owner", galleryLoaded = true,
            galleryItems = listOf(asset), gallerySelected = asset,
            fileExportPending = photo, fileExportOrigin = Screen.GALLERY,
        )
    }

    @Test fun exactFilesChooserStateIsRequiredEvenWhenSameOwnerAndNodeAppear() {
        val state = files()
        val ticket = requireNotNull(NativeSafExportTicket.capture(state))
        assertTrue(ticket.isCurrent(state))
        assertFalse(ticket.isCurrent(state.copy()))
        assertFalse(ticket.isCurrent(state.copy(loading = true)))
        assertFalse(ticket.isCurrent(state.copy(fileExportPending = null)))
        assertFalse(ticket.isCurrent(state.copy(fileExportOrigin = null)))
    }

    @Test fun ownerAtoBtoAOrFolderHopCannotReplayOldDestination() {
        val start = files()
        val ticket = requireNotNull(NativeSafExportTicket.capture(start))
        val switchedOwner = start.copy(username = "other")
        val returnedOwner = switchedOwner.copy(username = start.username)
        assertFalse(ticket.isCurrent(switchedOwner))
        assertFalse(ticket.isCurrent(returnedOwner))
        val newFolder = start.copy(
            path = listOf(root), fileExportPending = photo.copy(parentId = 1L),
            items = listOf(photo.copy(parentId = 1L)))
        assertFalse(ticket.isCurrent(newFolder))
        assertFalse(ticket.isCurrent(start.copy(
            fileExportPending = photo.copy(revision = 8L),
            items = listOf(photo.copy(revision = 8L)))))
    }

    @Test fun filesPickerRequiresCurrentLoadedBrowseFileAndVersion() {
        val good = files()
        for (invalid in listOf(
            good.copy(screen = Screen.LOGIN),
            good.copy(screen = Screen.PASSWORD),
            good.copy(filesSection = FilesSection.SEARCH),
            good.copy(path = emptyList()),
            good.copy(path = listOf(folder.copy(type = "file"))),
            good.copy(items = emptyList()),
            good.copy(loaded = false),
            good.copy(loading = true),
            good.copy(fileExportPending = photo.copy(revision = 0L),
                items = listOf(photo.copy(revision = 0L))),
            good.copy(fileExportPending = photo.copy(parentId = -1L),
                items = listOf(photo.copy(parentId = -1L))),
            good.copy(fileExportPending = photo.copy(type = "dir"),
                items = listOf(photo.copy(type = "dir"))),
            good.copy(fileDownloadActive = true),
            good.copy(fileUploadActive = true),
            good.copy(fileUploadPickerParent = folder.id),
            good.copy(destinationKind = FilesTransferKind.MOVE),
            good.copy(browseSelectionMode = true),
            good.copy(browseBatchWriteAttempted = true),
            good.copy(server = ""),
            good.copy(username = ""),
        )) assertNull(NativeSafExportTicket.capture(invalid))
        assertTrue(validNativeSafExportPicker(good))
    }

    @Test fun genuineGallerySelectionUsesExactLoadedOwnerAsset() {
        val start = gallery()
        val ticket = requireNotNull(NativeSafExportTicket.capture(start))
        assertTrue(ticket.isCurrent(start))
        assertFalse(ticket.isCurrent(start.copy()))
        assertNull(NativeSafExportTicket.capture(start.copy(gallerySelected = null)))
        assertNull(NativeSafExportTicket.capture(start.copy(galleryItems = emptyList())))
        assertNull(NativeSafExportTicket.capture(start.copy(galleryLoaded = false)))
        assertNull(NativeSafExportTicket.capture(start.copy(fileExportOrigin = Screen.FILES)))
        assertNull(NativeSafExportTicket.capture(start.copy(screen = Screen.FILES)))
    }

    @Test fun invalidOrMissingPendingExportNeverMakesAnOSResultAuthorized() {
        val state = files()
        assertNull(NativeSafExportTicket.capture(state.copy(fileExportPending = null)))
        assertNull(NativeSafExportTicket.capture(state.copy(fileExportOrigin = null)))
        assertNull(NativeSafExportTicket.capture(
            state.copy(fileExportPending = photo.copy(size = -1L),
                items = listOf(photo.copy(size = -1L)))))
        assertNull(NativeSafExportTicket.capture(
            state.copy(fileExportPending = photo.copy(id = -1L),
                items = listOf(photo.copy(id = -1L)))))
    }
}
