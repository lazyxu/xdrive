package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native Gallery video retry stays a manual terminal-error action.
 * Retry recreates a current Owner playback lease, never a background loop. */
class GalleryVideoRetryPolicyTest {
    @Test fun ownerSourceFailureMayRetryOnExplicitTap() {
        assertTrue(galleryVideoRetryAvailable(
            hasSource = false, hasPlayer = false, playbackFailed = false))
    }

    @Test fun vendorMedia3SetupFailureMayRetryOnExplicitTap() {
        assertTrue(galleryVideoRetryAvailable(
            hasSource = true, hasPlayer = false, playbackFailed = false))
    }

    @Test fun media3PlaybackFailureMayRetryOnExplicitTap() {
        assertTrue(galleryVideoRetryAvailable(
            hasSource = true, hasPlayer = true, playbackFailed = true))
    }

    @Test fun healthyPlaybackNeverShowsRetry() {
        assertFalse(galleryVideoRetryAvailable(
            hasSource = true, hasPlayer = true, playbackFailed = false))
    }
}
