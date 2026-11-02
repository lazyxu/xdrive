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
 * Actual shared INITIAL-pass Live Photo pointer recognizer with the cloud
 * Viewer's zoom/decoded-still gate. No Owner credentials, media bytes or
 * speculative motion GET are required for this gesture-only contract.
 */
class GalleryCloudLiveZoomHoldUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun zoomedCloudImageCannotStartLiveButASecondHoldAtOneXCan() {
        val zoom = mutableFloatStateOf(1f)
        val events = mutableStateOf("")
        compose.setContent {
            val allowed = galleryLivePhotoHoldAllowed(
                livePhoto = true, stillReady = true, zoom = zoom.floatValue)
            var held by remember { mutableStateOf(false) }
            XDriveTheme {
                Column {
                    Box(Modifier.size(256.dp)
                        .galleryLivePhotoHold(
                            enabled = allowed, sourceIdentity = "owner:42:rev3",
                        ) { pressing ->
                            held = pressing && allowed
                            events.value += if (pressing) "H" else "R"
                        }.testTag("cloud-live-hold-surface")) {
                        Text("已解码静态照片", Modifier.testTag("cloud-live-still"))
                    }
                    Text(if (held && allowed) "动态" else "静态",
                        Modifier.testTag("cloud-live-state"))
                    Text(events.value, Modifier.testTag("cloud-live-events"))
                }
            }
        }

        compose.onNodeWithTag("cloud-live-hold-surface")
            .performTouchInput { longClick() }
        compose.onNodeWithTag("cloud-live-events").assertTextEquals("HR")
        compose.onNodeWithTag("cloud-live-state").assertTextEquals("静态")

        compose.runOnIdle { zoom.floatValue = 2f }
        compose.onNodeWithTag("cloud-live-hold-surface")
            .performTouchInput { longClick() }
        compose.onNodeWithTag("cloud-live-events").assertTextEquals("HR")
        compose.onNodeWithTag("cloud-live-state").assertTextEquals("静态")
        compose.onNodeWithTag("cloud-live-still").assertExists()

        compose.runOnIdle { zoom.floatValue = 1f }
        compose.onNodeWithTag("cloud-live-hold-surface")
            .performTouchInput { longClick() }
        compose.onNodeWithTag("cloud-live-events").assertTextEquals("HRHR")
        compose.onNodeWithTag("cloud-live-state").assertTextEquals("静态")
    }

    @Test fun missingDecodedStillNeverStartsMotionEvenWithValidLiveMetadata() {
        val stillReady = mutableStateOf(false)
        val events = mutableStateOf("")
        compose.setContent {
            val allowed = galleryLivePhotoHoldAllowed(
                livePhoto = true, stillReady = stillReady.value, zoom = 1f)
            XDriveTheme {
                Column {
                    Box(Modifier.size(256.dp)
                        .galleryLivePhotoHold(
                            enabled = allowed, sourceIdentity = "owner:42:rev3",
                        ) { pressed ->
                            events.value += if (pressed) "H" else "R"
                        }.testTag("cloud-live-unready-surface")) {
                        Text("静态媒体待加载", Modifier.testTag("cloud-live-placeholder"))
                    }
                    Text(events.value, Modifier.testTag("cloud-live-unready-events"))
                }
            }
        }
        compose.onNodeWithTag("cloud-live-unready-surface")
            .performTouchInput { longClick() }
        compose.onNodeWithTag("cloud-live-unready-events").assertTextEquals("")
        compose.runOnIdle { stillReady.value = true }
        compose.onNodeWithTag("cloud-live-unready-surface")
            .performTouchInput { longClick() }
        compose.onNodeWithTag("cloud-live-unready-events").assertTextEquals("HR")
    }
}
