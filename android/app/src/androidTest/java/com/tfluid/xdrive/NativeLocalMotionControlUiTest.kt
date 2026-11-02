package com.tfluid.xdrive

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

/** A Motion Photo's hint follows transient hold; there is no persistent play toggle. */
class NativeLocalMotionControlUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun ordinaryStillHasNoFakeMotionAction() {
        compose.setContent {
            XDriveTheme {
                NativeLocalMotionControl(candidate = false, held = false)
            }
        }
        compose.onNodeWithTag("native-local-motion-hint").assertDoesNotExist()
        compose.onNodeWithTag("native-local-motion-toggle").assertDoesNotExist()
    }

    @Test fun motionCandidateHintReturnsToStillOnReleaseWithoutPersistentToggle() {
        val held = mutableStateOf(false)
        compose.setContent {
            XDriveTheme {
                NativeLocalMotionControl(candidate = true, held = held.value)
            }
        }
        compose.onNodeWithTag("native-local-motion-hint")
            .assertTextEquals("按住照片播放动态片段 · 松手停止")
        compose.onNodeWithTag("native-local-motion-toggle").assertDoesNotExist()
        compose.runOnIdle { held.value = true }
        compose.onNodeWithTag("native-local-motion-hint")
            .assertTextEquals("松手返回静态照片")
        compose.runOnIdle { held.value = false }
        compose.onNodeWithTag("native-local-motion-hint")
            .assertTextEquals("按住照片播放动态片段 · 松手停止")
        compose.onNodeWithTag("native-local-motion-toggle").assertDoesNotExist()
    }
}
