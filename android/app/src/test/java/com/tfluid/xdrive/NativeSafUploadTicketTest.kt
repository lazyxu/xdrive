package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import org.junit.Assert.*
import org.junit.Test

/** Pure current-Owner semantics; never opens Android picker or an external URI. */
class NativeSafUploadTicketTest {
    private val root = DriveNode(1L, name = "", type = "dir", revision = 1)
    private val folder = DriveNode(3L, parentId = 1L,
        name = "Photos", type = "dir", revision = 2)

    private fun picker(): DriveState = DriveState(
        screen = Screen.FILES, filesSection = FilesSection.BROWSE,
        server = "https://drive.example", username = "owner",
        path = listOf(root, folder), loaded = true,
        fileUploadPickerParent = folder.id,
    )

    @Test fun exactLaunchStateSurvivesOnlyUnchangedPicker() {
        val current = picker()
        val ticket = requireNotNull(NativeSafUploadTicket.capture(current))
        assertTrue(ticket.isCurrent(current))
        assertFalse(ticket.isCurrent(current.copy())) // even same Owner and path
        assertFalse(ticket.isCurrent(current.copy(
            fileUploadPickerParent = null)))
        assertFalse(ticket.isCurrent(current.copy(username = "other")))
    }

    @Test fun ownerAtoBtoAOrFolderHopNeverReplaysOldSelection() {
        val original = picker()
        val ticket = requireNotNull(NativeSafUploadTicket.capture(original))
        val otherOwner = original.copy(username = "other")
        val returnedToOwner = otherOwner.copy(username = original.username)
        assertFalse(ticket.isCurrent(otherOwner))
        assertFalse(ticket.isCurrent(returnedToOwner))
        val changedFolder = original.copy(path = listOf(root),
            fileUploadPickerParent = root.id)
        assertFalse(ticket.isCurrent(changedFolder))
        assertFalse(ticket.isCurrent(original.copy(loading = true)))
    }

    @Test fun onlyRealLoadedBrowsePickerWithAuthenticatedFolderIsEligible() {
        val base = picker()
        for (bad in listOf(
            base.copy(screen = Screen.LOGIN),
            base.copy(screen = Screen.GALLERY),
            base.copy(filesSection = FilesSection.SEARCH),
            base.copy(loaded = false),
            base.copy(loading = true),
            base.copy(server = ""),
            base.copy(username = ""),
            base.copy(path = emptyList()),
            base.copy(fileUploadPickerParent = null),
            base.copy(fileUploadPickerParent = root.id),
            base.copy(fileUploadActive = true),
            base.copy(fileDownloadActive = true),
            base.copy(fileExportPending = folder),
            base.copy(browseSelectionMode = true),
            base.copy(browseBatchWriteAttempted = true),
            base.copy(destinationKind = FilesTransferKind.MOVE),
        )) {
            assertNull(NativeSafUploadTicket.capture(bad))
            assertFalse(validNativeSafUploadPicker(bad))
        }
        assertNotNull(NativeSafUploadTicket.capture(base))
    }

    @Test fun invalidOrNonDirectoryPathCannotOwnAnUploadTicket() {
        val base = picker()
        assertNull(NativeSafUploadTicket.capture(base.copy(
            path = listOf(root, folder.copy(type = "file")))))
        assertNull(NativeSafUploadTicket.capture(base.copy(
            path = listOf(root, folder.copy(id = -1L)),
            fileUploadPickerParent = -1L)))
        assertNull(NativeSafUploadTicket.capture(base.copy(
            path = listOf(root.copy(id = -2L), folder))))
    }
}
