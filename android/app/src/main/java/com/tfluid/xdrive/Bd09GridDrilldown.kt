package com.tfluid.xdrive

import com.tfluid.xdrive.core.OwnerBd09Bounds
import com.tfluid.xdrive.core.OwnerBd09Cell
import com.tfluid.xdrive.core.OwnerBd09MapCells

/** One in-memory verified parent result for exact native Back, never storage. */
internal data class Bd09GridLevel(
    val bounds: OwnerBd09Bounds,
    val cells: OwnerBd09MapCells,
)
internal const val MAX_BD09_DRILL_LEVELS = 6

/** Exactly Go's BD09LL 8×8 bin math: West/positive wrapped longitude and
 * ascending latitude from South. This selects a Server-verified GET, not a
 * client-side right to unscoped photo bytes or invented WGS84 GPS. */
internal fun bd09CellSubBounds(
    parent: OwnerBd09Bounds, cell: OwnerBd09Cell,
): OwnerBd09Bounds? {
    if (!parent.valid() || cell.cellX !in 0..7 || cell.cellY !in 0..7 ||
        cell.photoCount <= 0 || cell.assetId <= 0 || cell.nodeId <= 0 ||
        cell.nodeRevision <= 0 ||
        !parent.contains(cell.latitude, cell.longitude)) return null
    val width = (parent.east - parent.west).let {
        if (it < 0.0) it + 360.0 else it
    }
    val dx = width / 8.0
    val dy = (parent.north - parent.south) / 8.0
    if (!dx.isFinite() || !dy.isFinite() || dx <= 1e-10 || dy <= 1e-10) return null
    fun wrap(lon: Double): Double = when {
        lon > 180.0 -> lon - 360.0
        lon < -180.0 -> lon + 360.0
        else -> lon
    }
    val child = OwnerBd09Bounds(
        wrap(parent.west + dx * cell.cellX),
        parent.south + dy * cell.cellY,
        wrap(parent.west + dx * (cell.cellX + 1)),
        parent.south + dy * (cell.cellY + 1))
    return child.takeIf { it.valid() && it != parent }
}

/** Viewport-relative BD09LL rendering; world-relative scatter must never
 * misplace a zoomed/antimeridian native cell. */
internal fun bd09ViewportFraction(
    bounds: OwnerBd09Bounds, lat: Double, lon: Double,
): Pair<Float, Float>? {
    if (!bounds.contains(lat, lon)) return null
    val width = (bounds.east - bounds.west).let {
        if (it < 0.0) it + 360.0 else it
    }
    val dx = if (bounds.west < bounds.east) lon - bounds.west else
        (lon - bounds.west + 360.0) % 360.0
    val u = dx / width
    val v = (bounds.north - lat) / (bounds.north - bounds.south)
    return if (u.isFinite() && v.isFinite())
        u.toFloat().coerceIn(0f, 1f) to v.toFloat().coerceIn(0f, 1f)
    else null
}
