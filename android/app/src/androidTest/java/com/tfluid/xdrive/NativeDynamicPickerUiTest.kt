package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Native accessibility + touch entry points, no WebView or fabricated Server route. */
class NativeDynamicPickerUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun longPressSlotAndLauncherExposeTheSamePicker() {
        val opened = AtomicInteger(0)
        compose.setContent {
            XDriveTheme {
                Column(Modifier.fillMaxSize()) {
                    NativeHomeBottomBar(NativeHomeNavigation(), onSelect = {},
                        onShowDynamicPicker = { opened.incrementAndGet() })
                    Box(Modifier.weight(1f)) {
                        NativeHomeLauncher(NativeHomeNavigation(), "", {}, {}, {},
                            onChooseDynamic = { opened.incrementAndGet() })
                    }
                }
            }
        }
        // The bottom bar must not consume the entire portrait viewport:
        // both the long-press slot AND underlying Launcher must be displayed.
        compose.onNodeWithTag("native-tab-dynamic").assertIsDisplayed()
        compose.onNodeWithTag("native-launcher-dynamic-picker").assertIsDisplayed()
        compose.onNodeWithTag("native-tab-dynamic").performTouchInput { longClick() }
        compose.runOnIdle { assertEquals(1, opened.get()) }
        compose.onNodeWithTag("native-launcher-dynamic-picker").performClick()
        compose.runOnIdle { assertEquals(2, opened.get()) }
    }
}
