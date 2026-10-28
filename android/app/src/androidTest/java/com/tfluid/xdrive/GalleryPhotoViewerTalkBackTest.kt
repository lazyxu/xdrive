package com.tfluid.xdrive

import android.graphics.Bitmap
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.GalleryAsset
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Actual Compose image semantics, with one in-memory bounded local bitmap.
 * Deliberately does not fake authenticated Owner network responses or media
 * access just to test presentation-only TalkBack zoom. */
class GalleryPhotoViewerTalkBackTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val controller = DriveController(scope)
    private val photo = GalleryAsset(
        DriveNode(42, 1, "private.jpg", "file",
            size = 33L * 1024L * 1024L, revision = 2),
        "image", hasThumbnail = true,
    )
    private val cache = LruCache<String, ImageBitmap>(4).apply {
        put("42:2", Bitmap.createBitmap(4, 4,
            Bitmap.Config.ARGB_8888).asImageBitmap())
    }

    @After fun cleanup() { controller.close(); scope.cancel() }

    private fun render() {
        compose.setContent {
            XDriveTheme { GalleryPhotoViewer(photo, controller, cache) }
        }
        compose.onNodeWithTag("gallery-photo-image", useUnmergedTree = true)
            .assertExists()
    }

    private fun customActions() =
        compose.onNodeWithTag("gallery-photo-gesture", useUnmergedTree = true)
            .fetchSemanticsNode().config[SemanticsProperties.CustomActions]

    private fun zoomState() =
        compose.onNodeWithTag("gallery-photo-gesture", useUnmergedTree = true)
            .fetchSemanticsNode().config[SemanticsProperties.StateDescription]

    private fun performZoom(label: String) {
        val chosen = customActions().single { it.label == label }
        compose.runOnIdle { assertTrue(chosen.action()) }
        compose.waitForIdle()
    }

    @Test fun talkbackCanZoomRestoreWithoutNewNavigationWidgets() {
        render()
        assertEquals("图片缩放 100%", zoomState())
        assertTrue(customActions().any { it.label == "放大图片" })
        assertFalse(customActions().any { it.label == "缩小图片" })
        performZoom("放大图片")
        assertEquals("图片缩放 150%", zoomState())
        assertTrue(customActions().any { it.label == "缩小图片" })
        assertTrue(customActions().any { it.label == "恢复图片大小" })
        performZoom("放大图片")
        assertEquals("图片缩放 200%", zoomState())
        performZoom("缩小图片")
        assertEquals("图片缩放 150%", zoomState())
        performZoom("恢复图片大小")
        assertEquals("图片缩放 100%", zoomState())
        assertFalse(customActions().any { it.label == "恢复图片大小" })
        compose.onNodeWithTag("gallery-photo-close").assertExists()
        compose.onNodeWithTag("gallery-photo-info").assertExists()
    }

    @Test fun a11yZoomFiveTimesMaximumAndNoSpuriousOverscrollAction() {
        render()
        repeat(12) {
            if (customActions().any { it.label == "放大图片" })
                performZoom("放大图片")
        }
        assertEquals("图片缩放 500%", zoomState())
        assertFalse(customActions().any { it.label == "放大图片" })
        assertTrue(customActions().any { it.label == "恢复图片大小" })
    }
}
