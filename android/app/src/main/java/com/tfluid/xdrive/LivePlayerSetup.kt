package com.tfluid.xdrive

/**
 * A native Media3 player can throw after resources have already been allocated
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
