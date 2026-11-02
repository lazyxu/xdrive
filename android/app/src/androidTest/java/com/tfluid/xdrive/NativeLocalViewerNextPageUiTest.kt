package com.tfluid.xdrive

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test

/** Production local finger-follow surface + explicit next-page status.
 * A fake next-page callback is sufficient; no fabricated MediaStore grant or
 * OEM provider is used to claim a real photo exists beyond the loaded wall. */
class NativeLocalViewerNextPageUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun tailSwipeRequestsOnlyOnePageAndKeepsCurrentPosterVisible() {
        val item = NativeLocalViewerItemKey(1L, false, "camera", 100L)
        compose.setContent {
            var pending by remember { mutableStateOf(false) }
            var requests by remember { mutableIntStateOf(0) }
            XDriveTheme {
                Column {
                    NativeLocalPhotoSwipeSurface(
                        mediaKey = item,
                        zoomed = false,
                        onPrevious = null,
                        onNext = if (pending) null else ({
                            requests++
                            pending = true
                        }),
                        modifier = Modifier.size(280.dp)
                            .testTag("local-boundary-swipe"),
                        onNextIsBoundary = !pending,
                    ) {
                        Text("当前本机照片保持可见",
                            Modifier.testTag("local-boundary-still"))
                    }
                    NativeLocalViewerNextPageStatus(
                        loading = pending, error = null, onRetry = null)
                    Text(requests.toString(), Modifier.testTag("local-boundary-requests"))
                }
            }
        }

        compose.onNodeWithTag("local-boundary-swipe")
            .performTouchInput { swipeLeft() }
        compose.waitForIdle()
        compose.onNodeWithTag("local-boundary-requests").assertTextEquals("1")
        compose.onNodeWithTag("native-local-viewer-next-page-loading").assertExists()
        compose.onNodeWithTag("local-boundary-still").assertExists()

        // While a page is pending, a second gesture cannot mint a second
        // request or replace the unverified next item's missing poster.
        compose.onNodeWithTag("local-boundary-swipe")
            .performTouchInput { swipeLeft() }
        compose.onNodeWithTag("local-boundary-requests").assertTextEquals("1")
        compose.onNodeWithTag("local-boundary-still").assertExists()
    }

    @Test fun failedPageExplainsThatCurrentPhotoIsPreservedAndRetryIsExplicit() {
        compose.setContent {
            var error by remember { mutableStateOf<String?>("provider unavailable") }
            var retries by remember { mutableIntStateOf(0) }
            XDriveTheme {
                Column {
                    NativeLocalViewerNextPageStatus(
                        loading = false, error = error,
                        onRetry = {
                            retries++
                            error = null
                        },
                    )
                    Text(retries.toString(), Modifier.testTag("local-page-retry-count"))
                }
            }
        }
        compose.onNodeWithTag("native-local-viewer-next-page-failed").assertExists()
        compose.onNodeWithTag("native-local-viewer-next-page-retry")
            .assertIsEnabled().performClick()
        compose.onNodeWithTag("local-page-retry-count").assertTextEquals("1")
        compose.onNodeWithTag("native-local-viewer-next-page-failed").assertDoesNotExist()
    }
}