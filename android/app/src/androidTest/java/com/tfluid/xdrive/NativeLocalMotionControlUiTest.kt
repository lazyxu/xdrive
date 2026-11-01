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
        // Material3 TextButton's testTag identifies the actionable surface;
        // its text is a descendant and does not live on that tag's semantics
        // node. Assert text from the real Text composable, then click the
        // native button surface instead of assuming merged semantics.
        compose.onNodeWithText("尝试播放动态片段（也可长按照片）",
            useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("native-local-motion-toggle").performClick()
        compose.onNodeWithText("返回静态照片",
            useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("native-local-motion-toggle").performClick()
        compose.runOnIdle { assertEquals(2, changes) }
    }
}
