package com.tfluid.xdrive

import com.tfluid.xdrive.core.OwnerBd09Bounds
import com.tfluid.xdrive.core.OwnerBd09Cell
import com.tfluid.xdrive.core.OwnerBd09MapCells
import org.junit.Assert.*
import org.junit.Test

/** The map SDK must never turn WGS84, guessed bin centers or invalid Owner
 * DTOs into apparent signed BD09 coordinates. Pure JVM, no SDK/AK required. */
class NativeBaiduMapPinsTest {
    private val bounds = OwnerBd09Bounds(130.0, 30.0, 145.0, 45.0)
    private val sample = OwnerBd09Cell(
        cellX = 4, cellY = 2, photoCount = 5, assetId = 31,
        nodeId = 47, nodeRevision = 9,
        latitude = 35.505, longitude = 139.706,
    )

    @Test fun oneRealBaiduOwnerRepresentativeIsKeptExactly() {
        val result = OwnerBd09MapCells(listOf(sample), 5L)
        val pins = requireNotNull(nativeVerifiedBaiduPins(bounds, result))
        assertEquals(listOf(sample), pins)
        assertEquals(35.505, pins.single().latitude, 0.0)
        assertEquals(139.706, pins.single().longitude, 0.0)
        assertEquals(47L, pins.single().nodeId)
        assertEquals(9L, pins.single().nodeRevision)
    }

    @Test fun validEmptyOwnerRangeProducesNoFakeMapMarkers() {
        assertEquals(emptyList<OwnerBd09Cell>(),
            nativeVerifiedBaiduPins(bounds, OwnerBd09MapCells(emptyList(), 0L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(emptyList(), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample), 0L)))
    }

    @Test fun neverTrustDuplicateOrOutOfBoundsOrUnverifiedNodes() {
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample, sample), 10L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(cellX = 8)), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(nodeRevision = 0)), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(latitude = -30.0)), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(longitude = Double.NaN)), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(photoCount = 6)), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(assetId = -1)), 5L)))
    }

    @Test fun acceptsAtMostSixtyFourDifferentSignedCells() {
        val world = OwnerBd09Bounds.WORLD
        val pins = (0..63).map { index ->
            sample.copy(cellX = index % 8, cellY = index / 8,
                latitude = 35.505, longitude = 139.706,
                assetId = index + 1L, nodeId = index + 100L)
        }
        val verified = requireNotNull(nativeVerifiedBaiduPins(world,
            OwnerBd09MapCells(pins, 64L * 5L)))
        assertEquals(64, verified.size)
        assertNull(nativeVerifiedBaiduPins(world,
            OwnerBd09MapCells(pins + sample.copy(
                cellX = 0, cellY = 0, nodeId = 999L), 65L * 5L)))
    }

    @Test fun nativeCameraUsesActualBd09RectangleAndWrappedDateline() {
        assertEquals(OwnerBd09Bounds(130.0, 30.0, 145.0, 45.0),
            nativeBaiduCameraBounds(30.0, 130.0, 45.0, 145.0))
        assertEquals(OwnerBd09Bounds(170.0, -5.0, -170.0, 5.0),
            nativeBaiduCameraBounds(-5.0, 170.0, 5.0, -170.0))
        assertNull(nativeBaiduCameraBounds(30.0, 130.0, 30.0, 145.0))
        assertNull(nativeBaiduCameraBounds(Double.NaN, 130.0, 45.0, 145.0))
        assertNull(nativeBaiduCameraBounds(30.0, 130.0, 45.0, 130.0))
        assertNull(nativeBaiduCameraBounds(30.0, 130.0, 91.0, 145.0))
    }

    @Test fun viewerCameraRestoreRequiresExactSignedOwnerRectAndValidSdkTarget() {
        val saved = NativeBaiduCameraBookmark(bounds, 35.505, 139.706, 13f)
        assertTrue(saved.canRestore(bounds))
        assertFalse(saved.canRestore(OwnerBd09Bounds.WORLD))
        assertFalse(saved.copy(signedBounds = OwnerBd09Bounds.WORLD).canRestore(bounds))
        assertFalse(saved.copy(latitude = Double.NaN).canRestore(bounds))
        assertFalse(saved.copy(latitude = -2.0).canRestore(bounds))
        assertFalse(saved.copy(longitude = Double.POSITIVE_INFINITY).canRestore(bounds))
        assertFalse(saved.copy(longitude = 25.0).canRestore(bounds))
        assertFalse(saved.copy(zoom = Float.NaN).canRestore(bounds))
        assertFalse(saved.copy(zoom = 0f).canRestore(bounds))
        assertFalse(saved.copy(zoom = 99f).canRestore(bounds))

        val wrapped = OwnerBd09Bounds(170.0, -5.0, -170.0, 5.0)
        val acrossDateLine = NativeBaiduCameraBookmark(wrapped, 0.0, 179.8, 9f)
        assertTrue(acrossDateLine.canRestore(wrapped))
        assertTrue(acrossDateLine.copy(longitude = -179.8).canRestore(wrapped))
        assertFalse(acrossDateLine.copy(longitude = 20.0).canRestore(wrapped))
    }

    @Test fun invalidBoundsAndImpossibleLongCountsFailClosed() {
        assertNull(nativeVerifiedBaiduPins(
            OwnerBd09Bounds(0.0, 0.0, 0.0, 10.0),
            OwnerBd09MapCells(listOf(sample), 5L)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample), Long.MAX_VALUE)))
        assertNull(nativeVerifiedBaiduPins(bounds,
            OwnerBd09MapCells(listOf(sample.copy(photoCount = Long.MAX_VALUE)), 5L)))
    }
}
