package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativeLocalOsmTilePolicyTest {
    @Test fun invalidCameraNeverCreatesRemoteTileRequests() {
        assertNull(NativeLocalOsmTilePolicy.plan(0f, 600f, 1f, 0f, 0f))
        assertNull(NativeLocalOsmTilePolicy.plan(375f, 0f, 1f, 0f, 0f))
        assertNull(NativeLocalOsmTilePolicy.plan(375f, 600f, 0f, 0f, 0f))
        assertNull(NativeLocalOsmTilePolicy.plan(375f, 600f, 1f, Float.NaN, 0f))
    }

    @Test fun onlyUpToThirtyTwoVisibleHttpsXyzRasterTiles() {
        for (camera in listOf(
            floatArrayOf(375f, 600f, 1f),
            floatArrayOf(390f, 700f, 2f),
            floatArrayOf(900f, 620f, 24f),
            floatArrayOf(3840f, 2160f, 24f),
        )) {
            val plan = requireNotNull(NativeLocalOsmTilePolicy.plan(
                camera[0], camera[1], camera[2], 0f, 0f))
            assertTrue(plan.tiles.isNotEmpty())
            assertTrue(plan.tiles.size <= NativeLocalOsmTilePolicy.MAX_TILES)
            assertEquals(plan.tiles.size, plan.tiles.distinctBy {
                Triple(it.zoom, it.worldX, it.y)
            }.size)
            assertTrue(plan.tiles.all {
                it.zoom == plan.tileZoom &&
                    it.x in 0 until (1 shl it.zoom) &&
                    (((it.worldX % (1 shl it.zoom)) +
                        (1 shl it.zoom)) % (1 shl it.zoom)) == it.x &&
                    it.y in 0 until (1 shl it.zoom) &&
                    it.sizeDp > 0f &&
                    it.url == "https://tile.openstreetmap.org/" +
                        it.zoom + "/" + it.x + "/" + it.y + ".png" &&
                    it.leftDp < camera[0] &&
                    it.topDp < camera[1] &&
                    it.leftDp + it.sizeDp > 0f &&
                    it.topDp + it.sizeDp > 0f
            })
        }
    }

    @Test fun realGpsPhotoPinsShareSameMercatorTileCamera() {
        val plan = requireNotNull(NativeLocalOsmTilePolicy.plan(
            390f, 680f, 1f, 0f, 0f))
        val center = requireNotNull(NativeLocalOsmTilePolicy.point(plan, 0.0, 0.0))
        assertEquals(195f, center.first, 0.001f)
        assertEquals(340f, center.second, 0.001f)
        assertNull(NativeLocalOsmTilePolicy.point(plan, 89.0, 0.0))
        assertNull(NativeLocalOsmTilePolicy.point(plan, -89.0, 0.0))
        assertNotNull(NativeLocalOsmTilePolicy.point(plan, 35.0, 139.0))
        assertNull(NativeLocalOsmTilePolicy.point(plan, 35.0, Double.NaN))
        assertNull(NativeLocalOsmTilePolicy.point(plan, 35.0, 181.0))
        val panned = requireNotNull(NativeLocalOsmTilePolicy.plan(
            390f, 680f, 1f, 30f, 20f))
        val moved = requireNotNull(NativeLocalOsmTilePolicy.point(panned, 0.0, 0.0))
        assertEquals(center.first + 30f, moved.first, 0.001f)
        assertEquals(center.second + 20f, moved.second, 0.001f)
    }
}
