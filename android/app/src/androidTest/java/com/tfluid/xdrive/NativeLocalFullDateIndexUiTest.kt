package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Native modal dates are authorized keyset jumps, not a fabricated year list. */
class NativeLocalFullDateIndexUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun selectedMonthBeyondCurrent512TilesHasRealKeysetAnchor() {
        val after = NativeLocalPageKey(1728000L, 811L)
        val group = NativeLocalFullDateGroup(
            "2023-09", "2023年9月", 1536, 52, after)
        val index = NativeLocalFullDateIndex(
            years = emptyList(), months = listOf(group), days = emptyList(),
            scanned = 5000, complete = true, groupBudgetHit = false)
        var chosen: NativeLocalFullDateGroup? = null
        compose.setContent {
            XDriveTheme {
                NativeLocalFullDatePicker("month", index, {}, { chosen = it })
            }
        }
        compose.onNodeWithTag("native-local-full-date-picker").assertExists()
        compose.onNodeWithTag("native-local-full-date-coverage")
            .assertTextContains("5000 项", substring = true)
        compose.onNodeWithTag("native-local-full-date-group-2023-09").performClick()
        compose.runOnIdle {
            assertEquals(1536, chosen?.firstIndex)
            assertEquals(after, chosen?.before)
        }
    }

    @Test fun truncatedIndexNeverClaimsCompleteMediaLibrary() {
        val index = NativeLocalFullDateIndex(
            years = listOf(NativeLocalFullDateGroup("2026", "2026年", 0, 1, null)),
            months = emptyList(), days = emptyList(),
            scanned = 115200, complete = false, groupBudgetHit = false)
        compose.setContent {
            XDriveTheme { NativeLocalFullDatePicker("year", index, {}, {}) }
        }
        compose.onNodeWithTag("native-local-full-date-coverage")
            .assertTextContains("更多日期尚未覆盖", substring = true)
    }
}
