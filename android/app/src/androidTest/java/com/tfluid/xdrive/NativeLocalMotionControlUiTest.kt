package com.tfluid.xdrive

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Native explicit action: an XMP marker never claims playback success. */
class NativeLocalMotionControlUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun ordinaryStillHasNoFakeMotionAction() {
        compose.setContent {
            XDriveTheme {
                NativeLocalMotionControl(candidate = false, playing = false, onToggle = {})
            }
        }
        compose.onNodeWithTag("native-local-motion-toggle").assertDoesNotExist()
    }

    @Test fun motionCandidateCanEnterAndLeaveTheSameViewer() {
        var changes = 0
        compose.setContent {
            var playing by remember { mutableStateOf(false) }
            XDriveTheme {
                NativeLocalMotionControl(candidate = true, playing = playing, onToggle = {
                    changes++
                    playing = !playing
                })
            }
        }
        compose.onNodeWithTag("native-local-motion-toggle")
            .assertIsDisplayed().assertTextContains("尝试播放动态片段")
            .performClick()
        compose.onNodeWithTag("native-local-motion-toggle")
            .assertTextContains("返回静态照片").performClick()
        compose.runOnIdle { assertEquals(2, changes) }
    }
}
