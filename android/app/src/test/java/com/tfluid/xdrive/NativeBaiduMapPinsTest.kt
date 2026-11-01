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

    @Test fun onlyCurrentVerifiedOwnerCameraCanBeRestoredAfterViewer() {
        val pose = NativeBaiduCameraPose(bounds, 35.505, 139.706,
            11.75f, 30f, -25f)
        assertTrue(pose.validFor(bounds))
        assertFalse(pose.validFor(OwnerBd09Bounds.WORLD))
        assertFalse(pose.copy(latitude = Double.NaN).validFor(bounds))
        assertFalse(pose.copy(longitude = 190.0).validFor(bounds))
        assertFalse(pose.copy(zoom = Float.NaN).validFor(bounds))
        assertFalse(pose.copy(zoom = 0f).validFor(bounds))
        assertFalse(pose.copy(zoom = 25f).validFor(bounds))
        assertFalse(pose.copy(rotate = Float.POSITIVE_INFINITY).validFor(bounds))
        assertFalse(pose.copy(overlook = Float.NEGATIVE_INFINITY).validFor(bounds))
        assertFalse(pose.copy(ownerBounds = OwnerBd09Bounds(
            139.0, 30.0, 140.0, 40.0)).validFor(bounds))
    }

    @Test fun nativePhotoCoversChooseTwelveCurrentOwnerRepresentativesDeterministically() {
        val signed = (0..63).map { index ->
            sample.copy(cellX = index % 8, cellY = index / 8,
                nodeId = index + 1000L, photoCount = (index % 4 + 1).toLong())
        }
        val chosen = nativeBaiduCoverCells(signed)
        assertEquals(12, chosen.size)
        assertEquals(4L, chosen.first().photoCount)
        assertEquals(3, chosen.first().cellX)
        assertEquals(0, chosen.first().cellY)
        assertEquals((0..63).filter { it % 4 == 3 }.take(12)
            .map { it + 1000L }, chosen.map { it.nodeId })
        assertEquals(emptyList<OwnerBd09Cell>(), nativeBaiduCoverCells(emptyList()))
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
