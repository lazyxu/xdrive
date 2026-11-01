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

/** Real native four-scale control and loaded-only date picker at 320dp. */
class NativeLocalDateWindowUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun fourScalesRemainReachableOnNarrowPhone() {
        var request = ""
        compose.setContent {
            XDriveTheme {
                Box(Modifier.width(320.dp)) {
                    NativeLocalDateWindowDock("all", true) { request = it }
                }
            }
        }
        for (scale in listOf("year", "month", "day", "all"))
            compose.onNodeWithTag("native-local-date-scale-" + scale).assertIsEnabled()
        compose.onNodeWithTag("native-local-date-scale-day").performClick()
        compose.runOnIdle { assertEquals("day", request) }
        compose.onNodeWithTag("native-local-date-scale-all").assertIsSelected()
    }

    @Test fun pickerOpensOnlyAuthorizedLoadedGroupAndShowsLimitedCoverage() {
        var chosen = -1
        val groups = listOf(
            NativeLocalDateWindowGroup("2026-11", "2026年11月", 0, 12),
            NativeLocalDateWindowGroup("2026-10", "2026年10月", 12, 4),
        )
        compose.setContent {
            XDriveTheme {
                NativeLocalDateWindowPicker("month", groups, 16,
                    onDismiss = {}, onChoose = { chosen = it.firstIndex })
            }
        }
        compose.onNodeWithTag("native-local-date-picker-scope")
            .assertTextContains("仅当前已加载的 16 项", substring = true)
        compose.onNodeWithTag("native-local-date-group-2026-10").performClick()
        compose.runOnIdle { assertEquals(12, chosen) }
    }

    @Test fun disabledDockDoesNotPretendDateIndexExists() {
        compose.setContent {
            XDriveTheme { NativeLocalDateWindowDock("all", false) {} }
        }
        compose.onNodeWithTag("native-local-date-scale-year").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-date-scale-day").assertIsNotEnabled()
    }
}
