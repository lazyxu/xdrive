package com.tfluid.xdrive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Actual production PDF pointer modifier, not a duplicate gesture recognizer.
 * No Owner PDF bytes, SDK media permission or network work is needed. */
class NativePdfTouchGesturesUiTest {
    @get:Rule val compose = createComposeRule()
    private val zoom = mutableFloatStateOf(1f)
    private val pan = mutableStateOf(Offset.Zero)

    private fun render() {
        compose.setContent {
            val viewport = androidx.compose.runtime.remember {
                mutableStateOf(IntSize.Zero)
            }
            XDriveTheme {
                Box(Modifier.size(240.dp)
                    .onSizeChanged { viewport.value = it }
                    .nativePdfTouchGestures(
                        pageIndex = 0, zoom = zoom.floatValue, pan = pan.value,
                        viewport = viewport.value,
                    ) { nextZoom, nextPan ->
                        zoom.floatValue = nextZoom
                        pan.value = nextPan
                    }
                    .nativePdfZoomAccessibility(
                        pageIndex = 0, pageCount = 2, zoom = zoom.floatValue,
                    ) { nextZoom ->
                        zoom.floatValue = nextZoom
                        pan.value = Offset.Zero
                    }
                    .testTag("pdf-touch-surface"))
            }
        }
    }

    @Test fun doubleTapZoomsThenResetsTheSameVisiblePdfPage() {
        render()
        val node = compose.onNodeWithTag("pdf-touch-surface")
        node.assert(SemanticsMatcher.expectValue(
            SemanticsProperties.StateDescription,
            "PDF 第 1 / 2 页，缩放 100%",
        ))
        node.performTouchInput { doubleClick() }
        compose.waitForIdle()
        node.assert(SemanticsMatcher.expectValue(
            SemanticsProperties.StateDescription,
            "PDF 第 1 / 2 页，缩放 200%",
        ))
        node.performTouchInput { doubleClick() }
        compose.waitForIdle()
        node.assert(SemanticsMatcher.expectValue(
            SemanticsProperties.StateDescription,
            "PDF 第 1 / 2 页，缩放 100%",
        ))
        compose.runOnIdle { assertTrue(pan.value == Offset.Zero) }
    }

    @Test fun twoFingerPinchMagnifiesActualTouchSurfaceWithoutChangingPage() {
        render()
        val node = compose.onNodeWithTag("pdf-touch-surface")
        node.performTouchInput {
            pinch(
                start0 = center + Offset(-32f, 0f),
                start1 = center + Offset(32f, 0f),
                end0 = center + Offset(-84f, 0f),
                end1 = center + Offset(84f, 0f),
            )
        }
        compose.waitForIdle()
        compose.runOnIdle {
            assertTrue("Actual pinch must enlarge the current PDF", zoom.floatValue > 1f)
            assertTrue(zoom.floatValue <= 4f)
        }
        node.assert(SemanticsMatcher.expectValue(
            SemanticsProperties.StateDescription,
            nativePdfAccessibleZoomDescription(0, 2, zoom.floatValue),
        ))
    }
}
