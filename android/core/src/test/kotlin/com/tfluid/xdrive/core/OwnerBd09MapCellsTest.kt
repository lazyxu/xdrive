package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** WGS84 Owner GPS and verified BD09LL are different read-only wire contracts. */
class OwnerBd09MapCellsTest {
    private val point =
        """{"cell_x":3,"cell_y":4,"photo_count":5,"asset_id":70,
            "node_id":42,"node_revision":9,"latitude":35.505,
            "longitude":139.706}"""

    private fun cells(
        entries: String = point, count: String = "5",
        space: String = "bd09ll", index: String = "owner_gps_auto_index",
        columns: String = "8", rows: String = "8",
    ): String = """{"coordinate_space":"$space","index_scope":"$index",
        "cells":[$entries],"total_count":$count,"grid_columns":$columns,
        "grid_rows":$rows}"""

    private fun address(server: MockWebServer) =
        ServerAddress.parse(server.url("/").toString(), true)

    private suspend fun rejects(api: XDriveApi): ApiException {
        try { api.baiduNativeMapCells("owner-secret", OwnerBd09Bounds.WORLD) }
        catch (error: ApiException) { return error }
        throw AssertionError("Invalid owner BD09 cells were accepted")
    }

    @Test fun canonicalBd09OwnerCellsStayInTheirOwnCoordinateSpace() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(cells()))
            val result = api.baiduNativeMapCells("owner-secret", OwnerBd09Bounds.WORLD)
            assertEquals(5L, result.totalPhotoCount)
            assertEquals(1, result.cells.size)
            val sample = result.cells.single()
            assertEquals(3, sample.cellX)
            assertEquals(4, sample.cellY)
            assertEquals(5L, sample.photoCount)
            assertEquals(70L, sample.assetId)
            assertEquals(42L, sample.nodeId)
            assertEquals(9L, sample.nodeRevision)
            assertEquals(35.505, sample.latitude, 0.0)
            assertEquals(139.706, sample.longitude, 0.0)
            val req = server.takeRequest()
            assertEquals("GET", req.method)
            assertEquals("/api/v1/media/places/baidu-jsapi/cells",
                req.requestUrl!!.encodedPath)
            assertEquals(mapOf(
                "west" to "-180.0", "south" to "-90.0",
                "east" to "180.0", "north" to "90.0",
            ), req.requestUrl!!.queryParameterNames.associateWith {
                req.requestUrl!!.queryParameter(it)
            })
            assertEquals("Bearer owner-secret", req.getHeader("Authorization"))
            assertFalse(req.path!!.contains("owner-secret"))
            assertFalse(req.path!!.contains("coordinate_space"))
            assertFalse(req.path!!.contains("api_key"))
        } }
        Unit
    }

    @Test fun aWorldQueryCanBeEmptyWithoutInventingMapPositions() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(cells("", "0")))
            val result = api.baiduNativeMapCells("owner-secret", OwnerBd09Bounds.WORLD)
            assertTrue(result.cells.isEmpty())
            assertEquals(0L, result.totalPhotoCount)
            server.takeRequest()
        } }
        Unit
    }

    @Test fun bd09AntimeridianRequestIsBoundedAndNeverConvertedFromWgs84() = runBlocking {
        val bounds = OwnerBd09Bounds(170.0, -25.0, -170.0, 25.0)
        assertTrue(bounds.valid())
        assertTrue(bounds.contains(0.0, 179.0))
        assertTrue(bounds.contains(0.0, -179.0))
        assertFalse(bounds.contains(0.0, 0.0))
        assertFalse(bounds.contains(Double.NaN, 179.0))
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val p = point.replace("35.505", "0.5")
                .replace("139.706", "179.2")
            server.enqueue(MockResponse().setBody(cells(p)))
            val result = api.baiduNativeMapCells("owner-secret", bounds)
            assertEquals(179.2, result.cells.single().longitude, 0.0)
            assertEquals("170.0", server.takeRequest().requestUrl!!.queryParameter("west"))
        } }
        Unit
    }

    @Test fun malformedBd09ViewportRejectsRequestBeforeNetworkIo() {
        val invalid = listOf(
            OwnerBd09Bounds(0.0, 0.0, 0.0, 5.0),
            OwnerBd09Bounds(180.0, -90.0, -180.0, 90.0),
            OwnerBd09Bounds(181.0, 0.0, 3.0, 5.0),
            OwnerBd09Bounds(-180.0, -91.0, 180.0, 90.0),
            OwnerBd09Bounds(Double.NaN, -90.0, 180.0, 90.0),
            OwnerBd09Bounds(-180.0, -90.0, 180.0, Double.POSITIVE_INFINITY),
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            invalid.forEach {
                assertFalse(it.valid())
                try {
                    runBlocking { api.baiduNativeMapCells("owner-secret", it) }
                    fail("Invalid BD09 map query accepted")
                } catch (_: IllegalArgumentException) {}
            }
            assertEquals(0, server.requestCount)
        } }
    }

    @Test fun forgedOrPartialOwnerMapIndexFailsClosedRatherThanPaintingPins() = runBlocking {
        val malformed = listOf(
            cells(space = "wgs84ll"),
            cells(index = "foreign_owner"),
            cells(columns = "7"),
            cells(rows = "9"),
            cells(count = "4"),
            cells(count = "-1"),
            cells(entries = "$point,$point", count = "10"),
            cells(entries = point.replace("\"cell_x\":3", "\"cell_x\":8")),
            cells(entries = point.replace("\"cell_y\":4", "\"cell_y\":-1")),
            cells(entries = point.replace("\"asset_id\":70", "\"asset_id\":0")),
            cells(entries = point.replace("\"node_id\":42", "\"node_id\":0")),
            cells(entries = point.replace("\"node_revision\":9", "\"node_revision\":0")),
            cells(entries = point.replace("\"photo_count\":5", "\"photo_count\":0")),
            cells(entries = point.replace("\"latitude\":35.505", "\"latitude\":91.0")),
            cells(entries = point.replace("\"longitude\":139.706", "\"longitude\":200.0")),
            cells(entries = point.replace("\"longitude\":139.706", "\"longitude\":\"139.706\"")),
            cells(entries = point.replace("\"node_id\":42",
                "\"node_id\":42,\"source_latitude\":35.5")),
            cells(entries = point.replace("\"node_id\":42",
                "\"node_id\":42,\"media_kind\":\"image\"")),
            cells(entries = List(65) { i ->
                point.replace("\"cell_x\":3", "\"cell_x\":${i%8}")
                    .replace("\"cell_y\":4", "\"cell_y\":${i/8}")
                    .replace("\"asset_id\":70", "\"asset_id\":${i+70}")
                    .replace("\"node_id\":42", "\"node_id\":${i+42}")
                    .replace("\"photo_count\":5", "\"photo_count\":1")
            }.joinToString(","), count = "65"),
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            malformed.forEach { input ->
                server.enqueue(MockResponse().setBody(input))
                val error = rejects(api)
                assertEquals(ApiFailureReason.INVALID_RESPONSE, error.reason)
                assertFalse(error.toString().contains("owner-secret"))
                val req = server.takeRequest()
                assertEquals("Bearer owner-secret", req.getHeader("Authorization"))
            }
            assertEquals(malformed.size, server.requestCount)
        } }
        Unit
    }

    @Test fun unavailableSignedMapReleaseAndDeniedOwnerNeverPretendEmpty() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (status in listOf(403, 503, 404)) {
                server.enqueue(MockResponse().setResponseCode(status).setBody("{}"))
                try {
                    api.baiduNativeMapCells("owner-secret", OwnerBd09Bounds.WORLD)
                    fail("Map status $status incorrectly treated as an empty Owner map")
                } catch (error: ApiException) {
                    assertEquals(status, error.statusCode)
                }
                server.takeRequest()
            }
        } }
        Unit
    }
}
