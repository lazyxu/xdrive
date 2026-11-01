package com.tfluid.xdrive

import android.content.ContentUris
import android.os.CancellationSignal
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Actual native Info dialog, supplied with one authorized row fixture only. */
class NativeLocalMediaInfoUiTest {
    @get:Rule val compose = createComposeRule()
    private val media = NativeLocalMedia(72L,
        ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, 72L),
        false, "camera", "Camera", 1700000000L)

    @Test fun onlyExplicitTapLoadsMetadataAndRendersRealCaptureLabel() {
        var reads = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalMediaInfoAction(media, reader = { _, _, _ ->
                    reads++
                    NativeLocalMediaInfo(
                        name = "picture.jpg", mime = "image/jpeg",
                        width = 1920, height = 1080, bytes = 456L,
                        takenAtMillis = 1699990000000L)
                })
            }
        }
        compose.runOnIdle { assertEquals(0, reads) }
        compose.onNodeWithTag("native-local-viewer-info").performClick()
        compose.onNodeWithTag("native-local-info-dialog").assertExists()
        compose.waitUntil(10_000) { reads == 1 }
        compose.onNodeWithTag("native-local-info-dimensions")
            .assertTextEquals("1920 × 1080 像素")
        compose.onNodeWithTag("native-local-info-taken").assertExists()
        compose.onNodeWithTag("native-local-info-close").performClick()
        compose.onNodeWithTag("native-local-info-dialog").assertDoesNotExist()
    }

    @Test fun failedSingleRowReadOffersExplicitRetryAndDoesNotAutoLoop() {
        var calls = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalMediaInfoAction(media, reader = { _, _, _ ->
                    calls++
                    if (calls == 1) error("MediaStore permission revoked")
                    NativeLocalMediaInfo(name = "recovered.jpg")
                })
            }
        }
        compose.onNodeWithTag("native-local-viewer-info").performClick()
        compose.onNodeWithTag("native-local-info-error").assertExists()
        compose.runOnIdle { assertEquals(1, calls) }
        compose.onNodeWithTag("native-local-info-retry").performClick()
        compose.onNodeWithTag("native-local-info-error").assertDoesNotExist()
        compose.runOnIdle { assertEquals(2, calls) }
    }

    @Test fun ineligibleOtherProviderDoesNotOfferInfoRead() {
        val bad = media.copy(uri = android.net.Uri.parse("content://foreign/item/72"))
        var reads = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalMediaInfoAction(bad, reader = { _, _, _ ->
                    reads++
                    NativeLocalMediaInfo()
                })
            }
        }
        compose.onNodeWithTag("native-local-viewer-info").assertIsNotEnabled()
        compose.onNodeWithTag("native-local-info-dialog").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, reads) }
    }
}
