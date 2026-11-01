package com.tfluid.xdrive

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Native opt-in control: no network, WebView or Server connection in test. */
class NativeLocalOsmToggleUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun localMapNeverMountsPublicTilesUntilUserEnablesThem() {
        var enabled by mutableStateOf(false)
        var taps = 0
        compose.setContent {
            MaterialTheme {
                NativeLocalOsmToggle(enabled) {
                    enabled = !enabled
                    taps++
                }
            }
        }
        compose.onNodeWithTag("native-local-osm-toggle").assertExists()
        compose.onNodeWithText("启用 OSM 底图").performClick()
        compose.runOnIdle { assertEquals(true, enabled) }
        compose.onNodeWithText("关闭 OSM 底图").performClick()
        compose.runOnIdle {
            assertEquals(false, enabled)
            assertEquals(2, taps)
        }
    }
}
