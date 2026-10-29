package com.tfluid.xdrive

import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import kotlin.math.roundToInt

/** PDF shares the real native Viewer pinch/double-tap state, but TalkBack and
 * switch access also need real, discoverable zoom actions. UI state only:
 * no Owner file read, PDF render, transport, persistence or new media GET. */
internal fun nativePdfAccessibleZoomStep(zoom: Float, direction: Int): Float {
    require(direction == -1 || direction == 1)
    val current = if (zoom.isFinite()) zoom.coerceIn(1f, 4f) else 1f
    return (current + 0.5f * direction).coerceIn(1f, 4f)
}

internal fun nativePdfAccessibleZoomDescription(
    pageIndex: Int, pageCount: Int, zoom: Float,
): String {
    val count = pageCount.coerceAtLeast(1)
    val number = pageIndex.toLong().plus(1L).coerceIn(1L, count.toLong())
    val current = if (zoom.isFinite()) zoom.coerceIn(1f, 4f) else 1f
    return "PDF 第 $number / $count 页，缩放 ${(current * 100).roundToInt()}%"
}

/** Attach to the genuinely decoded, currently visible PDF bitmap only.
 * Its caller updates the SAME zoom/pan state as pinch and double-tap.
 * A page transition disposes this image and gets fresh actions on next render. */
internal fun Modifier.nativePdfZoomAccessibility(
    pageIndex: Int, pageCount: Int, zoom: Float,
    onZoomTo: (Float) -> Unit,
): Modifier = semantics {
    stateDescription = nativePdfAccessibleZoomDescription(pageIndex, pageCount, zoom)
    customActions = buildList {
        if (!zoom.isFinite() || zoom < 3.999f) {
            add(CustomAccessibilityAction("放大 PDF 页面") {
                onZoomTo(nativePdfAccessibleZoomStep(zoom, 1))
                true
            })
        }
        if (zoom.isFinite() && zoom > 1.001f) {
            add(CustomAccessibilityAction("缩小 PDF 页面") {
                onZoomTo(nativePdfAccessibleZoomStep(zoom, -1))
                true
            })
            add(CustomAccessibilityAction("恢复 PDF 页面大小") {
                onZoomTo(1f)
                true
            })
        }
    }
}
