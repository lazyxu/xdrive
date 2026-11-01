package com.tfluid.xdrive

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** The actual one-route native source selector, not a WebView or a mock layout. */
class NativeLocalPhotoMapSourceUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun localAndCloudUseOneGalleryMapSourceBar() {
        var chosen = "cloud"
        var local by mutableStateOf(false)
        compose.setContent {
            MaterialTheme {
                NativePhotoMapSourceBar(
                    localSelected = local,
                    onLocal = { local = true; chosen = "local" },
                    onCloud = { local = false; chosen = "cloud" },
                )
            }
        }
        compose.onNodeWithTag("native-photo-map-sources").assertExists()
        compose.onNodeWithTag("native-photo-map-source-local").performClick()
        compose.runOnIdle { assertEquals("local", chosen) }
        compose.onNodeWithTag("native-photo-map-source-cloud").performClick()
        compose.runOnIdle { assertEquals("cloud", chosen) }
    }
}
