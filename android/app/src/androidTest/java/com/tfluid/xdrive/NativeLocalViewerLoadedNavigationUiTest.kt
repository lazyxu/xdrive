package com.tfluid.xdrive

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test

/**
 * Real native controls, no fake server or local MediaStore permissions.
 * The authenticated host supplies only indices from the bounded wall.
 */
class NativeLocalViewerLoadedNavigationUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun navigationButtonsMoveOneLoadedItemAndDisableAtBothEdges() {
        val rows = listOf(
            NativeLocalViewerItemKey(3L, false, "camera", 300L),
            NativeLocalViewerItemKey(2L, true, "camera", 200L),
            NativeLocalViewerItemKey(1L, false, "camera", 100L),
        )
        compose.setContent {
            var index by remember { mutableIntStateOf(0) }
            val previous = nativeLocalViewerNeighborIndex(rows, rows[index], -1)
            val next = nativeLocalViewerNeighborIndex(rows, rows[index], 1)
            XDriveTheme {
                NativeLocalViewerLoadedNavigation(
                    loadedPosition = index,
                    loadedCount = rows.size,
                    onPrevious = previous?.let { target -> ({ index = target }) },
                    onNext = next?.let { target -> ({ index = target }) },
                )
            }
        }
        compose.onNodeWithTag("native-local-viewer-previous").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-viewer-next").assertIsEnabled()
            .performClick()
        compose.onNodeWithTag("native-local-viewer-position")
            .assertTextEquals("2/3（已加载）")
        compose.onNodeWithTag("native-local-viewer-previous").assertIsEnabled()
        compose.onNodeWithTag("native-local-viewer-next").performClick()
        compose.onNodeWithTag("native-local-viewer-position")
            .assertTextEquals("3/3（已加载）")
        compose.onNodeWithTag("native-local-viewer-next").assertIsNotEnabled()
    }

    @Test fun evictedOrMissingCurrentItemNeverOffersFalseNeighbors() {
        compose.setContent {
            XDriveTheme {
                NativeLocalViewerLoadedNavigation(
                    loadedPosition = null, loadedCount = 2,
                    onPrevious = null, onNext = null)
            }
        }
        compose.onNodeWithTag("native-local-viewer-position")
            .assertTextEquals("当前媒体已变化")
        compose.onNodeWithTag("native-local-viewer-previous").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-viewer-next").assertIsNotEnabled()
    }
}
