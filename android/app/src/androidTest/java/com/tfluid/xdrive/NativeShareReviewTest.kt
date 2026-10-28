package com.tfluid.xdrive

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.DriveNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

/** User acknowledgement is not an automatic UploadSession: the UI can
 * expose only a real Owner folder after navigating to Files/Browse. */
class NativeShareReviewTest {
    @get:Rule val compose = createComposeRule()

    private val incoming = NativeIncomingShare(
        Uri.parse("content://photos.example/document/42"),
        ShareOwnerIdentity("https://drive.example", "owner"),
    )
    private fun state() = DriveState(
        screen = Screen.FILES, server = "https://drive.example",
        username = "owner", loaded = true,
        path = listOf(DriveNode(1, name = "", type = "dir", revision = 1)),
    )

    @Test fun realFolderRequiresSingleExplicitConfirmToInvokeCallback() {
        var confirmations = 0
        var received: NativeShareTarget? = null
        var dismissals = 0
        compose.setContent {
            XDriveTheme {
                Box(Modifier.fillMaxSize()) {
                    NativeShareReview(incoming, state(), false, null,
                        onDismiss = { dismissals++ },
                        onConfirm = { target -> confirmations++; received = target })
                }
            }
        }
        compose.onNodeWithTag("native-share-confirm-dialog").assertExists()
        compose.onNodeWithTag("native-share-confirm").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(0, confirmations)
            assertEquals(0, dismissals)
        }
        compose.onNodeWithTag("native-share-confirm").performClick()
        compose.runOnIdle {
            assertEquals(1, confirmations)
            assertEquals(1L, received?.folderId)
            assertEquals("https://drive.example", received?.identity?.server)
        }
    }

    @Test fun wrongOwnerOrNonBrowseNeverOffersConfirmButton() {
        for (denied in listOf(
            state().copy(username = "someone-else"),
            state().copy(screen = Screen.GALLERY),
            state().copy(filesSection = FilesSection.FAVORITES),
            state().copy(fileDownloadActive = true),
        )) {
            var confirmations = 0
            compose.setContent {
                XDriveTheme {
                    Box(Modifier.fillMaxSize()) {
                        NativeShareReview(incoming, denied, false, null,
                            onDismiss = {}, onConfirm = { confirmations++ })
                    }
                }
            }
            compose.onNodeWithTag("native-share-not-ready").assertExists()
            compose.onNodeWithTag("native-share-confirm").assertDoesNotExist()
            compose.runOnIdle { assertEquals(0, confirmations) }
        }
    }
}
