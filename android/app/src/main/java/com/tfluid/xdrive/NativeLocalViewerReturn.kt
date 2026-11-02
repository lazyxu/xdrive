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

/**
 * A single user-triggered MediaStore continuation from the LAST currently
 * loaded local Viewer item. It is transient and scoped to exact URI, Owner
 * session, permission/index revision and the existing wall cursor. The
 * existing 64-row pageAfter reader remains the sole source of new items.
 */
internal data class NativeLocalViewerNextPageIntent(
    val source: NativeLocalVideoSourceKey,
    val sessionId: Long,
    val generation: Int,
    val wallRevision: Int,
    val albumsOnly: Boolean,
    val albumId: String?,
    val mediaKind: String,
    val cursor: NativeLocalPageKey,
    val requestId: Int,
)

internal enum class NativeLocalNextPageDecision {
    WAITING, ADVANCE, END, FAILED, STALE,
}

/** No speculative scans: one deliberate next-page tap/swipe at a stable wall
 * tail, never while a read, full-date scan or previous request is active. */
internal fun nativeLocalViewerCanRequestNextPage(
    loadedIndex: Int?,
    loadedCount: Int,
    exhausted: Boolean,
    hasCursor: Boolean,
    busy: Boolean,
    hasError: Boolean,
    pending: Boolean,
    readable: Boolean,
): Boolean = readable && loadedCount in 1..NativeLocalMediaStore.MAX_WALL_ITEMS &&
    loadedIndex == loadedCount - 1 && !exhausted && hasCursor &&
    !busy && !hasError && !pending

/** A completed continuation may navigate only to a newly VERIFIED row in
 * the existing bounded wall. Invalidated or delayed permissions, albums,
 * filters, viewer items, or request IDs must never change the open Viewer. */
internal fun nativeLocalViewerNextPageDecision(
    request: NativeLocalViewerNextPageIntent,
    activeSource: NativeLocalVideoSourceKey?,
    loaded: List<NativeLocalViewerItemKey>,
    sessionId: Long,
    generation: Int,
    wallRevision: Int,
    albumsOnly: Boolean,
    albumId: String?,
    mediaKind: String,
    readable: Boolean,
    pageIntent: Int,
    consumedPageIntent: Int,
    busy: Boolean,
    hasError: Boolean,
): NativeLocalNextPageDecision {
    if (!readable || activeSource != request.source ||
        sessionId != request.sessionId || generation != request.generation ||
        wallRevision != request.wallRevision ||
        albumsOnly != request.albumsOnly || albumId != request.albumId ||
        mediaKind != request.mediaKind || pageIntent != request.requestId ||
        request.requestId <= 0 || request.cursor.id <= 0)
        return NativeLocalNextPageDecision.STALE
    val index = nativeLocalViewerLoadedIndex(loaded, activeSource.item)
        ?: return NativeLocalNextPageDecision.STALE
    if (consumedPageIntent != request.requestId || busy)
        return NativeLocalNextPageDecision.WAITING
    if (hasError) return NativeLocalNextPageDecision.FAILED
    return if (index < loaded.lastIndex) NativeLocalNextPageDecision.ADVANCE
    else NativeLocalNextPageDecision.END
}
