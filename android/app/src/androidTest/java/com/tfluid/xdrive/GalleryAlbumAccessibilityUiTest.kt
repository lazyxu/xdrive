package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.GalleryAlbum
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Test actual Compose semantics without fabricating authenticated media bytes.
 * Both Owner album cards have no cover, so no Server GET is attempted. */
class GalleryAlbumAccessibilityUiTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val controller = DriveController(scope)
    private val first = GalleryAlbum("manual:family", "manual", "家庭照片", 2L, 3L, 1L)
    private val second = GalleryAlbum("manual:trips", "manual", "假期照片", 4L, 5L, 1L)

    @After fun dispose() { controller.close(); scope.cancel() }

    @Test fun multipleAlbumsHaveDistinctOpenAndMoreActionsInTheRealGrid() {
        compose.setContent {
            XDriveTheme {
                Column(Modifier.fillMaxSize()) {
                    GalleryCollections(
                        DriveState(
                            screen = Screen.GALLERY,
                            server = "https://drive.example/",
                            username = "owner",
                            galleryPrimaryTab = GalleryPrimaryTab.COLLECTIONS,
                            galleryAlbumsLoaded = true,
                            galleryAlbums = listOf(first, second),
                        ),
                        controller,
                        LruCache<String, ImageBitmap>(4),
                    )
                }
            }
        }
        compose.onNodeWithTag("gallery-albums-list").assertExists()
        compose.onNodeWithTag("gallery-manual-more-manual:family")
            .assertContentDescriptionEquals("更多操作：家庭照片")
        compose.onNodeWithTag("gallery-manual-more-manual:trips")
            .assertContentDescriptionEquals("更多操作：假期照片")
        val openFamily = compose.onNodeWithTag("gallery-album-item-manual:family",
            useUnmergedTree = true).fetchSemanticsNode().config[SemanticsActions.OnClick].label
        val openTrips = compose.onNodeWithTag("gallery-album-item-manual:trips",
            useUnmergedTree = true).fetchSemanticsNode().config[SemanticsActions.OnClick].label
        assertEquals("打开相册：家庭照片", openFamily)
        assertEquals("打开相册：假期照片", openTrips)

        compose.onNodeWithTag("gallery-manual-more-manual:family").performClick()
        compose.onNodeWithTag("gallery-manual-rename-manual:family").assertExists()
        compose.onNodeWithTag("gallery-manual-delete-manual:family").assertExists()
    }
}
