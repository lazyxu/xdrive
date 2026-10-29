package com.tfluid.xdrive

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.GalleryAsset
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test

/** Real Compose Dialog semantics; all selected items are synthetic Owner-only rows. */
class GallerySelectionReviewAccessibilityTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val controller = DriveController(scope)
    private val selected = (1L..101L).map { id ->
        GalleryAsset(
            DriveNode(id, 1, "photo-$id.jpg", "file", size = 40L, revision = 1),
            "image",
        )
    }
    private var selectedCount by mutableIntStateOf(101)
    private var busy by mutableStateOf(false)

    @After fun close() {
        controller.close()
        scope.cancel()
    }

    private fun start() {
        compose.setContent {
            XDriveTheme {
                GallerySelectionReviewDialog(
                    DriveState(
                        screen = Screen.GALLERY,
                        gallerySelectionMode = true,
                        gallerySelectedItems = selected.take(selectedCount),
                        loading = busy,
                    ),
                    controller,
                    onClose = {},
                )
            }
        }
    }

    @Test fun distinctRemovalLabelsAndPagerHaveAccessibleIdentity() {
        start()
        compose.onNodeWithTag("gallery-selection-review").assertExists()
        compose.onNodeWithTag("gallery-selection-remove-1")
            .assertContentDescriptionEquals("移除已选文件：photo-1.jpg")
        compose.onNodeWithTag("gallery-review-next")
            .assertContentDescriptionEquals("下一页，当前第 1 页，共 2 页")
            .assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-selection-remove-101")
            .assertContentDescriptionEquals("移除已选文件：photo-101.jpg")
        compose.onNodeWithTag("gallery-review-prev")
            .assertContentDescriptionEquals("上一页，当前第 2 页，共 2 页")
    }

    @Test fun shrinkingLastPageThenAddingItemDoesNotResurrectOldPage() {
        start()
        compose.onNodeWithTag("gallery-review-next").performClick()
        compose.onNodeWithTag("gallery-selection-remove-101").assertExists()
        compose.runOnIdle { selectedCount = 100 }
        compose.waitForIdle()
        compose.onNodeWithTag("gallery-review-next").assertIsNotEnabled()
        compose.runOnIdle { selectedCount = 101 }
        compose.waitForIdle()
        compose.onNodeWithTag("gallery-selection-remove-1").assertExists()
        compose.onNodeWithTag("gallery-selection-remove-101").assertDoesNotExist()
    }

    @Test fun metadataWriteDisablesRemovalAndPagination() {
        start()
        compose.runOnIdle { busy = true }
        compose.onNodeWithTag("gallery-selection-remove-1").assertIsNotEnabled()
        compose.onNodeWithTag("gallery-review-next").assertIsNotEnabled()
        compose.onNodeWithTag("gallery-selection-review-close").assertIsNotEnabled()
        compose.runOnIdle { busy = false }
        compose.onNodeWithTag("gallery-selection-remove-1").assertIsEnabled()
        compose.onNodeWithTag("gallery-review-next").assertIsEnabled()
    }
}
