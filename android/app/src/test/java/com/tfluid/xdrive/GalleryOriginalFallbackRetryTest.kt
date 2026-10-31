package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Viewer retains the decoded thumbnail when an original attempt fails.
 * Retry is an explicit current-Owner action, not a background fetch loop. */
class GalleryOriginalFallbackRetryTest {
    @Test fun failedEligibleOriginalOffersRetryWithoutDiscardingThumbnail() {
        assertTrue(galleryOriginalFallbackRetryVisible(
            thumbnailOnly = true, upgrading = false, originalEligible = true))
    }

    @Test fun inFlightUpgradeDoesNotOfferConcurrentOriginalRetry() {
        assertFalse(galleryOriginalFallbackRetryVisible(
            thumbnailOnly = true, upgrading = true, originalEligible = true))
    }

    @Test fun oversizeOrUnsupportedOriginalDoesNotOfferIneffectiveRetry() {
        assertFalse(galleryOriginalFallbackRetryVisible(
            thumbnailOnly = true, upgrading = false, originalEligible = false))
    }

    @Test fun decodedOriginalOrFailedBothLayersUsesExistingViewerControls() {
        assertFalse(galleryOriginalFallbackRetryVisible(
            thumbnailOnly = false, upgrading = false, originalEligible = true))
        assertFalse(galleryOriginalFallbackRetryVisible(
            thumbnailOnly = false, upgrading = true, originalEligible = true))
    }
}
