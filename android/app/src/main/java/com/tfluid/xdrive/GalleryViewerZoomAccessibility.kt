package com.tfluid.xdrive

import kotlin.math.roundToInt

/** Presentation-only zoom actions for Android switch access and TalkBack.
 * The same 1x..5x image bounds as the native pinch recognizer. No network,
 * Owner file, media metadata, credential or private location state involved. */
internal fun galleryAccessibleZoomStep(zoom: Float, direction: Int): Float {
    require(direction == -1 || direction == 1)
    val current = if (zoom.isFinite()) zoom.coerceIn(1f, 5f) else 1f
    return (current + direction * .5f).coerceIn(1f, 5f)
}

internal fun galleryAccessibleZoomLabel(zoom: Float): String {
    val current = if (zoom.isFinite()) zoom.coerceIn(1f, 5f) else 1f
    return "图片缩放 ${(current * 100f).roundToInt()}%"
}
