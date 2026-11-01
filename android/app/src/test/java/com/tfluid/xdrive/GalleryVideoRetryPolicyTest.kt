package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native Gallery video retry stays a manual terminal-error action.
 * Retry recreates a current Owner playback lease, never a background loop. */
class GalleryVideoRetryPolicyTest {
    @Test fun terminalPreparedPlayerFailureRetiresOwnerLeaseWithoutLeavingViewer() {
        assertTrue(galleryVideoShouldRetireFailedPlayback(
            hasSource = true, hasPlayer = true, playbackFailed = true))
        assertFalse(galleryVideoShouldRetireFailedPlayback(
            hasSource = true, hasPlayer = true, playbackFailed = false))
    }

    @Test fun sourceOrSetupFailuresKeepExistingSeparateDisposalPath() {
        // No verified Owner connection exists if source acquisition failed.
        assertFalse(galleryVideoShouldRetireFailedPlayback(
            hasSource = false, hasPlayer = false, playbackFailed = true))
        // A failed ExoPlayer setup is already closed immediately by the
        // exact-source DisposableEffect, not the prepared-player path.
        assertFalse(galleryVideoShouldRetireFailedPlayback(
            hasSource = true, hasPlayer = false, playbackFailed = true))
    }

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
