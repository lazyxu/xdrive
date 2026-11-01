package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Native city-sized photo-map viewport, no OSM tiles or device GPS. */
class NativeLocalMapViewportTest {
    @Test fun fitsCityPhotosAndPlacesNorthernMarkerAboveSouthern() {
        val frame = requireNotNull(nativeLocalMapViewport(listOf(
            30.1 to 120.1, 30.2 to 120.3, 30.4 to 120.2)))
        assertEquals(30.25, frame.centerLatitude, 1e-10)
        assertTrue(frame.longitudeSpan < 0.3)
        val south = requireNotNull(frame.position(30.1, 120.1, 390f, 600f))
        val north = requireNotNull(frame.position(30.4, 120.2, 390f, 600f))
        assertTrue(north.second < south.second)
        assertTrue(south.first in 30f..360f)
        assertTrue(north.second in 40f..560f)
        assertTrue(north.first > south.first)
    }

    @Test fun pointsEitherSideOfInternationalDateLineStayClose() {
        val frame = requireNotNull(nativeLocalMapViewport(
            listOf(5.0 to 179.9, 5.0 to -179.9)))
        assertEquals(0.2, frame.longitudeSpan, 1e-7)
        val east = requireNotNull(frame.position(5.0, 179.9, 390f, 430f))
        val west = requireNotNull(frame.position(5.0, -179.9, 390f, 430f))
        assertTrue(east.first < west.first)
        assertTrue(east.first in 30f..360f)
        assertTrue(west.first in 30f..360f)
        assertEquals(east.second, west.second, 0.01f)
    }

    @Test fun lonePhotoStartsInCenterAndUserPanOrZoomChangesOnlyDrawing() {
        val frame = requireNotNull(nativeLocalMapViewport(listOf(31.23 to 121.47)))
        val center = requireNotNull(frame.position(31.23, 121.47, 320f, 480f))
        assertEquals(160f, center.first, 0.01f)
        assertEquals(240f, center.second, 0.01f)
        val moved = requireNotNull(frame.position(
            31.23, 121.47, 320f, 480f, zoom = 5f, panX = 18f, panY = -23f))
        assertEquals(178f, moved.first, 0.01f)
        assertEquals(217f, moved.second, 0.01f)
    }

    @Test fun worldWidePinsFitWithoutSkippingLocations() {
        val frame = requireNotNull(nativeLocalMapViewport(
            listOf(-50.0 to -120.0, 50.0 to 120.0, 10.0 to 0.0)))
        for ((latitude, longitude) in listOf(
            -50.0 to -120.0, 50.0 to 120.0, 10.0 to 0.0
        )) {
            val p = requireNotNull(frame.position(latitude, longitude, 390f, 540f))
            assertTrue(p.first in 0f..390f)
            assertTrue(p.second in 0f..540f)
        }
    }

    @Test fun invalidAndEmptyCoordinatesNeverCreateMapOrPosition() {
        assertNull(nativeLocalMapViewport(emptyList()))
        assertNull(nativeLocalMapViewport(listOf(Double.NaN to 120.0, 95.0 to 12.0)))
        val frame = requireNotNull(nativeLocalMapViewport(listOf(
            Double.NaN to 120.0, 20.0 to 130.0)))
        assertEquals(20.0, frame.centerLatitude, 0.001)
        assertNull(frame.position(200.0, 130.0, 390f, 500f))
        assertNull(frame.position(20.0, 130.0, Float.NaN, 500f))
        assertNull(frame.position(20.0, 130.0, 390f, 0f))
    }

    @Test fun wrappedIdenticalDatelinePointsAreOnePlace() {
        val frame = requireNotNull(nativeLocalMapViewport(listOf(
            20.0 to 180.0, 20.0 to -180.0)))
        assertEquals(0.0, frame.longitudeSpan, 0.0)
        val a = requireNotNull(frame.position(20.0, 180.0, 375f, 540f))
        val b = requireNotNull(frame.position(20.0, -180.0, 375f, 540f))
        assertEquals(a.first, b.first, 0.001f)
        assertEquals(a.second, b.second, 0.001f)
    }
}
