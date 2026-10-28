package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Real Go Owner /media/places/overview; map rendering and BD-09 remain separate. */
class OwnerMapOverviewTest {
    private val sample =
        """{"id":"map-region:q:-180:-90:180:90:0:0","name":"照片区域 1-1",
            "sample_latitude":35.5,"sample_longitude":139.7,
            "latitude":35.5,"longitude":139.7,"coordinate_kind":"map_region_sample",
            "item_count":3,"cover_node_id":42}"""

    private fun overview(item: String = sample, count: String = "3",
        aggregated: String = "true"): String =
        """{"items":[$item],"total_photo_count":$count,"aggregated":$aggregated}"""

    private fun address(server: MockWebServer) =
        ServerAddress.parse(server.url("/").toString(), allowHttp = true)

    private suspend fun mustReject(api: XDriveApi, body: String) {
        try {
            api.placesMapOverview("owner-secret", OwnerMapBounds.WORLD)
            fail("Malformed or untrusted map overview was accepted: $body")
        } catch (e: ApiException) {
            assertEquals(ApiFailureReason.INVALID_RESPONSE, e.reason)
            assertFalse(e.toString().contains("owner-secret"))
        }
    }

    @Test fun worldOverviewUsesOneOwnerBearerAndAtMost64RealWgs84Samples() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(overview()))
            val summary = api.placesMapOverview("owner-secret", OwnerMapBounds.WORLD)
            assertTrue(summary.aggregated)
            assertEquals(3L, summary.totalPhotoCount)
            assertEquals(1, summary.samples.size)
            val sample = summary.samples.single()
            assertEquals(35.5, sample.sampleLatitude, 0.0)
            assertEquals(139.7, sample.sampleLongitude, 0.0)
            assertEquals("map_region_sample", sample.coordinateKind)
            assertEquals(3L, sample.itemCount)
            assertEquals(42L, sample.coverNodeId)
            val sent = server.takeRequest()
            assertEquals("GET", sent.method)
            assertEquals("/api/v1/media/places/overview",
                sent.requestUrl!!.encodedPath)
            assertEquals("-180.0", sent.requestUrl!!.queryParameter("west"))
            assertEquals("-90.0", sent.requestUrl!!.queryParameter("south"))
            assertEquals("180.0", sent.requestUrl!!.queryParameter("east"))
            assertEquals("90.0", sent.requestUrl!!.queryParameter("north"))
            assertEquals("0", sent.requestUrl!!.queryParameter("detail"))
            assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            assertFalse(sent.path!!.contains("owner-secret"))
            assertNull(sent.getHeader("Referer"))
        } }
    }

    @Test fun detailModePreservesOriginalOwnerGridSampleNotSyntheticCenter() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val point = """{"id":"place:3550:13970","name":"东京附近",
                "sample_latitude":35.505,"sample_longitude":139.706,
                "latitude":35.505,"longitude":139.705,
                "coordinate_kind":"grid_cell_center","item_count":1}"""
            server.enqueue(MockResponse().setBody(overview(point, "1", "false")))
            val viewport = OwnerMapBounds(139.0, 35.0, 140.0, 36.0)
            val result = api.placesMapOverview("owner-secret", viewport, true)
            assertFalse(result.aggregated)
            assertEquals(35.505, result.samples.single().sampleLatitude, 0.0)
            assertEquals(139.706, result.samples.single().sampleLongitude, 0.0)
            assertEquals(139.705, result.samples.single().longitude, 0.0)
            assertNull(result.samples.single().coverNodeId)
            val requested = server.takeRequest()
            assertEquals("1", requested.requestUrl!!.queryParameter("detail"))
            assertEquals("139.0", requested.requestUrl!!.queryParameter("west"))
        } }
    }

    @Test fun datelineAndEmptyWorldOverviewAreRealGoSupportedInputs() = runBlocking {
        val crossing = OwnerMapBounds(170.0, -20.0, -170.0, 20.0)
        assertTrue(crossing.valid())
        assertTrue(crossing.contains(0.0, 179.9))
        assertTrue(crossing.contains(0.0, -179.9))
        assertFalse(crossing.contains(0.0, 0.0))
        assertTrue(OwnerMapBounds.WORLD.contains(90.0, 180.0))
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[],"total_photo_count":0,"aggregated":true
            }"""))
            val result = api.placesMapOverview("owner-secret", crossing)
            assertTrue(result.aggregated)
            assertTrue(result.samples.isEmpty())
            assertEquals(0L, result.totalPhotoCount)
            assertEquals("-170.0", server.takeRequest().requestUrl!!
                .queryParameter("east"))
        } }
    }

    @Test fun malformedCoordinatesAndDegenerateCameraFailBeforeAnyHttpRequest() {
        for (invalid in listOf(
            OwnerMapBounds(0.0, 0.0, 0.0, 1.0),
            OwnerMapBounds(180.0, -90.0, -180.0, 90.0),
            OwnerMapBounds(-200.0, 0.0, 20.0, 30.0),
            OwnerMapBounds(-180.0, -95.0, 180.0, 90.0),
            OwnerMapBounds(-180.0, -90.0, 180.0, Double.NaN),
            OwnerMapBounds(Double.POSITIVE_INFINITY, -90.0, 180.0, 90.0),
        )) {
            assertFalse(invalid.valid())
            MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
                try { runBlocking { api.placesMapOverview("owner-secret", invalid) }
                    fail("Invalid camera accepted")
                } catch (_: IllegalArgumentException) {}
                assertEquals(0, server.requestCount)
            } }
        }
    }

    @Test fun malformedOwnerOverviewFailsClosedWithoutPartialMapOrFallback() = runBlocking {
        val bad = listOf(
            overview(count = "4"),
            overview(count = "-1"),
            overview(aggregated = "false"),
            overview().replace("\"items\":[", "\"items\":\"not a list\""),
            overview().replace("\"aggregated\":true", "\"aggregated\":\"true\""),
            overview().replace("\"sample_latitude\":35.5", "\"sample_latitude\":999"),
            overview().replace("\"sample_longitude\":139.7", "\"sample_longitude\":\"139.7\""),
            overview().replace("\"coordinate_kind\":\"map_region_sample\"",
                "\"coordinate_kind\":\"grid_cell_center\""),
            overview().replace("\"map-region:q:", "\"place:"),
            overview().replace("\"item_count\":3", "\"item_count\":0"),
            overview().replace("\"cover_node_id\":42", "\"cover_node_id\":-1"),
            overview(sample + "," + sample, count = "6"),
            overview(List(65) { index -> sample.replace(":0:0", ":0:$index")
                .replace("\"item_count\":3", "\"item_count\":1") }.joinToString(","), "65"),
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (raw in bad) {
                server.enqueue(MockResponse().setBody(raw))
                mustReject(api, raw)
                val sent = server.takeRequest()
                assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            }
            assertEquals(bad.size, server.requestCount)
        } }
    }

    @Test fun missingOwnerOverviewEndpointNeverInventsEmptyPhotoMap() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(404))
            try {
                api.placesMapOverview("owner-secret", OwnerMapBounds.WORLD)
                fail("Missing Go endpoint treated as empty GPS")
            } catch (e: ApiException) {
                assertEquals(404, e.statusCode)
            }
        } }
    }
}
