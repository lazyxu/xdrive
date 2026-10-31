package com.tfluid.xdrive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Only a real explicit tap may request registration or original writes. */
class NativePhotoBatchControlsUiTest {
    @get:Rule val compose = createComposeRule()
    private val ready = DriveState(screen = Screen.GALLERY, nativeUiSessionId = 17)

    @Test fun selectedOnlyPermissionAndUnverifiedDeviceNeverStartBatch() {
        val asks = AtomicInteger(0)
        val registrations = AtomicInteger(0)
        val uploads = AtomicInteger(0)
        compose.setContent {
            XDriveTheme {
                Box(Modifier.fillMaxSize()) {
                    NativePhotoBatchControls(
                        ready, fullReadGrant = false,
                        onRequestReadGrant = { asks.incrementAndGet() },
                        onEnrollDevice = { registrations.incrementAndGet() },
                        onStartBatch = { uploads.incrementAndGet() },
                        onCancelBatch = {},
                    )
                }
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-photo-batch-request-permission")
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-photo-batch-register-device")
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-photo-batch-register-cancel").performClick()
        compose.onNodeWithTag("native-photo-batch-register-device").performClick()
        compose.onNodeWithTag("native-photo-batch-register-confirm").performClick()
        compose.onNodeWithTag("native-photo-batch-confirm-open").assertIsNotEnabled()
        compose.runOnIdle {
            assertEquals(1, asks.get())
            assertEquals(1, registrations.get())
            assertEquals(0, uploads.get())
        }
    }

    @Test fun onlyExplicitSecondConfirmationStartsBoundedNextBatch() {
        val starts = AtomicInteger(0)
        val after = AtomicLong(-1)
        var granted by mutableStateOf(true)
        var state by mutableStateOf(ready.copy(
            nativePhotoDeviceVerified = true,
            nativePhotoBatchScanned = 64,
            nativePhotoBatchUploaded = 8,
            nativePhotoBatchNextAfterId = 500,
        ))
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(
                    state, fullReadGrant = granted,
                    onRequestReadGrant = {},
                    onEnrollDevice = {},
                    onStartBatch = { cursor ->
                        starts.incrementAndGet()
                        after.set(cursor)
                    },
                    onCancelBatch = {},
                )
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-batch-progress").assertIsDisplayed()
        compose.onNodeWithTag("native-photo-batch-confirm-open")
            .assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(0, starts.get()) }
        compose.onNodeWithTag("native-photo-batch-start-cancel").performClick()
        compose.runOnIdle { assertEquals(0, starts.get()) }

        compose.onNodeWithTag("native-photo-batch-confirm-open").performClick()
        compose.onNodeWithTag("native-photo-batch-start-confirm").performClick()
        compose.runOnIdle {
            assertEquals(1, starts.get())
            assertEquals(500L, after.get())
            state = state.copy(screen = Screen.LOGIN, nativeUiSessionId = 0)
        }
        compose.onNodeWithTag("native-photo-batch-open").assertDoesNotExist()
    }

    @Test fun runningForegroundUploadCanStopButNotOpenAnotherWriter() {
        val cancels = AtomicInteger(0)
        var state by mutableStateOf(ready.copy(
            nativePhotoDeviceVerified = true, fileUploadActive = true,
            nativePhotoBatchScanned = 3, nativePhotoBatchUploaded = 1,
        ))
        compose.setContent {
            XDriveTheme {
                NativePhotoBatchControls(
                    state, fullReadGrant = true,
                    onRequestReadGrant = {},
                    onEnrollDevice = {},
                    onStartBatch = { error("Concurrent writer") },
                    onCancelBatch = { cancels.incrementAndGet() },
                )
            }
        }
        compose.onNodeWithTag("native-photo-batch-open").performClick()
        compose.onNodeWithTag("native-photo-batch-stop").assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-photo-batch-confirm-open").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(1, cancels.get())
            state = state.copy(fileUploadActive = false)
        }
        compose.onNodeWithTag("native-photo-batch-stop").assertDoesNotExist()
    }
}
