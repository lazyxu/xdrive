package com.tfluid.xdrive

import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Test

/** Foreground-only autoplay is a playback contract, not a claim of a real
 * Android audio decoder or production Owner stream. */
class NativeFilesAudioForegroundTest {
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
