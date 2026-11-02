package com.tfluid.xdrive

import kotlin.math.abs

/**
 * One-finger Gallery page turns are allowed only at 1x and only for a short,
 * predominantly horizontal swipe. This predicate owns no transport/Owner data.
 */
internal fun shouldShiftGalleryPhotoSwipe(
    deltaX: Float,
    deltaY: Float,
    durationMillis: Long,
    thresholdPx: Float,
    singlePointer: Boolean,
    atDefaultZoom: Boolean,
): Boolean =
    singlePointer && atDefaultZoom && durationMillis in 0L..800L &&
        thresholdPx.isFinite() && thresholdPx > 0f &&
        deltaX.isFinite() && deltaY.isFinite() &&
        abs(deltaX) >= thresholdPx && abs(deltaX) > abs(deltaY) * 1.25f

/**
 * A Live Photo long-press is an intentional motion playback gesture. The Live
 * observer may clear `held` as soon as the finger drags outside touch slop,
 * *before* the page-turn observer sees the UP event. Latch the fact that the
 * current touch gesture ever activated Live, not just whether Live is held at
 * the instant of release. Reset only on the next DOWN.
 *
 * In memory and scoped to the exact Viewer media identity. Neither a player
 * URL nor an Owner token is retained.
 */
internal class GalleryLiveHoldSwipeFence {
    private var liveActivatedInGesture = false

    fun beginGesture() {
        liveActivatedInGesture = false
    }

    fun liveHoldActivated() {
        liveActivatedInGesture = true
    }

    /** No visual page motion after a Live hold began in this gesture. */
    fun mayPreviewFingerDrag(): Boolean = !liveActivatedInGesture

    fun mayShift(
        deltaX: Float,
        deltaY: Float,
        durationMillis: Long,
        thresholdPx: Float,
        singlePointer: Boolean,
        atDefaultZoom: Boolean,
    ): Boolean =
        !liveActivatedInGesture && shouldShiftGalleryPhotoSwipe(
            deltaX, deltaY, durationMillis, thresholdPx,
            singlePointer, atDefaultZoom,
        )
}

/**
 * Finger-locked drag preview used by both cloud and MediaStore galleries.
 * No Owner request occurs during movement; unavailable edges resist rather
 * than opening an unauthorized neighbor. 1x single-finger horizontal only.
 */
internal fun galleryPhotoFingerDrag(
    deltaX: Float,
    deltaY: Float,
    viewportWidth: Float,
    atDefaultZoom: Boolean,
    singlePointer: Boolean,
    previousAvailable: Boolean,
    nextAvailable: Boolean,
): Float {
    if (!singlePointer || !atDefaultZoom || !deltaX.isFinite() ||
        !deltaY.isFinite() || !viewportWidth.isFinite() || viewportWidth <= 0f ||
        kotlin.math.abs(deltaX) < 10f ||
        kotlin.math.abs(deltaX) <= kotlin.math.abs(deltaY) * 1.15f) return 0f
    val neighborAvailable = if (deltaX > 0f) previousAvailable else nextAvailable
    val offset = if (neighborAvailable) deltaX else deltaX * 0.18f
    return offset.coerceIn(-viewportWidth, viewportWidth)
}
