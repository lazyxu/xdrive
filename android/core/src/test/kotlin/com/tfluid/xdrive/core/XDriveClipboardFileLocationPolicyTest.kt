package com.tfluid.xdrive.core

import org.junit.Assert.*
import org.junit.Test

/** JVM regression for the actual Files nodeLocation root-to-parent contract. */
class XDriveClipboardFileLocationPolicyTest {
    private val root = DriveCrumb(1, "")
    private val photos = DriveCrumb(12, "Photos")
    private val year = DriveCrumb(31, "2026")
    private val file = DriveNode(id = 45, parentId = 31, name = "x.heic",
        type = "file", size = 2048, revision = 8)

    @Test fun directAndNestedFilesUseTheFirstRootBreadcrumb() {
        val direct = DriveNode(id = 16, parentId = 1, name = "a.jpg",
            type = "file", size = 12, revision = 3)
        assertTrue(XDriveClipboardFileLocationPolicy.accepts(
            direct, OwnedNodeLocation(16, 3, 1, listOf(root)), 1))
        val nested = OwnedNodeLocation(45, 8, 31, listOf(root, photos, year))
        assertTrue(XDriveClipboardFileLocationPolicy.accepts(file, nested, 1))
    }

    @Test fun nestedFoldersCanBeEnumeratedWithoutRejectingLegitimateAncestors() {
        val folder = DriveNode(id = 31, parentId = 12, name = "2026",
            type = "dir", size = 0, revision = 6)
        val location = OwnedNodeLocation(31, 6, 12, listOf(root, photos))
        assertTrue(XDriveClipboardFileLocationPolicy.accepts(folder, location, 1))
        assertFalse(XDriveClipboardFileLocationPolicy.accepts(folder, location, 12))
    }

    @Test fun differentOwnerAndStaleNodeIdentityFailClosed() {
        val correct = OwnedNodeLocation(45, 8, 31, listOf(root, photos, year))
        assertFalse(XDriveClipboardFileLocationPolicy.accepts(file, correct, 9))
        assertFalse(XDriveClipboardFileLocationPolicy.accepts(file,
            correct.copy(revision = 9), 1))
        assertFalse(XDriveClipboardFileLocationPolicy.accepts(file,
            correct.copy(parentId = 12), 1))
        assertFalse(XDriveClipboardFileLocationPolicy.accepts(file.copy(parentId = 12),
            correct, 1))
        assertFalse(XDriveClipboardFileLocationPolicy.accepts(file.copy(id = 46),
            correct, 1))
    }

    @Test fun malformedOrForeignAncestorChainsAreNotAdmitted() {
        fun checked(path: List<DriveCrumb>) =
            XDriveClipboardFileLocationPolicy.accepts(file,
                OwnedNodeLocation(45, 8, 31, path), 1)
        assertFalse(checked(emptyList()))
        assertFalse(checked(listOf(DriveCrumb(9, ""), photos, year)))
        assertFalse(checked(listOf(root, photos)))
        assertFalse(checked(listOf(root, photos, photos, year)))
        assertFalse(checked(listOf(root, photos, DriveCrumb(45, "cycle"), year)))
        assertFalse(checked(listOf(DriveCrumb(1, "forged-root"), photos, year)))
    }
}
