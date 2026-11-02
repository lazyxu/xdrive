package com.tfluid.xdrive

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntSize

/** A PDF uses one decoded page bitmap; scale and translation affect only its
 * visible Compose layer and never read another Owner file or PDF page. */
internal data class NativePdfTouchResult(val zoom: Float, val pan: Offset)

/** Same one-page bounds as the original PDF Viewer, with invalid hardware
 * gesture values ignored rather than publishing NaN transforms. */
internal fun nativePdfTouchResult(
    zoom: Float, pan: Offset, scaleChange: Float, panChange: Offset,
    viewport: IntSize,
): NativePdfTouchResult {
    val previous = if (zoom.isFinite()) zoom.coerceIn(1f, 4f) else 1f
    val multiplier = if (scaleChange.isFinite() && scaleChange > 0f)
        scaleChange else 1f
    val next = (previous * multiplier).coerceIn(1f, 4f)
    if (next <= 1f) return NativePdfTouchResult(1f, Offset.Zero)

    val extentX = viewport.width.coerceAtLeast(0).toFloat() * (next - 1f) / 2f
    val extentY = viewport.height.coerceAtLeast(0).toFloat() * (next - 1f) / 2f
    val old = if (pan.x.isFinite() && pan.y.isFinite()) pan else Offset.Zero
    val shift = if (panChange.x.isFinite() && panChange.y.isFinite())
        panChange else Offset.Zero
    return NativePdfTouchResult(next, Offset(
        (old.x + shift.x).coerceIn(-extentX, extentX),
        (old.y + shift.y).coerceIn(-extentY, extentY),
    ))
}

/** The real PdfRenderer page and a gesture-only test harness use exactly
 * the same pinch/pan and double-tap modifier. A new page disposes its old
 * tap detector; recomposition uses current zoom and callbacks immediately. */
@Composable
internal fun Modifier.nativePdfTouchGestures(
    pageIndex: Int,
    zoom: Float,
    pan: Offset,
    viewport: IntSize,
    onUpdate: (Float, Offset) -> Unit,
): Modifier {
    val currentZoom by rememberUpdatedState(zoom)
    val currentPan by rememberUpdatedState(pan)
    val currentViewport by rememberUpdatedState(viewport)
    val currentUpdate by rememberUpdatedState(onUpdate)
    val gesture = rememberTransformableState { scale, drag, _ ->
        val next = nativePdfTouchResult(
            currentZoom, currentPan, scale, drag, currentViewport)
        currentUpdate(next.zoom, next.pan)
    }
    return this.transformable(gesture)
        .pointerInput(pageIndex) {
            detectTapGestures(onDoubleTap = {
                currentUpdate(if (currentZoom > 1f) 1f else 2f, Offset.Zero)
            })
        }
}
