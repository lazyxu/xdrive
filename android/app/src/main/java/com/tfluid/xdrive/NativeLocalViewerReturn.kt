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
