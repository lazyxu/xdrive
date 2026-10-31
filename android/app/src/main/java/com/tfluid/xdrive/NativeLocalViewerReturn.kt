package com.tfluid.xdrive

/** An exact, source-scoped MediaStore row identity, not an uploaded PhotoAsset. */
internal data class NativeLocalViewerItemKey(
    val id: Long,
    val isVideo: Boolean,
    val albumId: String,
    val addedAtSeconds: Long,
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
