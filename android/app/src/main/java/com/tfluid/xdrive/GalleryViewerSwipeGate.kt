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
