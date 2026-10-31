package com.tfluid.xdrive

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * Real native permission CTA semantics without invoking OS permission UI.
 * Actual grant changes and Android Selected Photos system dialog require
 * physical-device permission acceptance; no permission is faked as granted.
 */
class NativeLocalMediaReselectUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun partialGrantOffersExplicitReselectionAndClearsAfterNewFullGrant() {
        val requests = AtomicInteger(0)
        compose.setContent {
            var fullGrant by remember { mutableStateOf(false) }
            XDriveTheme {
                NativeLocalMediaReselectAction(
                    sdkInt = 34, canReadAny = true,
                    fullImages = fullGrant, fullVideos = fullGrant,
                    onRequest = {
                        requests.incrementAndGet()
                        // Simulate observing the result after the OS callback.
                        fullGrant = true
                    },
                )
            }
        }
        compose.onNodeWithTag("native-local-reselect-media")
            .assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, requests.get()) }
        compose.onNodeWithTag("native-local-reselect-media").assertDoesNotExist()
    }

    @Test fun deniedAndOlderSdkNeverExposeTheReselectAction() {
        compose.setContent {
            XDriveTheme {
                NativeLocalMediaReselectAction(
                    sdkInt = 34, canReadAny = false,
                    fullImages = false, fullVideos = false, onRequest = {},
                )
                NativeLocalMediaReselectAction(
                    sdkInt = 33, canReadAny = true,
                    fullImages = true, fullVideos = false, onRequest = {},
                )
            }
        }
        compose.onNodeWithTag("native-local-reselect-media").assertDoesNotExist()
    }
}
