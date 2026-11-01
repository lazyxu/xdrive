package com.tfluid.xdrive

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** The same native control switches L2 map and location-list modes. */
class NativeGalleryMapFocusUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun mapStartsFocusedAndCanSwitchToListAndBack() {
        var latest = true
        compose.setContent {
            var focused by remember { mutableStateOf(true) }
            XDriveTheme {
                NativeGalleryMapFocusToggle(
                    focused = focused,
                    onFocusChange = { focused = it; latest = it },
                )
            }
        }
        compose.onNodeWithText("收起地图，查看地点列表",
            useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("gallery-map-focus-toggle").performClick()
        compose.runOnIdle { assertFalse(latest) }
        compose.onNodeWithText("展开地图，专注浏览",
            useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("gallery-map-focus-toggle").performClick()
        compose.runOnIdle { assertTrue(latest) }
    }
}
