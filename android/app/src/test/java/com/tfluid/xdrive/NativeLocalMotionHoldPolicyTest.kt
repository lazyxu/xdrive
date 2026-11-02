package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/**
 * Local Motion Photo can only play an actual candidate with a decoded still
 * while a fresh pointer hold is active in the foreground. These tests do not
 * mistake XMP for a verified playable MP4 or require an OEM decoder.
 */
class NativeLocalMotionHoldPolicyTest {
    @Test fun metadataAloneCannotLaunchMotionOrReplaceMissingStill() {
        assertFalse(nativeLocalMotionMayPlay(
            candidate = true, stillReady = false, held = true, foreground = true))
        assertFalse(nativeLocalMotionMayPlay(
            candidate = false, stillReady = true, held = true, foreground = true))
        assertFalse(nativeLocalMotionMayPlay(
            candidate = true, stillReady = true, held = false, foreground = true))
        assertTrue(nativeLocalMotionMayPlay(
            candidate = true, stillReady = true, held = true, foreground = true))
        assertFalse(nativeLocalMotionMayPlay(
            candidate = true, stillReady = true, held = true, foreground = true,
            atDefaultZoom = false))
    }

    @Test fun releaseAndBackgroundRetireMotionImmediately() {
        val candidate = true
        val decodedStill = true
        assertTrue(nativeLocalMotionMayPlay(candidate, decodedStill, true, true))
        // Release: retain the still but retire the transient motion player.
        assertFalse(nativeLocalMotionMayPlay(candidate, decodedStill, false, true))
        // Activity STOP: even if a pointer remains down it cannot authorize
        // an old Media3 decoder after the Activity resumes.
        assertFalse(nativeLocalMotionMayPlay(candidate, decodedStill, true, false))
        // Caller clears the held state on STOP. A fresh gesture is required.
        assertFalse(nativeLocalMotionMayPlay(candidate, decodedStill, false, true))
        assertTrue(nativeLocalMotionMayPlay(candidate, decodedStill, true, true))
    }

    @Test fun switchingUriRequiresNewHeldState() {
        val item = NativeLocalViewerItemKey(18L, false, "camera", 1234L)
        val old = NativeLocalVideoSourceKey(item, "content://media/external/images/media/18")
        val replacement = NativeLocalVideoSourceKey(
            item, "content://media/external_primary/images/media/18")
        assertNotEquals(old, replacement)
        // Compose remember(mediaIdentity) resets both the XMP candidate and
        // hold flag on any source change, never persisting the old intent.
        assertFalse(nativeLocalMotionMayPlay(false, false, false, true))
    }
}
