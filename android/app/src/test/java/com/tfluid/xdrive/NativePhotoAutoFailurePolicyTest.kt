package com.tfluid.xdrive

import com.tfluid.xdrive.core.ServerAddress
import org.junit.Assert.*
import org.junit.Test

/** A failed periodic read is not automatically a lost finalize ACK. */
class NativePhotoAutoFailurePolicyTest {
    private val owner = NativePhotoBackupOwner(
        ServerAddress.parse("https://drive.example").url,
        "instance", 42L, "owner", 1L, 3L, "android-device")
    private fun intent(phase: NativePhotoBackupPhase, scope: NativePhotoBackupOwner = owner) =
        NativePhotoBackupIntent(
            id = "00000000-0000-4000-8000-000000000091",
            owner = scope, assetKey = "a".repeat(64),
            versionKey = "b".repeat(64),
            resource = NativePhotoBackupResource.STILL,
            originalSha256 = "c".repeat(64),
            sizeBytes = 400L, phase = phase,
            createdAtMillis = 1_800_000_000_000L,
            destinationName = "photo.jpg",
            verifiedNodeId = if (phase == NativePhotoBackupPhase.VERIFIED) 5L else null,
            verifiedNodeRevision = if (phase == NativePhotoBackupPhase.VERIFIED) 2L else null,
        )

    @Test fun transientScanAndPreuploadReadFailuresRemainScheduled() {
        val status = AndroidPhotoAutoPolicyStore.STATUS_RETRYABLE_FAILURE
        assertEquals(status, nativePhotoAutoFailureStatus(true, emptyList()))
        assertEquals(status, nativePhotoAutoFailureStatus(
            true, listOf(intent(NativePhotoBackupPhase.PLANNED))))
        assertEquals(status, nativePhotoAutoFailureStatus(
            true, listOf(intent(NativePhotoBackupPhase.VERIFIED))))
        assertEquals(AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION,
            nativePhotoAutoFailureStatus(false, emptyList()))
    }

    @Test fun unknownOrUnreadableUploadJournalAlwaysBlocksAutomaticReplay() {
        val blocked = AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW
        assertEquals(blocked, nativePhotoAutoFailureStatus(true, null))
        for (phase in listOf(NativePhotoBackupPhase.MAY_HAVE_SENT,
                NativePhotoBackupPhase.UNKNOWN_ACK)) {
            assertEquals(blocked, nativePhotoAutoFailureStatus(
                true, listOf(intent(phase))))
            // Global upload exclusion must also respect unresolved previous
            // Owners; the Worker cannot reauthorize their outstanding ACK.
            assertEquals(blocked, nativePhotoAutoFailureStatus(
                true, listOf(intent(phase, owner.copy(ownerId = 99L)))))
        }
    }
}
