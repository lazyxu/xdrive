package com.tfluid.xdrive

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test

/**
 * Exercise the production passive INITIAL-pass pointer recognizer without
 * requiring a device MediaStore grant, video codec or private media bytes.
 * PlayerView itself remains responsible for seek/play gestures.
 */
class NativeLocalVideoSwipeUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun swipesVideoAcrossLoadedNeighborsButPreservesSeekingAndEdges() {
        val loaded = listOf(
            NativeLocalViewerItemKey(31L, true, "camera", 300L),
            NativeLocalViewerItemKey(30L, true, "camera", 200L),
            NativeLocalViewerItemKey(29L, false, "camera", 100L),
        )
        compose.setContent {
            var index by remember { mutableIntStateOf(0) }
            val previous = nativeLocalViewerNeighborIndex(loaded, loaded[index], -1)
            val next = nativeLocalViewerNeighborIndex(loaded, loaded[index], 1)
            XDriveTheme {
                Column {
                    Box(Modifier.size(width = 320.dp, height = 300.dp)
                        .nativeLocalVideoSwipeNavigation(
                            loaded[index],
                            Uri.parse("content://media/external/video/media/" + loaded[index].id),
                            previous?.let { target -> ({ index = target }) },
                            next?.let { target -> ({ index = target }) },
                        )
                        .testTag("local-video-swipe-fixture")) {
                        Text("本机视频")
                    }
                    Text(index.toString(), Modifier.testTag("local-video-index"))
                }
            }
        }
        compose.onNodeWithTag("local-video-swipe-fixture")
            .performTouchInput { swipeLeft() }
        compose.onNodeWithTag("local-video-index").assertTextEquals("1")
        compose.onNodeWithTag("local-video-swipe-fixture")
            .performTouchInput { swipeLeft() }
        compose.onNodeWithTag("local-video-index").assertTextEquals("2")
        compose.onNodeWithTag("local-video-swipe-fixture")
            .performTouchInput { swipeLeft() }
        compose.onNodeWithTag("local-video-index").assertTextEquals("2")
        compose.onNodeWithTag("local-video-swipe-fixture")
            .performTouchInput { swipeRight() }
        compose.onNodeWithTag("local-video-index").assertTextEquals("1")

        // A Media3-style seek gesture in the lower control band must stay
        // inside the player and must not navigate to the next local asset.
        compose.onNodeWithTag("local-video-swipe-fixture").performTouchInput {
            val y = height * 0.95f
            swipe(
                start = Offset(width * 0.90f, y),
                end = Offset(width * 0.10f, y),
                durationMillis = 300L,
            )
        }
        compose.onNodeWithTag("local-video-index").assertTextEquals("1")
        compose.onNodeWithTag("local-video-swipe-fixture").performTouchInput {
            swipe(
                start = Offset(width * 0.90f, 10f),
                end = Offset(width * 0.10f, 10f),
                durationMillis = 300L,
            )
        }
        compose.onNodeWithTag("local-video-index").assertTextEquals("1")
    }
}
