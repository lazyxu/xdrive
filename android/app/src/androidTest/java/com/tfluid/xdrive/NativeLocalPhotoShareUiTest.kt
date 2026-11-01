package com.tfluid.xdrive

import android.content.ContentUris
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Actual Android intent/ClipData and native Viewer action; no external share. */
class NativeLocalPhotoShareUiTest {
    @get:Rule val compose = createComposeRule()
    private fun photo(id: Long = 20L, video: Boolean = false) =
        NativeLocalMedia(
            id, ContentUris.withAppendedId(
                if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id),
            video, "camera", "Camera", 1700000000L)

    @Test fun sharesExactlyOneOriginalWithTemporaryReadGrant() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for (video in listOf(false, true)) {
            val source = photo(video = video)
            assertTrue(nativeLocalPhotoShareEligible(source))
            val intent = requireNotNull(nativeLocalPhotoShareIntent(context, source))
            assertEquals(Intent.ACTION_SEND, intent.action)
            assertEquals(if (video) "video/*" else "image/*", intent.type)
            assertEquals(source.uri, intent.getParcelableExtra(Intent.EXTRA_STREAM))
            assertEquals(source.uri, intent.clipData?.getItemAt(0)?.uri)
            assertEquals(1, intent.clipData?.itemCount)
            assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
            assertFalse(intent.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0)
            assertNull(intent.getStringExtra(Intent.EXTRA_TEXT))
        }
    }

    @Test fun rejectsOtherSchemeWrongCollectionOrRecycledId() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val good = photo()
        for (bad in listOf(
            good.copy(id = 0),
            good.copy(uri = Uri.parse("file:///tmp/private.jpg")),
            good.copy(uri = Uri.parse("https://example.org/photo.jpg")),
            good.copy(uri = Uri.parse("content://foreign.provider/image/20")),
            good.copy(uri = ContentUris.withAppendedId(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI, 20)),
            good.copy(id = 21),
            good.copy(uri = Uri.parse(good.uri.toString() + "?other=1"))
        )) {
            assertFalse(nativeLocalPhotoShareEligible(bad))
            assertNull(nativeLocalPhotoShareIntent(context, bad))
        }
    }

    @Test fun requiresTapAndSharesOnlyChosenCurrentlyVisiblePhoto() {
        val selected = photo()
        val calls = mutableListOf<NativeLocalMedia>()
        compose.setContent {
            XDriveTheme {
                NativeLocalPhotoShareAction(selected, onShare = {
                    calls += it
                    true
                })
            }
        }
        compose.runOnIdle { assertTrue(calls.isEmpty()) }
        compose.onNodeWithTag("native-local-viewer-share")
            .assertIsEnabled().performClick()
        compose.runOnIdle {
            assertEquals(listOf(selected), calls)
        }
        compose.onNodeWithTag("native-local-viewer-share-error").assertDoesNotExist()
    }

    @Test fun unsupportedUriDisablesShareAndFailedChooserShowsRecoverableError() {
        val bad = photo().copy(uri = Uri.parse("file:///sdcard/picture.jpg"))
        compose.setContent {
            XDriveTheme { NativeLocalPhotoShareAction(bad, onShare = { true }) }
        }
        compose.onNodeWithTag("native-local-viewer-share").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-viewer-share-error").assertDoesNotExist()
    }

    @Test fun shareFailureIsVisibleWithoutClaimingBackupOrChangingMedia() {
        compose.setContent {
            XDriveTheme {
                NativeLocalPhotoShareAction(photo(), onShare = { false })
            }
        }
        compose.onNodeWithTag("native-local-viewer-share").performClick()
        compose.onNodeWithTag("native-local-viewer-share-error").assertExists()
    }
}
