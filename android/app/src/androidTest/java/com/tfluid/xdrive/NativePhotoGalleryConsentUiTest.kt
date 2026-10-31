package com.tfluid.xdrive

import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** L3 local Viewer exposes a deliberate backup request; no implicit upload. */
class NativePhotoGalleryConsentUiTest {
    @get:Rule val compose = createComposeRule()
    private val asset = NativeLocalMedia(
        id = 21L,
        uri = Uri.parse("content://media/external/images/media/21"),
        isVideo = false,
        albumId = "local",
        albumName = "Photos",
    )

    @Test fun selectedOriginalShowsExplicitActionOnlyWhenHostProvidesIt(): Unit {
        val requested = AtomicInteger(0)
        compose.setContent {
            XDriveTheme {
                NativeLocalMediaViewer(
                    asset = asset,
                    onDismiss = {},
                    onBackupOriginal = { requested.incrementAndGet() },
                )
            }
        }
        compose.onNodeWithTag("native-local-backup-request")
            .assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, requested.get()) }
    }

    @Test fun readOnlyViewerWithoutHostCallbackCannotPretendBackupWorks(): Unit {
        compose.setContent {
            XDriveTheme {
                NativeLocalMediaViewer(asset = asset, onDismiss = {})
            }
        }
        compose.onNodeWithTag("native-local-viewer").assertExists()
        compose.onNodeWithTag("native-local-backup-request").assertDoesNotExist()
    }
}
