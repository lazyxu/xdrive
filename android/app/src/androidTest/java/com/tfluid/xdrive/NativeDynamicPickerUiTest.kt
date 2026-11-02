package com.tfluid.xdrive

import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.ui.platform.LocalConfiguration
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

    @Test fun landscapeTabsMarkExactlySelectedDestinationAndKeepDynamicLongPress() {
        val pickerOpens = AtomicInteger(0)
        val tabClicks = mutableListOf<NativeHomeTab>()
        compose.setContent {
            // Exercise the real 48dp landscape implementation under an
            // explicit orientation, even on the default portrait emulator.
            val landscape = Configuration(LocalConfiguration.current).apply {
                orientation = Configuration.ORIENTATION_LANDSCAPE
            }
            var current by remember { mutableStateOf(NativeHomeTab.FILES) }
            CompositionLocalProvider(LocalConfiguration provides landscape) {
                XDriveTheme {
                    NativeHomeBottomBar(
                        navigation = NativeHomeNavigation(
                            selected = current,
                            dynamicFeature = NativeDynamicFeature.TRANSFERS),
                        onSelect = { current = it; tabClicks += it },
                        onShowDynamicPicker = { pickerOpens.incrementAndGet() },
                    )
                }
            }
        }
        compose.onNodeWithTag("native-five-slot-bar").assertIsDisplayed()
        compose.onNodeWithTag("native-tab-files").assertIsSelected()
        compose.onNodeWithTag("native-tab-gallery").assertIsNotSelected()
        compose.onNodeWithTag("native-tab-dynamic").assertIsNotSelected()
        compose.onNodeWithTag("native-tab-gallery").performClick()
        compose.onNodeWithTag("native-tab-gallery").assertIsSelected()
        compose.onNodeWithTag("native-tab-files").assertIsNotSelected()
        compose.onNodeWithTag("native-tab-dynamic").performClick()
        compose.onNodeWithTag("native-tab-dynamic").assertIsSelected()
        compose.onNodeWithTag("native-tab-gallery").assertIsNotSelected()
        compose.onNodeWithTag("native-tab-dynamic").performTouchInput { longClick() }
        compose.runOnIdle {
            assertEquals(listOf(NativeHomeTab.GALLERY, NativeHomeTab.DYNAMIC), tabClicks)
            assertEquals(1, pickerOpens.get())
        }
    }

    @Test fun portraitDynamicSlotExposesItsActiveSelectionToAccessibility() {
        compose.setContent {
            XDriveTheme {
                NativeHomeBottomBar(
                    NativeHomeNavigation(
                        selected = NativeHomeTab.DYNAMIC,
                        dynamicFeature = NativeDynamicFeature.TRANSFERS),
                    onSelect = {},
                )
            }
        }
        compose.onNodeWithTag("native-five-slot-bar").assertIsDisplayed()
        compose.onNodeWithTag("native-tab-dynamic").assertIsSelected()
        compose.onNodeWithTag("native-tab-files").assertIsNotSelected()
    }

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
