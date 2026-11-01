package com.tfluid.xdrive

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** UI shows a retry only when the existing Owner reader can accept the original. */
class GalleryPhotoFailureNoticeUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun oversizedPhotoWithoutThumbnailHasNoIneffectiveRetry() {
        compose.setContent {
            MaterialTheme { GalleryPhotoFailureNotice(false, 64L * 1024 * 1024) {} }
        }
        compose.onNodeWithTag("gallery-photo-failure").assertExists()
        compose.onNodeWithText("原图超过 32 MiB，当前无法直接预览").assertExists()
        compose.onNodeWithTag("gallery-photo-retry").assertDoesNotExist()
    }

    @Test fun unsupportedOriginalAlsoDisablesRetry() {
        compose.setContent {
            MaterialTheme { GalleryPhotoFailureNotice(false, 0L) {} }
        }
        compose.onNodeWithTag("gallery-photo-retry").assertDoesNotExist()
    }

    @Test fun eligibleFailureKeepsExplicitRetry() {
        var attempts = 0
        compose.setContent {
            MaterialTheme { GalleryPhotoFailureNotice(true, 4L * 1024 * 1024) { attempts++ } }
        }
        compose.onNodeWithTag("gallery-photo-retry").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(1, attempts) }
    }
}
