package com.tfluid.xdrive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryTimelineGroup
import com.tfluid.xdrive.core.GalleryTimelineSets
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Actual native day chip stays reachable on a narrow 320dp phone. */
class NativeGalleryTimeDockUiTest {
    @get:Rule val compose = createComposeRule()

    private val groups = GalleryTimelineSets(
        year = listOf(GalleryTimelineGroup("2026", 5, 0)),
        month = listOf(GalleryTimelineGroup("2026-10", 5, 0)),
        day = listOf(GalleryTimelineGroup("2026-10-30", 5, 0)),
    )

    @Test fun dayChipExistsAndSelectsTheExistingDayIndex() {
        var selected = "all"
        compose.setContent {
            var scale by remember { mutableStateOf("all") }
            MaterialTheme {
                Box(Modifier.width(320.dp)) {
                    NativeGalleryTimeScaleDock(
                        groups, scale, busy = false,
                        onSelect = { scale = it; selected = it },
                    )
                }
            }
        }
        compose.onNodeWithTag("gallery-time-scale-year").assertExists()
        compose.onNodeWithTag("gallery-time-scale-month").assertExists()
        compose.onNodeWithTag("gallery-time-scale-day").assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-time-scale-day").assertIsSelected()
        compose.onNodeWithTag("gallery-time-scale-all").assertExists()
        compose.runOnIdle { assertEquals("day", selected) }
    }

    @Test fun absentDayIndexCannotBeSelectedAsIfIndexed() {
        compose.setContent {
            MaterialTheme {
                NativeGalleryTimeScaleDock(groups.copy(day = emptyList()), "all",
                    busy = false, onSelect = {})
            }
        }
        compose.onNodeWithTag("gallery-time-scale-day").assertIsNotEnabled()
        compose.onNodeWithTag("gallery-time-scale-month").assertIsEnabled()
    }
}
