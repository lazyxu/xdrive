package com.tfluid.xdrive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test

/**
 * Real passive INITIAL-pass hold detector, with an always-mounted still under
 * a conditional motion layer. No MediaStore grant, private photo or OEM MP4
 * codec is needed to check the actual pointer-up release contract.
 */
class NativeLocalMotionHoldUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun longPressStartsMotionAndReleaseReturnsExistingStill() {
        compose.setContent {
            var held by remember { mutableStateOf(false) }
            var trace by remember { mutableStateOf("") }
            XDriveTheme {
                Column {
                    Box(
                        Modifier.size(280.dp)
                            .galleryLivePhotoHold(
                                enabled = true,
                                sourceIdentity = "content://media/fixture/18",
                            ) { pressed ->
                                held = pressed
                                trace += if (pressed) "H" else "R"
                            }.testTag("local-motion-gesture"),
                    ) {
                        Text("静态图保留", Modifier.testTag("local-motion-still"))
                        if (held) Text("动态覆盖", Modifier.testTag("local-motion-overlay"))
                    }
                    Text(trace, Modifier.testTag("local-motion-trace"))
                    Text(if (held) "动态" else "静态", Modifier.testTag("local-motion-state"))
                }
            }
        }

        compose.onNodeWithTag("local-motion-gesture").performTouchInput { longClick() }
        compose.onNodeWithTag("local-motion-trace").assertTextEquals("HR")
        compose.onNodeWithTag("local-motion-state").assertTextEquals("静态")
        compose.onNodeWithTag("local-motion-overlay").assertDoesNotExist()
        compose.onNodeWithTag("local-motion-still").assertExists()
        // A tap never mints a motion intent, and a second real hold has its
        // own pair of start/stop events rather than reusing old player state.
        compose.onNodeWithTag("local-motion-gesture").performClick()
        compose.onNodeWithTag("local-motion-trace").assertTextEquals("HR")
        compose.onNodeWithTag("local-motion-gesture").performTouchInput { longClick() }
        compose.onNodeWithTag("local-motion-trace").assertTextEquals("HRHR")
    }

    @Test fun noMotionCandidateShowsNoPlayInstruction() {
        compose.setContent {
            XDriveTheme {
                Column {
                    NativeLocalMotionControl(candidate = false, held = false)
                    Text("普通静态图片", Modifier.testTag("ordinary-still"))
                }
            }
        }
        compose.onNodeWithTag("native-local-motion-hint").assertDoesNotExist()
        compose.onNodeWithTag("ordinary-still").assertExists()
    }

    @Test fun candidateHintNeverOffersPersistentToggle() {
        compose.setContent {
            XDriveTheme {
                NativeLocalMotionControl(candidate = true, held = false)
            }
        }
        compose.onNodeWithTag("native-local-motion-hint")
            .assertTextEquals("按住照片播放动态片段 · 松手停止")
        compose.onNodeWithTag("native-local-motion-toggle").assertDoesNotExist()
    }
}
