package com.tfluid.xdrive

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.window.Dialog
import org.junit.Rule
import org.junit.Test

/**
 * Actual native clickable source tile and Dialog focus lifecycle.
 * Uses a synthetic row rather than reading another user's device gallery.
 */
class NativeLocalViewerReturnFocusUiTest {
    @get:Rule val compose = createComposeRule()
    private val media = NativeLocalMedia(
        id = 21L,
        uri = Uri.parse("content://media/external/images/media/21"),
        isVideo = false,
        albumId = "camera",
        albumName = "Camera",
        addedAtSeconds = 2000,
    )

    @Test fun dismissingViewerRestoresInputFocusToItsExactNativeSourceTile() {
        compose.setContent {
            var viewerOpen by remember { mutableStateOf(false) }
            var returnToTile by remember { mutableStateOf(false) }
            XDriveTheme {
                Column {
                    NativeLocalPhotoWallTile(
                        asset = media,
                        restoreFocus = returnToTile && !viewerOpen,
                        onOpen = { returnToTile = false; viewerOpen = true },
                        onFocusRestored = { returnToTile = false },
                        tileContent = { Text("测试照片") },
                    )
                    if (viewerOpen) Dialog(onDismissRequest = {
                        viewerOpen = false
                        returnToTile = true
                    }) {
                        Surface {
                            TextButton(onClick = {
                                viewerOpen = false
                                returnToTile = true
                            }, modifier = Modifier.testTag("fixture-viewer-close")) {
                                Text("返回")
                            }
                        }
                    }
                }
            }
        }
        compose.onNodeWithTag("native-local-media-21").performClick()
        compose.onNodeWithTag("fixture-viewer-close").assertIsDisplayed().performClick()
        // The real Dialog and returning source tile exchange focus across
        // Compose frames. Keep a bounded assertion on ACTUAL input focus.
        compose.waitUntil(timeoutMillis = 5_000) {
            runCatching {
                compose.onNodeWithTag("native-local-media-21").assertIsFocused()
            }.isSuccess
        }
        compose.onNodeWithTag("native-local-media-21").assertIsFocused()
        compose.onNodeWithTag("fixture-viewer-close").assertDoesNotExist()
    }
}
