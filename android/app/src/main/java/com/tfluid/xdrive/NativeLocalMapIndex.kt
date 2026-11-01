package com.tfluid.xdrive

import kotlin.math.floor

/** Local WGS84 geometry, independent of the remote Owner BD-09 signed-cell protocol. */
internal data class NativeLocalMapKey(
    val level: Int, val latitudeCell: Int, val longitudeCell: Int,
)

internal data class NativeLocalMapCell<T>(
    val key: NativeLocalMapKey,
    val latitude: Double,
    val longitude: Double,
    val representative: T,
    val count: Int,
    val firstSeen: Int,
    val members: List<T>,
)

/** Streaming, immutable photo-map index. At most 64 cells and 48 preview
 * members per cell, even when the Android MediaStore contains 100k assets.
 * Aggregated counts include every scanned valid GPS asset. */
internal class NativeLocalMapIndex<T> private constructor(
    val level: Int,
    val locatedCount: Int,
    private val buckets: Map<NativeLocalMapKey, NativeLocalMapCell<T>>,
) {
    constructor() : this(0, 0, emptyMap())

    val cells: List<NativeLocalMapCell<T>> get() = buckets.values.sortedWith(
        compareByDescending<NativeLocalMapCell<T>> { it.count }
            .thenBy { it.firstSeen }.thenBy { it.key.latitudeCell }
            .thenBy { it.key.longitudeCell }
    )

    fun append(latitude: Double, longitude: Double, value: T): NativeLocalMapIndex<T> {
        val key = keyFor(latitude, longitude, level) ?: return this
        val nextCount = locatedCount + 1
        val next = buckets.toMutableMap()
        val previous = next[key]
        next[key] = if (previous == null) NativeLocalMapCell(
            key, latitude, longitude, value, 1, nextCount, listOf(value)
        ) else previous.copy(
            count = previous.count + 1,
            members = if (previous.members.size < MAX_PREVIEW_ITEMS)
                previous.members + value else previous.members,
        )
        var nextLevel = level
        var grouped: Map<NativeLocalMapKey, NativeLocalMapCell<T>> = next
        while (grouped.size > MAX_CELLS) {
            check(nextLevel < MAX_LEVEL) { "Native GPS cell budget exceeded" }
            nextLevel++
            val folded = linkedMapOf<NativeLocalMapKey, NativeLocalMapCell<T>>()
            for (cell in grouped.values.sortedBy { it.firstSeen }) {
                val mergedKey = checkNotNull(keyFor(cell.latitude, cell.longitude, nextLevel))
                val prior = folded[mergedKey]
                folded[mergedKey] = if (prior == null) cell.copy(key = mergedKey)
                else prior.copy(
                    count = prior.count + cell.count,
                    members = (prior.members + cell.members).take(MAX_PREVIEW_ITEMS),
                )
            }
            grouped = folded
        }
        check(grouped.values.sumOf { it.count } == nextCount)
        return NativeLocalMapIndex(nextLevel, nextCount, grouped)
    }

    companion object {
        const val MAX_CELLS = 64
        const val MAX_PREVIEW_ITEMS = 48
        private const val MAX_LEVEL = 14
        private const val BASE_DEGREES = 0.02

        fun keyFor(latitude: Double, longitude: Double, level: Int): NativeLocalMapKey? {
            if (level !in 0..MAX_LEVEL || !latitude.isFinite() || !longitude.isFinite() ||
                latitude !in -90.0..90.0 || longitude !in -180.0..180.0) return null
            val step = BASE_DEGREES * (1 shl level)
            val lon = if (longitude == 180.0) -180.0 else longitude
            return NativeLocalMapKey(
                level,
                floor((latitude + 90.0) / step).toInt(),
                floor((lon + 180.0) / step).toInt(),
            )
        }
    }
}
