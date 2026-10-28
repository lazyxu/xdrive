package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Native map cell → original Owner Gallery Range: existing signed Go scope. */
class OwnerBd09MapCellItemsTest {
    private val bounds = OwnerBd09Bounds.WORLD
    private val cell = OwnerBd09Cell(
        cellX = 7, cellY = 5, photoCount = 70,
        assetId = 61, nodeId = 40, nodeRevision = 9,
        latitude = 35.505, longitude = 139.706,
    )
    private val row = """{"node":{"id":40,"parent_id":1,"name":"sample.jpg",
        "type":"file","size":128,"revision":9},
        "metadata":{"media_kind":"image","captured_at":"2026-10-25T12:00:00Z",
        "has_thumbnail":true},"favorite":false}"""
    private fun page(items: String = row, total: String = "1",
        offset: String = "0", limit: String = "60") =
        """{"items":[$items],"total_count":$total,"offset":$offset,"limit":$limit}"""
    private fun address(server: MockWebServer) =
        ServerAddress.parse(server.url("/").toString(), true)

    private suspend fun failure(api: XDriveApi, offset: Int = 0): ApiException {
        try { api.galleryBd09CellPage("owner-secret", bounds, cell, offset) }
        catch (error: ApiException) { return error }
        throw AssertionError("Bad signed Owner map range was accepted")
    }

    @Test fun verifiedCellUsesExactlyServerReviewedOwnerScope() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(page()))
            val result = api.galleryBd09CellPage("owner-secret", bounds, cell)
            assertEquals(1L, result.totalCount)
            assertEquals(0, result.offset)
            assertEquals(60, result.limit)
            assertEquals(40L, result.items.single().node.id)
            assertEquals(9L, result.items.single().node.revision)
            assertNull(result.timeline)
            val request = server.takeRequest()
            assertEquals("GET", request.method)
            assertEquals("Bearer owner-secret", request.getHeader("Authorization"))
            assertEquals("/api/v1/media/places/baidu-jsapi/cell-items",
                request.requestUrl!!.encodedPath)
            val query = request.requestUrl!!
            assertEquals(setOf(
                "west","south","east","north","cell_x","cell_y",
                "asset_id","node_id","node_revision","photo_count","range",
                "limit","offset","sort_by","sort_dir",
            ), query.queryParameterNames)
            assertEquals("-180.0", query.queryParameter("west"))
            assertEquals("180.0", query.queryParameter("east"))
            assertEquals("7", query.queryParameter("cell_x"))
            assertEquals("5", query.queryParameter("cell_y"))
            assertEquals("61", query.queryParameter("asset_id"))
            assertEquals("40", query.queryParameter("node_id"))
            assertEquals("9", query.queryParameter("node_revision"))
            assertEquals("70", query.queryParameter("photo_count"))
            assertEquals("60", query.queryParameter("limit"))
            assertEquals("0", query.queryParameter("offset"))
            assertEquals("true", query.queryParameter("range"))
            assertEquals("desc", query.queryParameter("sort_dir"))
            for (name in listOf("owner_id","user","ak","browser_ak",
                "coordinate_space","source_latitude","fold_duplicates",
                "initial_position")) assertNull(query.queryParameter(name))
            assertFalse(request.path!!.contains("owner-secret"))
        } }
    }

    @Test fun scopedDeepPageKeepsServerOffsetAndNeverLoadsPriorRows() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(page(total="61",offset="60")))
            val result = api.galleryBd09CellPage("owner-secret",
                bounds, cell, offset=60, sortBy="added", sortDir="asc")
            assertEquals(60, result.offset)
            assertEquals(61L, result.totalCount)
            assertEquals(1, result.items.size)
            val request = server.takeRequest()
            assertEquals("60", request.requestUrl!!.queryParameter("offset"))
            assertEquals("added", request.requestUrl!!.queryParameter("sort_by"))
            assertEquals("asc", request.requestUrl!!.queryParameter("sort_dir"))
            assertNull(request.requestUrl!!.queryParameter("initial_position"))
            assertEquals(1, server.requestCount)
        } }
    }

    @Test fun malformedOrWidenedMapRangeNeverBecomesOrdinaryGalleryData() = runBlocking {
        val malformed = listOf(
            page(total="71"), // signed cell asserted only 70 source photos
            page(total="-1"),
            page(offset="1"),
            page(limit="100"),
            page(items="$row,$row",total="2"),
            page(items="",total="1"),
            page(items=row.replace("\"revision\":9", "\"revision\":0")),
            page(items=row.replace("\"media_kind\":\"image\"", "\"media_kind\":\"audio\"")),
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (body in malformed) {
                server.enqueue(MockResponse().setBody(body))
                assertEquals(ApiFailureReason.INVALID_RESPONSE, failure(api).reason)
                assertEquals("/api/v1/media/places/baidu-jsapi/cell-items",
                    server.takeRequest().requestUrl!!.encodedPath)
            }
            assertEquals(malformed.size, server.requestCount)
        } }
    }

    @Test fun signedReleaseAndStaleCellErrorsAreNotEmptyGallery() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (status in listOf(403, 404, 409, 503)) {
                server.enqueue(MockResponse().setResponseCode(status).setBody("{}"))
                val error = failure(api)
                assertEquals(status, error.statusCode)
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("Bearer owner-secret", request.getHeader("Authorization"))
            }
            assertEquals(4, server.requestCount)
        } }
    }

    @Test fun malformedCellsAndBoundsStopBeforeAnyNetworkRequest() {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val invalid = listOf(
                cell.copy(cellX=8),
                cell.copy(cellY=-1),
                cell.copy(photoCount=0),
                cell.copy(assetId=0),
                cell.copy(nodeId=0),
                cell.copy(nodeRevision=0),
                cell.copy(longitude=-140.0).let { it.copy(latitude=91.0) },
            )
            for (bad in invalid) {
                try {
                    runBlocking { api.galleryBd09CellPage("owner-secret", bounds, bad) }
                    fail("Invalid cell accepted: $bad")
                } catch (_: IllegalArgumentException) {}
            }
            val tiny = OwnerBd09Bounds(0.0,0.0,1e-12,1.0)
            try {
                runBlocking { api.galleryBd09CellPage("owner-secret", tiny, cell) }
                fail("Unstable viewport accepted")
            } catch (_: IllegalArgumentException) {}
            for (offset in listOf(-1,10_000_001)) {
                try {
                    runBlocking { api.galleryBd09CellPage("owner-secret",bounds,cell,offset) }
                    fail("Invalid offset accepted")
                } catch (_: IllegalArgumentException) {}
            }
            for ((sort,dir) in listOf("file" to "desc","added" to "wrong")) {
                try {
                    runBlocking { api.galleryBd09CellPage("owner-secret",bounds,cell,0,sort,dir) }
                    fail("Invalid sort accepted")
                } catch (_: IllegalArgumentException) {}
            }
            assertEquals(0, server.requestCount)
        } }
    }
}
