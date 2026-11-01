package com.tfluid.xdrive

import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.min
import kotlin.math.tan

/** Optional OSM XYZ raster tiles in the native Compose local photo map. */
internal data class NativeLocalOsmTile(
    val zoom: Int,
    val x: Int,
    val y: Int,
    // The world tile column is intentionally NOT wrapped, so repeated
    // longitude tiles retain independent, stable Compose identity on pan.
    val worldX: Int,
    val leftDp: Float,
    val topDp: Float,
    val sizeDp: Float,
) {
    val url: String get() = "https://tile.openstreetmap.org/$zoom/$x/$y.png"
}

internal data class NativeLocalOsmPlan(
    val widthDp: Float,
    val heightDp: Float,
    val worldScaleDp: Double,
    val originXDp: Double,
    val originYDp: Double,
    val tileZoom: Int,
    val tiles: List<NativeLocalOsmTile>,
)

internal object NativeLocalOsmTilePolicy {
    const val MAX_TILES = 32
    const val MAX_LATITUDE = 85.05112878
    private const val MAX_ZOOM = 17
    private const val TILE_WIDTH = 256.0

    private fun mercatorY(latitude: Double): Double {
        val radians = latitude.coerceIn(-MAX_LATITUDE, MAX_LATITUDE) * Math.PI / 180.0
        return (1.0 - ln(tan(Math.PI / 4.0 + radians / 2.0)) / Math.PI) / 2.0
    }

    /** Tiles and actual authorized MediaStore photo markers share precisely
     * the same world scale, pan and WGS84→Web Mercator projection. */
    fun plan(
        widthDp: Float, heightDp: Float, zoom: Float,
        panXDp: Float, panYDp: Float,
    ): NativeLocalOsmPlan? {
        if (!widthDp.isFinite() || !heightDp.isFinite() || !zoom.isFinite() ||
            !panXDp.isFinite() || !panYDp.isFinite() ||
            widthDp !in 64f..8192f || heightDp !in 64f..8192f ||
            zoom !in 1f..24f) return null
        val scale = min(widthDp.toDouble(), heightDp.toDouble()) * zoom
        val originX = scale / 2.0 - widthDp / 2.0 - panXDp
        val originY = scale / 2.0 - heightDp / 2.0 - panYDp
        val initialZoom = floor(log2(scale / TILE_WIDTH))
            .toInt().coerceIn(0, MAX_ZOOM)

        fun visibleAt(z: Int): List<NativeLocalOsmTile> {
            val count = 1 shl z
            val sizeDp = scale / count
            val west = floor(originX / sizeDp).toInt()
            val east = floor((originX + widthDp - 0.001) / sizeDp).toInt()
            val north = maxOf(0, floor(originY / sizeDp).toInt())
            val south = min(count - 1, floor((originY + heightDp - 0.001) / sizeDp).toInt())
            val tiles = ArrayList<NativeLocalOsmTile>(MAX_TILES + 1)
            for (y in north..south) {
                for (x in west..east) {
                    val wrappedX = ((x % count) + count) % count
                    tiles += NativeLocalOsmTile(z, wrappedX, y, x,
                        (x * sizeDp - originX).toFloat(),
                        (y * sizeDp - originY).toFloat(), sizeDp.toFloat())
                    if (tiles.size > MAX_TILES) return tiles
                }
            }
            return tiles
        }

        var z = initialZoom
        var tiles = visibleAt(z)
        while (tiles.size > MAX_TILES && z > 0) {
            z--
            tiles = visibleAt(z)
        }
        return NativeLocalOsmPlan(widthDp, heightDp, scale, originX, originY,
            z, tiles.take(MAX_TILES))
    }

    /** EPSG:3857 cannot represent polar photos beyond ±85.05°. They remain
     * visible on the unchanged full-WGS84 diagram with tiles disabled. */
    fun point(plan: NativeLocalOsmPlan, latitude: Double, longitude: Double):
        Pair<Float, Float>? {
        if (!latitude.isFinite() || !longitude.isFinite() ||
            latitude !in -MAX_LATITUDE..MAX_LATITUDE ||
            longitude !in -180.0..180.0) return null
        val x = (longitude + 180.0) / 360.0 * plan.worldScaleDp - plan.originXDp
        val y = mercatorY(latitude) * plan.worldScaleDp - plan.originYDp
        if (!x.isFinite() || !y.isFinite() ||
            x < 0 || x > plan.widthDp || y < 0 || y > plan.heightDp) return null
        return x.toFloat() to y.toFloat()
    }
}
