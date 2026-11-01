package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Only persisted policy statuses, never fabricated successful backup receipts. */
class NativePhotoAutoStatusPresentationTest {
    @Test fun allAcceptedLastKnownWorkerStatesHaveHonestActionableLabels() {
        val names = listOf(
            AndroidPhotoAutoPolicyStore.STATUS_WAITING to "native-photo-auto-waiting",
            AndroidPhotoAutoPolicyStore.STATUS_RUNNING to "native-photo-auto-running",
            AndroidPhotoAutoPolicyStore.STATUS_SCANNED to "native-photo-auto-scanned",
            AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION to "native-photo-auto-requires-session",
            AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_PERMISSION to "native-photo-auto-requires-permission",
            AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW to "native-photo-auto-needs-review",
            AndroidPhotoAutoPolicyStore.STATUS_RETRYABLE_FAILURE to "native-photo-auto-retryable",
        )
        assertEquals(AndroidPhotoAutoPolicyStore.ALLOWED_STATUSES, names.map { it.first }.toSet())
        names.forEach { (status, tag) ->
            val detail = requireNotNull(nativePhotoAutoStatusPresentation(true, status))
            assertEquals(tag, detail.testTag)
            assertTrue(detail.message.isNotBlank())
            assertFalse(detail.message.contains("全部已备份"))
            assertFalse(detail.message.contains("备份完成"))
        }
    }

    @Test fun ownerNotConfiguredOrUnknownStatusNeverClaimsWorkerActivity() {
        for (status in AndroidPhotoAutoPolicyStore.ALLOWED_STATUSES) {
            assertNull(nativePhotoAutoStatusPresentation(false, status))
        }
        assertNull(nativePhotoAutoStatusPresentation(true, null))
        assertNull(nativePhotoAutoStatusPresentation(true, "complete"))
        assertNull(nativePhotoAutoStatusPresentation(true, "succeeded"))
    }

    @Test fun blockedAndUnknownAckNeedReviewRemainProminent() {
        for (status in listOf(
            AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION,
            AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_PERMISSION,
            AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW,
        )) {
            assertTrue(requireNotNull(nativePhotoAutoStatusPresentation(true, status)).warning)
        }
        assertFalse(requireNotNull(nativePhotoAutoStatusPresentation(
            true, AndroidPhotoAutoPolicyStore.STATUS_SCANNED)).warning)
    }
}
