package com.tfluid.xdrive

import com.tfluid.xdrive.core.OwnerBd09Bounds
import com.tfluid.xdrive.core.OwnerBd09Cell
import org.junit.Assert.*
import org.junit.Test

/** Go 8×8 geometry alignment; no SDK keys, WGS84 conversion or map tiles. */
class Bd09GridDrilldownTest {
    private fun cell(x: Int, y: Int, lat: Double, lon: Double) =
        OwnerBd09Cell(x, y, 5, 10, 20, 3, lat, lon)

    @Test fun worldGridAndChildGridMatchPositiveGoCellWidths() {
        val world = OwnerBd09Bounds.WORLD
        val child = bd09CellSubBounds(world, cell(7, 5, 35.505, 139.706))!!
        assertEquals(135.0, child.west, 1e-9)
        assertEquals(180.0, child.east, 1e-9)
        assertEquals(22.5, child.south, 1e-9)
        assertEquals(45.0, child.north, 1e-9)
        assertTrue(child.contains(35.505, 139.706))
        val next = bd09CellSubBounds(child, cell(0, 4, 35.505, 139.706))!!
        assertEquals(135.0, next.west, 1e-9)
        assertEquals(140.625, next.east, 1e-9)
        assertTrue(next.contains(35.505, 139.706))
        assertEquals(0f, bd09ViewportFraction(world, 0.0, -180.0)!!.first, .0001f)
        assertEquals(1f, bd09ViewportFraction(world, 0.0, 180.0)!!.first, .0001f)
        assertEquals(.5f, bd09ViewportFraction(world, 0.0, 0.0)!!.first, .0001f)
    }

    @Test fun wrappedDatelineGridKeepsActualBD09BinAndNoFakeCenter() {
        val parent = OwnerBd09Bounds(170.0, -20.0, -170.0, 20.0)
        val child = bd09CellSubBounds(parent, cell(4, 4, 1.0, -179.0))!!
        assertEquals(180.0, child.west, 1e-9)
        assertEquals(-177.5, child.east, 1e-9)
        assertEquals(0.0, child.south, 1e-9)
        assertEquals(5.0, child.north, 1e-9)
        assertTrue(child.contains(1.0, -179.0))
        assertEquals(.55f, bd09ViewportFraction(parent, 1.0, -179.0)!!.first, .0001f)
        assertEquals(.475f, bd09ViewportFraction(parent, 1.0, -179.0)!!.second, .0001f)
        assertNull(bd09ViewportFraction(parent, 1.0, -150.0))
    }

    @Test fun invalidSignedCellOrUnstableZoomNeverMakesABoundsRequest() {
        val world = OwnerBd09Bounds.WORLD
        val valid = cell(7, 5, 35.505, 139.706)
        assertNull(bd09CellSubBounds(world, valid.copy(cellX = -1)))
        assertNull(bd09CellSubBounds(world, valid.copy(cellY = 8)))
        assertNull(bd09CellSubBounds(world, valid.copy(nodeRevision = 0)))
        assertNull(bd09CellSubBounds(world, valid.copy(photoCount = 0)))
        assertNull(bd09CellSubBounds(world, valid.copy(latitude = 80.0, longitude = 200.0)))
        val tiny = OwnerBd09Bounds(0.0, 0.0, 1.1e-10, 1.0)
        assertNull(bd09CellSubBounds(tiny, cell(0, 0, .05, 1e-11)))
        assertNull(bd09ViewportFraction(world, 100.0, 0.0))
    }
}
