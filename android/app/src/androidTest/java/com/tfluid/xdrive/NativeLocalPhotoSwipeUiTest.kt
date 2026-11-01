package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test

/**
 * Real one-finger Compose swipe detector; fixture only, no MediaStore grant
 * and no image bytes. Loaded boundaries use the same production callbacks.
 */
class NativeLocalPhotoSwipeUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun swipesAdvanceOneLoadedItemAndRespectEdgesAndZoom() {
        val page = listOf(
            NativeLocalViewerItemKey(31L, false, "camera", 300L),
            NativeLocalViewerItemKey(30L, false, "camera", 200L),
            NativeLocalViewerItemKey(29L, false, "camera", 100L),
        )
        compose.setContent {
            var index by remember { mutableIntStateOf(1) }
            var zoomed by remember { mutableStateOf(false) }
            val previous = nativeLocalViewerNeighborIndex(page, page[index], -1)
            val next = nativeLocalViewerNeighborIndex(page, page[index], 1)
            XDriveTheme {
                Column {
                    NativeLocalPhotoSwipeSurface(
                        mediaKey = page[index], zoomed = zoomed,
                        onPrevious = previous?.let { target -> ({ index = target }) },
                        onNext = next?.let { target -> ({ index = target }) },
                        modifier = Modifier.size(256.dp).testTag("local-swipe-fixture"),
                    ) { Text("预览") }
                    Text("$index", Modifier.testTag("local-swipe-index"))
                    TextButton(onClick = { zoomed = !zoomed },
                        modifier = Modifier.testTag("local-zoom-toggle")) {
                        Text("放大")
                    }
                }
            }
        }

        compose.onNodeWithTag("local-swipe-fixture").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("local-swipe-index").assertTextEquals("2")
        // At the final loaded item, no provider query or phantom fourth item.
        compose.onNodeWithTag("local-swipe-fixture").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("local-swipe-index").assertTextEquals("2")
        compose.onNodeWithTag("local-zoom-toggle").performClick()
        compose.onNodeWithTag("local-swipe-fixture").performTouchInput { swipeRight() }
        compose.onNodeWithTag("local-swipe-index").assertTextEquals("2")
        compose.onNodeWithTag("local-zoom-toggle").performClick()
        compose.onNodeWithTag("local-swipe-fixture").performTouchInput { swipeRight() }
        compose.onNodeWithTag("local-swipe-index").assertTextEquals("1")
        compose.onNodeWithTag("local-swipe-fixture").performTouchInput { swipeRight() }
        compose.onNodeWithTag("local-swipe-index").assertTextEquals("0")
        compose.onNodeWithTag("local-swipe-fixture").performTouchInput { swipeRight() }
        compose.onNodeWithTag("local-swipe-index").assertTextEquals("0")
    }
}
