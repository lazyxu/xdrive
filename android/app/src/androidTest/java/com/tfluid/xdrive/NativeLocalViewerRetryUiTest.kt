package com.tfluid.xdrive

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Real native retry affordances, no MediaStore read or network source. */
class NativeLocalViewerRetryUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun failedStillShowsRealManualRetryInsteadOfPermanentBlankPreview() {
        var retries = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalViewerRetryNotice(isVideo = false, onRetry = { retries++ })
            }
        }
        compose.onNodeWithTag("native-local-still-failure").assertIsDisplayed()
        compose.onNodeWithTag("native-local-still-retry").assertIsDisplayed()
            .performClick()
        compose.runOnIdle { assertEquals(1, retries) }
        compose.onNodeWithTag("native-local-video-retry").assertDoesNotExist()
    }

    @Test fun degradedLocalStillExplicitlyIdentifiesThumbnailAndOffersOriginalRetry() {
        var retries = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalStillFallbackNotice(retrying = false,
                    onRetryOriginal = { retries++ })
            }
        }
        compose.onNodeWithTag("native-local-still-fallback").assertIsDisplayed()
        compose.onNodeWithText("仅显示本机缩略图", substring = true).assertIsDisplayed()
        compose.onNodeWithTag("native-local-still-original-retry")
            .assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, retries) }
        compose.onNodeWithTag("native-local-still-retry").assertDoesNotExist()
    }

    @Test fun degradedThumbnailRemainsVisibleAndDoesNotDoubleRetryWhileLoading() {
        var retries = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalStillFallbackNotice(retrying = true,
                    onRetryOriginal = { retries++ })
            }
        }
        compose.onNodeWithTag("native-local-still-fallback").assertIsDisplayed()
        compose.onNodeWithText("正在重试读取原件…").assertIsDisplayed()
        compose.onNodeWithTag("native-local-still-original-retry").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, retries) }
    }

    @Test fun failedVideoShowsManualRetryWithoutClaimingPlaybackSuccess() {
        var retries = 0
        compose.setContent {
            XDriveTheme {
                NativeLocalViewerRetryNotice(isVideo = true, onRetry = { retries++ })
            }
        }
        compose.onNodeWithTag("native-local-video-failure").assertIsDisplayed()
        compose.onNodeWithTag("native-local-video-retry").assertIsDisplayed()
            .performClick()
        compose.runOnIdle { assertEquals(1, retries) }
        compose.onNodeWithTag("native-local-still-retry").assertDoesNotExist()
    }
}
