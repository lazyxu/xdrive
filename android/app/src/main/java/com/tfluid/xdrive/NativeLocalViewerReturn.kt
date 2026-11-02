package com.tfluid.xdrive

/** An exact, source-scoped MediaStore row identity, not an uploaded PhotoAsset. */
internal data class NativeLocalViewerItemKey(
    val id: Long,
    val isVideo: Boolean,
    val albumId: String,
    val addedAtSeconds: Long,
)

/** The same MediaStore ID can resolve to a different content URI on a new
 * volume or after reselection. Never reuse a player or Motion Photo intent
 * just because the visible row's numeric identity still matches. */
internal data class NativeLocalVideoSourceKey(
    val item: NativeLocalViewerItemKey,
    val uri: String,
)

internal fun NativeLocalMedia.viewerReturnKey() = NativeLocalViewerItemKey(
    id = id, isVideo = isVideo, albumId = albumId, addedAtSeconds = addedAtSeconds)

/**
 * Transient only. Never save local MediaStore IDs, album names or URIs to
 * preferences, SavedStateHandle, navigation history or server telemetry.
 */
internal data class NativeLocalViewerReturnAnchor(
    val item: NativeLocalViewerItemKey,
    val albumsOnly: Boolean,
    val albumId: String?,
    val generation: Int,
)

/** Do not focus the same numeric ID after Owner/grant/album/index changes. */
internal fun nativeLocalViewerReturnIndex(
    anchor: NativeLocalViewerReturnAnchor?,
    available: List<NativeLocalViewerItemKey>,
    albumsOnly: Boolean,
    selectedAlbumId: String?,
    generation: Int,
    readable: Boolean,
): Int? {
    if (anchor == null || !readable || anchor.generation != generation ||
        anchor.albumsOnly != albumsOnly ||
        anchor.albumId != (if (albumsOnly) selectedAlbumId else null) ||
        (albumsOnly && selectedAlbumId == null) ||
        available.size > NativeLocalMediaStore.MAX_WALL_ITEMS) return null
    val index = available.indexOf(anchor.item)
    return index.takeIf { it >= 0 }
}

/**
 * Local Viewer navigation is confined to the current bounded, authorized wall.
 * A MediaStore numeric ID alone is not a valid neighbor identity: media kind,
 * album and creation time must still match. Never fetch extra pages here.
 */
internal fun nativeLocalViewerLoadedIndex(
    available: List<NativeLocalViewerItemKey>,
    current: NativeLocalViewerItemKey,
): Int? {
    if (available.size > NativeLocalMediaStore.MAX_WALL_ITEMS) return null
    return available.indexOf(current).takeIf { it >= 0 }
}

internal fun nativeLocalViewerNeighborIndex(
    available: List<NativeLocalViewerItemKey>,
    current: NativeLocalViewerItemKey,
    direction: Int,
): Int? {
    if (direction != -1 && direction != 1) return null
    val index = nativeLocalViewerLoadedIndex(available, current) ?: return null
    return (index + direction).takeIf { it in available.indices }
}


/**
 * Direction for one completed drag on an authorized, already-loaded still
 * Viewer: negative X advances to the next media; positive X goes previous.
 * Return null on zoomed, non-finite, too-small or invalid thresholds.
 * This policy never crosses a local wall boundary by itself.
 */
internal fun nativeLocalViewerSwipeDirection(
    distanceX: Float,
    thresholdPx: Float,
    zoomed: Boolean,
): Int? {
    if (zoomed || !distanceX.isFinite() || !thresholdPx.isFinite() ||
        thresholdPx <= 0f || kotlin.math.abs(distanceX) < thresholdPx) return null
    return if (distanceX < 0f) 1 else -1
}

/**
 * A passive video swipe must not steal Media3 seeking, the top controls, or
 * multitouch. Direction applies only to the already-loaded local media wall;
 * it never asks MediaStore for additional files.
 */
internal fun nativeLocalVideoSwipeDirection(
    deltaX: Float,
    deltaY: Float,
    elapsedMillis: Long,
    startY: Float,
    surfaceHeight: Float,
    headerPx: Float,
    thresholdPx: Float,
    singlePointer: Boolean,
    previousAvailable: Boolean,
    nextAvailable: Boolean,
): Int? {
    if (!singlePointer || elapsedMillis !in 0L..800L ||
        !deltaY.isFinite() || !startY.isFinite() ||
        !surfaceHeight.isFinite() || surfaceHeight <= 0f ||
        !headerPx.isFinite() || headerPx < 0f ||
        startY < headerPx || startY >= surfaceHeight * 0.78f) return null
    val direction = nativeLocalViewerSwipeDirection(
        deltaX, thresholdPx, zoomed = false) ?: return null
    if (kotlin.math.abs(deltaX) <= kotlin.math.abs(deltaY) * 1.25f) return null
    return direction.takeIf {
        if (it > 0) nextAvailable else previousAvailable
    }
}
