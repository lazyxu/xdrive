package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Viewer retains the decoded thumbnail when an original attempt fails.
 * Retry is an explicit current-Owner action, not a background fetch loop. */
class GalleryOriginalFallbackRetryTest {
    @Test fun sampleSizeDisclosesThatDecodedOriginalIsNotFullResolution() {
        assertEquals(1, galleryOriginalSampleSize(4096, 4096))
        assertEquals(2, galleryOriginalSampleSize(4097, 1000))
        assertEquals(2, galleryOriginalSampleSize(8000, 1200))
        assertEquals(8, galleryOriginalSampleSize(32768, 800))
        assertNull(galleryOriginalSampleSize(0, 1000))
        assertNull(galleryOriginalSampleSize(33000, 1000))
    }

    @Test fun qualitySourceNeverMislabelsSampledPixelsAsOriginalResolution() {
        assertEquals("缩略图", galleryViewerQualitySource(true, false))
        assertEquals("缩略图", galleryViewerQualitySource(true, true))
        assertEquals("原件 · 适屏采样", galleryViewerQualitySource(false, true))
        assertEquals("原件 · 原始分辨率", galleryViewerQualitySource(false, false))
    }

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

    @Test fun failedViewerNeverOffersRetryForOversizeOrUnsupportedOriginal() {
        assertFalse(galleryOriginalFailedRetryVisible(originalEligible = false))
        assertTrue(galleryOriginalFailedRetryVisible(originalEligible = true))
    }

}
