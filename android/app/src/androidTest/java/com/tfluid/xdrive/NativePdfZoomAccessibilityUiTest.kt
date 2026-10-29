package com.tfluid.xdrive

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Actual Android Compose semantics shared with the decoded PDF image.
 * No fake Owner network response or local PDF is needed for UI-only zoom. */
class NativePdfZoomAccessibilityUiTest {
    @get:Rule val compose = createComposeRule()

    private fun render(pageIndex: Int = 1, pageCount: Int = 3) {
        compose.setContent {
            XDriveTheme {
                var zoom by androidx.compose.runtime.remember { mutableFloatStateOf(1f) }
                Box(Modifier.fillMaxSize().testTag("pdf-zoom-fixture")
                    .nativePdfZoomAccessibility(pageIndex, pageCount, zoom) {
                        zoom = it
                    })
            }
        }
    }

    private fun actions() =
        compose.onNodeWithTag("pdf-zoom-fixture")
            .fetchSemanticsNode().config[SemanticsActions.CustomActions]

    private fun state() =
        compose.onNodeWithTag("pdf-zoom-fixture")
            .fetchSemanticsNode().config[SemanticsProperties.StateDescription]

    private fun invoke(label: String) {
        val selected = actions().single { it.label == label }
        compose.runOnIdle { assertTrue(selected.action()) }
        compose.waitForIdle()
    }

    @Test fun realSemanticsCanZoomOutAndResetCurrentPage() {
        render()
        assertEquals("PDF 第 2 / 3 页，缩放 100%", state())
        assertTrue(actions().any { it.label == "放大 PDF 页面" })
        assertFalse(actions().any { it.label == "缩小 PDF 页面" })
        invoke("放大 PDF 页面")
        assertEquals("PDF 第 2 / 3 页，缩放 150%", state())
        invoke("放大 PDF 页面")
        assertEquals("PDF 第 2 / 3 页，缩放 200%", state())
        invoke("缩小 PDF 页面")
        assertEquals("PDF 第 2 / 3 页，缩放 150%", state())
        invoke("恢复 PDF 页面大小")
        assertEquals("PDF 第 2 / 3 页，缩放 100%", state())
        assertFalse(actions().any { it.label == "恢复 PDF 页面大小" })
    }

    @Test fun zoomFourXHasNoInvalidPlusActionAndKeepsReset() {
        render(pageIndex = 0, pageCount = 1)
        repeat(8) {
            if (actions().any { it.label == "放大 PDF 页面" })
                invoke("放大 PDF 页面")
        }
        assertEquals("PDF 第 1 / 1 页，缩放 400%", state())
        assertFalse(actions().any { it.label == "放大 PDF 页面" })
        assertTrue(actions().any { it.label == "缩小 PDF 页面" })
        assertTrue(actions().any { it.label == "恢复 PDF 页面大小" })
    }
}
