package com.tfluid.xdrive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class NativeLocalMediaKindFilterUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun allPhotoVideoRemainReachableAt320dp() {
        var selected by mutableStateOf("")
        var calls = 0
        compose.setContent {
            XDriveTheme {
                Box(Modifier.width(320.dp)) {
                    NativeLocalMediaKindDock(selected, true) {
                        selected = it
                        calls++
                    }
                }
            }
        }
        compose.onNodeWithTag("native-local-kind-all").assertIsSelected()
        compose.onNodeWithTag("native-local-kind-image")
            .assertIsDisplayed().assertIsEnabled().performClick()
        compose.onNodeWithTag("native-local-kind-image").assertIsSelected()
        compose.onNodeWithTag("native-local-kind-video").performClick()
        compose.onNodeWithTag("native-local-kind-video").assertIsSelected()
        compose.onNodeWithTag("native-local-kind-all").performClick()
        compose.runOnIdle {
            assertEquals("", selected)
            assertEquals(3, calls)
        }
    }

    @Test fun busyQueryNeverAdmitsFilterSwitch() {
        compose.setContent {
            XDriveTheme { NativeLocalMediaKindDock("video", false) {} }
        }
        compose.onNodeWithTag("native-local-kind-video").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-kind-all").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-kind-image").assertIsNotEnabled()
    }
}
