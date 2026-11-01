package com.tfluid.xdrive

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

/** Live Compose backup controls: no fabricated scans, receipts or worker resumes. */
class NativePhotoAutoStatusUiTest {
    @get:Rule val compose = createComposeRule()
    private val owner = DriveState(
        screen = Screen.GALLERY, nativeUiSessionId = 23,
        nativePhotoDeviceVerified = true,
    )

    @Test fun blockedStatesAreShownWithoutAnAutomaticRetryButton() {
        var lastStatus by mutableStateOf(AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION)
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(owner, true, {}, {}, {}, {},
                    autoConfigured = true, autoStatus = lastStatus)
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-auto-requires-session")
            .performScrollTo().assertIsDisplayed()
        compose.runOnIdle {
            lastStatus = AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_PERMISSION
        }
        compose.onNodeWithTag("native-photo-auto-requires-session").assertDoesNotExist()
        compose.onNodeWithTag("native-photo-auto-requires-permission")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("native-photo-batch-confirm-open")
            .performScrollTo().assertExists()
    }

    @Test fun foregroundBatchActivityIsIndeterminateAndDoesNotClaimCompleted() {
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(
                    owner.copy(nativePhotoBatchRunning = true,
                        fileUploadActive = true,
                        nativePhotoBatchScanned = 3, nativePhotoBatchUploaded = 1),
                    true, {}, {}, {}, {},
                )
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-batch-active-indeterminate")
            .performScrollTo().assertExists()
        compose.onNodeWithTag("native-photo-batch-stop").performScrollTo().assertExists()
        compose.onNodeWithTag("native-photo-batch-confirm-open").assertDoesNotExist()
    }

    @Test fun previousScannedOnlyStateNeverImpersonatesFinishedBackup() {
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(owner, true, {}, {}, {}, {},
                    autoConfigured = true,
                    autoStatus = AndroidPhotoAutoPolicyStore.STATUS_SCANNED)
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-auto-scanned").performScrollTo()
            .assertTextContains("不代表全部照片或视频已备份", substring = true)
    }
}
