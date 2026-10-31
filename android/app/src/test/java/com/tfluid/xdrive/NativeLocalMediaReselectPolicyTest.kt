package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure grant policy; the system dialog itself is owned by Android. */
class NativeLocalMediaReselectPolicyTest {
    @Test fun selectedPhotosGrantWithoutBroadImageVideoGrantsCanReselectOnAndroid14() {
        // Access granted through READ_MEDIA_VISUAL_USER_SELECTED.
        assertTrue(nativeLocalCanReselectMedia(34, true, false, false))
        assertTrue(nativeLocalCanReselectMedia(35, true, false, false))
    }

    @Test fun oneMediaTypeButNotBothMayAdjustAccessOnAndroid14() {
        assertTrue(nativeLocalCanReselectMedia(34, true, true, false))
        assertTrue(nativeLocalCanReselectMedia(34, true, false, true))
    }

    @Test fun fullyGrantedAndDeniedCasesNeverShowSelectedPhotosPrompt() {
        assertFalse(nativeLocalCanReselectMedia(34, true, true, true))
        assertFalse(nativeLocalCanReselectMedia(34, false, false, false))
        assertFalse(nativeLocalCanReselectMedia(35, false, true, false))
    }

    @Test fun olderAndroidVersionsDoNotPretendToOfferSelectedPhotosReselection() {
        assertFalse(nativeLocalCanReselectMedia(33, true, true, false))
        assertFalse(nativeLocalCanReselectMedia(32, true, false, false))
    }
}
