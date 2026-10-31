package com.tfluid.xdrive

/**
 * Native Gallery Video and Live Photo Media3 players can throw after resources have already been allocated
 * (for example, setMediaSource or prepare). Compose must not crash, and failed
 * construction must release the partially initialized instance exactly once.
 *
 * Only the current user hold may retry: the caller remembers the null result
 * for its current media lease and re-creates on a new verified lease. Never
 * store the source URL, token or a player across Owner/session boundaries.
 */
internal fun <T : Any> createPreparedMediaResource(
    build: () -> T,
    prepare: (T) -> Unit,
    release: (T) -> Unit,
): T? {
    val player = try {
        build()
    } catch (_: Exception) {
        return null
    }
    return try {
        prepare(player)
        player
    } catch (_: Exception) {
        try {
            release(player)
        } catch (_: Exception) {
            // Do not let an already-failed media setup crash Compose because
            // vendor codec resource cleanup also throws.
        }
        null
    }
}

/** App STOP cancels private Live motion, and a held pointer that survived
 * backgrounding cannot silently re-open the Owner stream on resume.
 * The user must lift and press again to start new live playback. */
internal fun liveMotionMayStart(
    held: Boolean,
    stillReady: Boolean,
    lifecycleStarted: Boolean,
    freshPressRequired: Boolean,
): Boolean =
    held && stillReady && lifecycleStarted && !freshPressRequired

/** A completed, missing Owner motion lease is a terminal result for this
 * current deliberate hold. Release/Owner switches cannot show stale errors. */
internal fun liveMotionUnavailableAfterRead(
    activeHold: Boolean, sourceReturned: Boolean,
): Boolean = activeHold && !sourceReturned

/** Do not show a buffering spinner over a terminal Media3 setup/read error. */
internal fun liveMotionPendingIndicatorAllowed(
    ended: Boolean, failed: Boolean, playerSetupFailed: Boolean,
): Boolean = !ended && !failed && !playerSetupFailed
