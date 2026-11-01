package com.tfluid.xdrive

import com.tfluid.xdrive.core.OwnerBd09Bounds
import com.tfluid.xdrive.core.OwnerBd09Cell
import com.tfluid.xdrive.core.OwnerBd09MapCells

/**
 * Exact Owner-signed BD09LL map overlays, not location permission, image bytes,
 * geographic conversion or a map provider grant. No more than 64 cells can
 * leave the existing authenticated Go response for native map rendering.
 *
 * A malformed count, duplicate cell or out-of-viewport sample must fail
 * closed rather than showing a plausible but unverified pin.
 */
/**
 * Temporary, Owner-hosted SDK camera snapshot across Gallery Map Cell Viewer
 * unmount. The signed Owner rectangle is its scope, NOT authorization to
 * open photos. Nothing in this state survives leaving the map/login epoch.
 */
internal data class NativeBaiduCameraBookmark(
    val signedBounds: OwnerBd09Bounds,
    val latitude: Double,
    val longitude: Double,
    val zoom: Float,
) {
    fun canRestore(current: OwnerBd09Bounds): Boolean =
        signedBounds == current && current.valid() &&
            latitude.isFinite() && latitude in -90.0..90.0 &&
            longitude.isFinite() && longitude in -180.0..180.0 &&
            current.contains(latitude, longitude) &&
            zoom.isFinite() && zoom in 3f..22f
}

/** Only accept the real SDK's final BD09 rectangle, never a WGS84 point
 * or a pixel estimate. A wrapped west>east viewport remains valid. */
internal fun nativeBaiduCameraBounds(
    southLatitude: Double, westLongitude: Double,
    northLatitude: Double, eastLongitude: Double,
): OwnerBd09Bounds? = OwnerBd09Bounds(
    westLongitude, southLatitude, eastLongitude, northLatitude,
).takeIf { it.valid() }

internal fun nativeVerifiedBaiduPins(
    bounds: OwnerBd09Bounds,
    snapshot: OwnerBd09MapCells,
): List<OwnerBd09Cell>? {
    if (!bounds.valid() || snapshot.totalPhotoCount < 0L ||
        snapshot.cells.size > 64 ||
        (snapshot.cells.isEmpty() != (snapshot.totalPhotoCount == 0L))) return null

    val occupied = HashSet<Pair<Int, Int>>()
    var total = 0L
    for (cell in snapshot.cells) {
        if (cell.cellX !in 0..7 || cell.cellY !in 0..7 ||
            !occupied.add(cell.cellX to cell.cellY) ||
            cell.photoCount <= 0L ||
            cell.assetId <= 0L || cell.nodeId <= 0L ||
            cell.nodeRevision <= 0L ||
            !bounds.contains(cell.latitude, cell.longitude) ||
            cell.photoCount > snapshot.totalPhotoCount - total) return null
        total += cell.photoCount
    }
    return if (total == snapshot.totalPhotoCount) snapshot.cells else null
}
