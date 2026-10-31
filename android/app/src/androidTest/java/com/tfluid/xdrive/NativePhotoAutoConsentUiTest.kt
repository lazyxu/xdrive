package com.tfluid.xdrive

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** A periodic WorkManager grant needs distinct explicit native confirmation. */
class NativePhotoAutoConsentUiTest {
    @get:Rule val compose = createComposeRule()
    private val ready = DriveState(
        screen = Screen.GALLERY, nativeUiSessionId = 8,
        nativePhotoDeviceVerified = true)

    @Test fun selectedMediaOnlyAndUnregisteredDeviceCannotEnableAuto() {
        var enabled = 0
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(ready.copy(nativePhotoDeviceVerified = false),
                    fullReadGrant = false, onRequestReadGrant = {},
                    onEnrollDevice = {}, onStartBatch = {}, onCancelBatch = {},
                    onEnableAuto = { enabled++ })
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-auto-enable")
            .performScrollTo().assertIsDisplayed().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, enabled) }
    }

    @Test fun confirmedOptInAndOptOutAreSeparateFromManualOriginalUpload() {
        var enableCount = 0
        var disableCount = 0
        var manualCount = 0
        var active by mutableStateOf(false)
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(ready, true, {}, {}, { manualCount++ }, {},
                    autoConfigured = active,
                    onEnableAuto = { enableCount++; active = true },
                    onDisableAuto = { disableCount++; active = false })
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-auto-enable").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0, enableCount) }
        compose.onNodeWithTag("native-photo-auto-enable-cancel").performClick()
        compose.runOnIdle { assertEquals(0, enableCount) }

        compose.onNodeWithTag("native-photo-auto-enable").performScrollTo().performClick()
        compose.onNodeWithTag("native-photo-auto-enable-confirm").performClick()
        compose.onNodeWithTag("native-photo-auto-disable").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, enableCount) }

        compose.onNodeWithTag("native-photo-auto-disable").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0, disableCount) }
        compose.onNodeWithTag("native-photo-auto-disable-confirm").performClick()
        compose.onNodeWithTag("native-photo-auto-enable").performScrollTo().assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(1, disableCount)
            assertEquals(0, manualCount)
        }
    }

    @Test fun logoutDisposesQueuedConsentWithoutScheduling() {
        var enabled = 0
        var session by mutableStateOf(ready)
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(session, true, {}, {}, {}, {},
                    onEnableAuto = { enabled++ })
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-auto-enable").performScrollTo().performClick()
        compose.runOnIdle { session = DriveState(screen = Screen.LOGIN) }
        compose.onNodeWithTag("native-photo-auto-enable-confirm").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, enabled) }
    }

    @Test fun manualUploadCannotGrantWorkManagerConsent() {
        var enabled = 0
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(
                    ready.copy(fileUploadActive = true), true,
                    {}, {}, {}, {}, onEnableAuto = { enabled++ })
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-auto-enable").performScrollTo().assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, enabled) }
    }
}
