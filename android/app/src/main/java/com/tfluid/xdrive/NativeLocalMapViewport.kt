package com.tfluid.xdrive

import kotlin.math.cos
import kotlin.math.min

/** Native, offline WGS84 photo-cell camera. No fake basemap, geolocation
 * request, remote tile endpoint or device GPS. Input is at most 64 actual
 * photo-cell representative coordinates from NativeLocalMapIndex.
 *
 * Longitude uses the shortest circular arc. A +179.9° and -179.9° pair must
 * be near one another instead of sitting on opposite edges of the world.
 */
internal data class NativeLocalMapViewport(
    val centerLatitude: Double,
    val centerLongitude: Double,
    val latitudeSpan: Double,
    val longitudeSpan: Double,
    private val arcStart: Double,
) {
    /** Coordinates in the canvas's dp-space, matching Compose Modifier.offset.
     * A one-finger pan and two-finger zoom are visual-only transforms.
     */
    fun position(
        latitude: Double, longitude: Double,
        width: Float, height: Float,
        zoom: Float = 1f, panX: Float = 0f, panY: Float = 0f,
    ): Pair<Float, Float>? {
        if (!nativeLocalValidLatLon(latitude, longitude) ||
            !width.isFinite() || !height.isFinite() ||
            width <= 0f || height <= 0f ||
            !zoom.isFinite() || zoom <= 0f ||
            !panX.isFinite() || !panY.isFinite()) return null
        val latitudeCosine = cos(Math.toRadians(centerLatitude)).coerceAtLeast(0.1)
        // Leave enough visible padding for 56dp cover + its 66dp caption
        // without pretending that same-site photos occupy distinct positions.
        val usableWidth = (width - 72f).coerceAtLeast(16f).toDouble()
        val usableHeight = (height - 96f).coerceAtLeast(16f).toDouble()
        val scale = min(
            usableWidth / (longitudeSpan * latitudeCosine).coerceAtLeast(MIN_SPAN),
            usableHeight / latitudeSpan.coerceAtLeast(MIN_SPAN),
        )
        val deltaLongitude = ((nativeLocalLongitudePhase(longitude) - arcStart +
            360.0) % 360.0) - longitudeSpan / 2.0
        val px = width / 2.0 + deltaLongitude * latitudeCosine * scale *
            zoom + panX
        val py = height / 2.0 - (latitude - centerLatitude) * scale *
            zoom + panY
        return if (px.isFinite() && py.isFinite())
            px.toFloat() to py.toFloat() else null
    }

    companion object {
        // ~9 km of latitude minimum: a lone site gets a readable area,
        // while city-scale photos remain spaced without extreme zoom.
        private const val MIN_SPAN = 0.08
    }
}

private fun nativeLocalValidLatLon(latitude: Double, longitude: Double) =
    latitude.isFinite() && longitude.isFinite() &&
        latitude in -90.0..90.0 && longitude in -180.0..180.0

private fun nativeLocalLongitudePhase(longitude: Double): Double =
    ((longitude + 180.0) % 360.0 + 360.0) % 360.0

/** Fit all *located* cell representatives without enumerating raw photos.
 * A sorted circular array with N<=64 costs O(N log N). Invalid coordinates
 * never result in a projected/visible false marker.
 */
internal fun nativeLocalMapViewport(
    positions: List<Pair<Double, Double>>,
): NativeLocalMapViewport? {
    val valid = positions.filter { nativeLocalValidLatLon(it.first, it.second) }
    if (valid.isEmpty()) return null
    val minLat = valid.minOf { it.first }
    val maxLat = valid.maxOf { it.first }
    val phases = valid.map { nativeLocalLongitudePhase(it.second) }.sorted()
    var widestGap = -1.0
    var afterGap = 0
    for (i in phases.indices) {
        val next = if (i == phases.lastIndex) phases.first() + 360.0
            else phases[i + 1]
        val gap = next - phases[i]
        if (gap > widestGap) {
            widestGap = gap
            afterGap = (i + 1) % phases.size
        }
    }
    val start = phases[afterGap]
    val span = (360.0 - widestGap).coerceIn(0.0, 360.0)
    val centerPhase = (start + span / 2.0) % 360.0
    return NativeLocalMapViewport(
        centerLatitude = minLat + (maxLat - minLat) / 2.0,
        centerLongitude = centerPhase - 180.0,
        latitudeSpan = maxLat - minLat,
        longitudeSpan = span,
        arcStart = start,
    )
}
