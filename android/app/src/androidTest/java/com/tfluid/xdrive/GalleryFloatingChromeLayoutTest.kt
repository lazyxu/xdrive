package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.GalleryAsset
import com.tfluid.xdrive.core.GalleryTimelineGroup
import com.tfluid.xdrive.core.GalleryTimelineSets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Real Compose bounds, not source-string checks. No external Owner/media reads. */
class GalleryFloatingChromeLayoutTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val controller = DriveController(scope)
    private val cache = LruCache<String, ImageBitmap>(4)
    private val photo = GalleryAsset(
        DriveNode(40, 1, "today.jpg", "file", size = 44, revision = 1),
        "image", hasThumbnail = false,
    )

    @After fun cleanup() {
        controller.close()
        scope.cancel()
    }

    private fun render(indexedTimeline: Boolean) {
        val timeline = if (indexedTimeline) GalleryTimelineSets(
            year = listOf(GalleryTimelineGroup("2026", 1, 0)),
            month = listOf(GalleryTimelineGroup("2026-10", 1, 0)),
            day = listOf(GalleryTimelineGroup("2026-10-27", 1, 0)),
        ) else null
        val state = DriveState(
            screen = Screen.GALLERY,
            galleryLoaded = true,
            galleryItems = listOf(photo),
            galleryTotal = 1,
            galleryTimelineSets = timeline,
        )
        compose.setContent {
            XDriveTheme {
                Column(Modifier.fillMaxSize()) {
                    Gallery(state, controller, cache)
                }
            }
        }
        compose.waitForIdle()
    }

    @Test fun indexedTimeAndPrimaryDocksOverlayWallWithoutCoveringLatestPhoto() {
        render(indexedTimeline = true)
        compose.onNodeWithTag("gallery-time-dock").assertIsDisplayed()
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
        compose.onNodeWithTag("gallery-item-40").assertIsDisplayed()
        val wall = compose.onNodeWithTag("gallery-grid").fetchSemanticsNode().boundsInRoot
        val time = compose.onNodeWithTag("gallery-time-dock").fetchSemanticsNode().boundsInRoot
        val dock = compose.onNodeWithTag("gallery-bottom-dock").fetchSemanticsNode().boundsInRoot
        val photoBounds = compose.onNodeWithTag("gallery-item-40")
            .fetchSemanticsNode().boundsInRoot
        assertTrue("time capsule must float inside gallery wall", time.top < wall.bottom - 8f)
        assertTrue("primary dock must float inside gallery wall", dock.top < wall.bottom - 8f)
        assertTrue("time capsule belongs above primary dock", time.bottom <= dock.top + 4f)
        assertTrue("latest photo must clear time capsule",
            photoBounds.bottom <= time.top + 16f)
    }

    @Test fun unavailableServerIndexKeepsOnlyRealFloatingPrimaryDock() {
        render(indexedTimeline = false)
        compose.onNodeWithTag("gallery-time-dock").assertDoesNotExist()
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
        val wall = compose.onNodeWithTag("gallery-grid").fetchSemanticsNode().boundsInRoot
        val dock = compose.onNodeWithTag("gallery-bottom-dock").fetchSemanticsNode().boundsInRoot
        assertTrue("primary dock must float over scrolling wall", dock.top < wall.bottom - 8f)
    }
}
