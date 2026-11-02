package com.tfluid.xdrive

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.UUID

/** Emulator-backed MediaStore Viewer flow; this is not physical OEM-provider acceptance. */
class NativeLocalMediaStoreViewerUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun realMediaStorePhotoOpensBoundedOriginalViewerAndReturnsToItsTile() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val resolver = context.contentResolver
        val permission = Manifest.permission.READ_MEDIA_IMAGES
        val hadPermission = context.checkSelfPermission(permission) ==
            PackageManager.PERMISSION_GRANTED
        val automation = instrumentation.uiAutomation
        var uri: android.net.Uri? = null
        var bitmap: Bitmap? = null
        var composed = false
        val showGallery = mutableStateOf(true)

        try {
            if (!hadPermission)
                automation.grantRuntimePermission(context.packageName, permission)

            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME,
                    "xdrive-local-viewer-${UUID.randomUUID()}.jpg")
                put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/xDriveViewerTests")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            assertNotNull("MediaStore must create the test image", uri)

            bitmap = Bitmap.createBitmap(64, 48, Bitmap.Config.ARGB_8888)
            resolver.openOutputStream(requireNotNull(uri), "w").use { output ->
                assertNotNull("MediaStore must open the pending image", output)
                assertTrue(requireNotNull(bitmap).compress(
                    Bitmap.CompressFormat.JPEG, 90, requireNotNull(output)))
            }
            bitmap?.recycle()
            bitmap = null

            val publish = ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
            }
            assertEquals(1, resolver.update(requireNotNull(uri), publish, null, null))
            val mediaId = ContentUris.parseId(requireNotNull(uri))
            val tileTag = "native-local-media-$mediaId"

            compose.setContent {
                if (showGallery.value) {
                    XDriveTheme {
                        NativeLocalMediaStoreGallery(
                            albumsOnly = false,
                            sessionId = 991L,
                        )
                    }
                }
            }
            composed = true
            compose.waitUntil(timeoutMillis = 10_000) {
                compose.onAllNodesWithTag(tileTag).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag(tileTag).assertExists().performClick()

            compose.waitUntil(timeoutMillis = 10_000) {
                compose.onAllNodesWithTag("native-local-viewer")
                    .fetchSemanticsNodes().isNotEmpty() &&
                    compose.onAllNodesWithContentDescription("本机照片原件适屏预览")
                        .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("native-local-viewer").assertExists()
            compose.onNodeWithContentDescription("本机照片原件适屏预览").assertExists()
            compose.onNodeWithTag("native-local-viewer-position").assertExists()

            compose.onNodeWithTag("native-local-viewer-back").performClick()
            compose.waitUntil(timeoutMillis = 10_000) {
                compose.onAllNodesWithTag("native-local-viewer")
                    .fetchSemanticsNodes().isEmpty() &&
                    compose.onAllNodesWithTag(tileTag).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag(tileTag).assertExists()
        } finally {
            if (composed) runCatching {
                compose.runOnIdle { showGallery.value = false }
                compose.waitForIdle()
            }
            bitmap?.recycle()
            uri?.let { runCatching { resolver.delete(it, null, null) } }
            if (!hadPermission) runCatching {
                automation.revokeRuntimePermission(context.packageName, permission)
            }
        }
    }
}
