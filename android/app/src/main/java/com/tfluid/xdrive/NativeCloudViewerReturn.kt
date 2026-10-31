package com.tfluid.xdrive

/** Authoritative node revision is required; a reused numeric ID is never enough. */
internal data class NativeCloudViewerKey(val nodeId: Long, val revision: Long)

/** In-memory only; the host owns this for exactly one authenticated Owner epoch. */
internal data class NativeCloudViewerReturnAnchor(
    val source: NativeCloudViewerKey,
    val albumId: String?,
    val searchQuery: String,
    val mediaKind: String,
    val sortBy: String,
    val sortDir: String,
    val jumpEpoch: Long,
)

/** No cross-Owner, stale album, changed filter or evicted-page focus restoration. */
internal fun nativeCloudViewerReturnIndex(
    anchor: NativeCloudViewerReturnAnchor?,
    rows: List<NativeCloudViewerKey>,
    albumId: String?,
    searchQuery: String,
    mediaKind: String,
    sortBy: String,
    sortDir: String,
    jumpEpoch: Long,
): Int? {
    if (anchor == null || anchor.source.nodeId <= 0 || anchor.source.revision <= 0 ||
        anchor.albumId != albumId || anchor.searchQuery != searchQuery ||
        anchor.mediaKind != mediaKind || anchor.sortBy != sortBy ||
        anchor.sortDir != sortDir || anchor.jumpEpoch != jumpEpoch)
        return null
    val at = rows.indexOf(anchor.source)
    return at.takeIf { it >= 0 }
}
