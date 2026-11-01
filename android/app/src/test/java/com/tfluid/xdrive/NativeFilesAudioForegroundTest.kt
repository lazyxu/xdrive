package com.tfluid.xdrive

import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Test

/** Foreground-only autoplay is a playback contract, not a claim of a real
 * Android audio decoder or production Owner stream. */
class NativeFilesAudioForegroundTest {
    @Test fun failedMedia3SetupMustRetireVerifiedSourceImmediately() {
        assertTrue(filesAudioShouldReleaseFailedLease(
            sourcePresent = true, playerReady = false, terminalFailure = false))
        assertTrue(filesAudioShouldReleaseFailedLease(
            sourcePresent = true, playerReady = false, terminalFailure = true))
    }

    @Test fun terminalMedia3ErrorReleasesLeaseButHealthyPlaybackKeepsIt() {
        assertTrue(filesAudioShouldReleaseFailedLease(
            sourcePresent = true, playerReady = true, terminalFailure = true))
        assertFalse(filesAudioShouldReleaseFailedLease(
            sourcePresent = true, playerReady = true, terminalFailure = false))
        // A failed session fetch has no scoped media connection to release.
        assertFalse(filesAudioShouldReleaseFailedLease(
            sourcePresent = false, playerReady = false, terminalFailure = true))
        assertFalse(filesAudioShouldReleaseFailedLease(
            sourcePresent = false, playerReady = true, terminalFailure = true))
    }

    @Test fun exactOwnerAudioLeaseReleaseIsIdempotentAcrossFailureRetryAndDispose() {
        var releases = 0
        val oldLease = com.tfluid.xdrive.core.OwnerVideoPlayback(
            "https://fixture.invalid/api/v1/files/1/content",
            okhttp3.OkHttpClient(), 42L,
        ) { releases++ }
        // Terminal error cleanup and Compose disposal can race; the same
        // lease closes exactly once and cannot close a later retry lease.
        oldLease.close()
        oldLease.close()
        assertEquals(1, releases)
        val nextLease = com.tfluid.xdrive.core.OwnerVideoPlayback(
            "https://fixture.invalid/api/v1/files/1/content",
            okhttp3.OkHttpClient(), 42L,
        ) { releases++ }
        assertEquals(1, releases)
        nextLease.close()
        assertEquals(2, releases)
    }

    @Test fun noAutoplayBeforeStartOrAfterStopOrDestroy() {
        for (state in listOf(
            Lifecycle.State.INITIALIZED,
            Lifecycle.State.CREATED,
            Lifecycle.State.DESTROYED,
        )) {
            assertFalse("Unexpected background autoplay at $state",
                filesAudioMayAutoPlay(state))
        }
    }

    @Test fun liveStartedAndResumedActivityMayStartActualMedia() {
        assertTrue(filesAudioMayAutoPlay(Lifecycle.State.STARTED))
        assertTrue(filesAudioMayAutoPlay(Lifecycle.State.RESUMED))
    }

    @Test fun lateOwnerSourceAfterStopMustNotResumeWithoutUserIntent() {
        // Media3 init reads the *latest* lifecycle state, not the state when
        // the original authenticated Owner GET began.
        val lifecycleWhenRequested = Lifecycle.State.RESUMED
        val lifecycleWhenSourceArrives = Lifecycle.State.CREATED
        assertTrue(filesAudioMayAutoPlay(lifecycleWhenRequested))
        assertFalse(filesAudioMayAutoPlay(lifecycleWhenSourceArrives))
        // Android must initialize playWhenReady=false; merely returning to
        // RESUMED does not change that flag. A new explicit play tap can.
        assertTrue(filesAudioMayAutoPlay(Lifecycle.State.RESUMED))
    }
}
