package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Signed Server Owner BD09 camera → original Gallery Range, not WGS84. */
class OwnerBd09ViewportGalleryRangeTest {
    private val bounds = OwnerBd09Bounds(138.0, 34.0, 140.0, 36.0)
    private val row = """{"node":{"id":42,"parent_id":1,"name":"photo.jpg",
        "type":"file","size":2048,"revision":5},
        "metadata":{"media_kind":"image","captured_at":"2026-10-28T00:00:00Z",
        "has_thumbnail":true},"favorite":false}"""
    private fun body(items: String = row, total: String = "1",
        offset: String = "0", limit: String = "60") =
        """{"items":[$items],"total_count":$total,"offset":$offset,"limit":$limit}"""
    private fun address(server: MockWebServer) =
        ServerAddress.parse(server.url("/").toString(), true)

    private suspend fun failed(api: XDriveApi, bounds: OwnerBd09Bounds = this.bounds,
        offset: Int = 0): ApiException {
        try { api.galleryBd09ViewportPage("owner-secret", bounds, offset) }
        catch (e: ApiException) { return e }
        throw AssertionError("Unverified BD09 viewport response accepted")
    }

    @Test fun readUsesExactReviewedGoQueryAndCanonicalGalleryDecoder() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(body()))
            val page = api.galleryBd09ViewportPage("owner-secret", bounds)
            assertEquals(1L, page.totalCount)
            assertEquals(0, page.offset)
            assertEquals(60, page.limit)
            assertEquals(42L, page.items.single().node.id)
            assertEquals(5L, page.items.single().node.revision)
            assertEquals("image", page.items.single().mediaKind)
            assertNull(page.timeline)
            val sent = server.takeRequest()
            assertEquals("GET", sent.method)
            assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            val url = sent.requestUrl!!
            assertEquals("/api/v1/media/places/baidu-jsapi/viewport-items",
                url.encodedPath)
            assertEquals(setOf("west","south","east","north","limit","offset",
                "range","sort_by","sort_dir"), url.queryParameterNames)
            assertEquals("138.0", url.queryParameter("west"))
            assertEquals("34.0", url.queryParameter("south"))
            assertEquals("140.0", url.queryParameter("east"))
            assertEquals("36.0", url.queryParameter("north"))
            assertEquals("60", url.queryParameter("limit"))
            assertEquals("0", url.queryParameter("offset"))
            assertEquals("true", url.queryParameter("range"))
            assertEquals("captured", url.queryParameter("sort_by"))
            assertEquals("desc", url.queryParameter("sort_dir"))
            for (unsafe in listOf("coordinate_space","owner","owner_id",
                "consent","browser_ak","initial_position","fold_duplicates","q"))
                assertNull(url.queryParameter(unsafe))
            assertFalse(sent.path!!.contains("owner-secret"))
        } }
    }

    @Test fun secondPageKeepsExactServerOffsetWithNoGlobalFallback() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(body(total="61", offset="60")))
            val page = api.galleryBd09ViewportPage("owner-secret", bounds,
                offset=60, sortBy="added", sortDir="asc")
            assertEquals(60, page.offset)
            assertEquals(61L, page.totalCount)
            assertEquals(1, page.items.size)
            val req = server.takeRequest()
            assertEquals("/api/v1/media/places/baidu-jsapi/viewport-items",
                req.requestUrl!!.encodedPath)
            assertEquals("60", req.requestUrl!!.queryParameter("offset"))
            assertEquals("added", req.requestUrl!!.queryParameter("sort_by"))
            assertEquals("asc", req.requestUrl!!.queryParameter("sort_dir"))
            assertEquals(1, server.requestCount)
        } }
    }

    @Test fun malformedDuplicateOrWrongVersionNeverBecomesGallery() = runBlocking {
        val malformed = listOf(
            body(total="-1"), body(offset="1"), body(limit="100"),
            body(items="$row,$row",total="2"),
            body(items="",total="1"),
            body(items=row.replace("\"revision\":5","\"revision\":0")),
            body(items=row.replace("\"media_kind\":\"image\"",
                "\"media_kind\":\"audio\"")),
            body(items=row.replace("\"has_thumbnail\":true",
                "\"has_thumbnail\":\"true\"")),
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (payload in malformed) {
                server.enqueue(MockResponse().setBody(payload))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failed(api).reason)
                assertEquals("/api/v1/media/places/baidu-jsapi/viewport-items",
                    server.takeRequest().requestUrl!!.encodedPath)
            }
            assertEquals(malformed.size, server.requestCount)
        } }
    }

    @Test fun deniedReleaseRevokedOwnerAndStaleViewportAreErrors() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (status in listOf(403, 404, 409, 503)) {
                server.enqueue(MockResponse().setResponseCode(status).setBody("{}"))
                assertEquals(status, failed(api).statusCode)
                val req = server.takeRequest()
                assertEquals("Bearer owner-secret", req.getHeader("Authorization"))
                assertEquals("GET", req.method)
            }
            assertEquals(4, server.requestCount)
        } }
    }

    @Test fun invalidBD09CameraAndSortNeverStartNetwork() {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val bad = listOf(
                OwnerBd09Bounds(0.0,0.0,1e-12,1.0),
                OwnerBd09Bounds(-181.0,0.0,100.0,1.0),
                OwnerBd09Bounds(5.0,5.0,5.0,6.0),
                OwnerBd09Bounds(0.0,0.0,Double.NaN,1.0),
            )
            for (b in bad) try {
                runBlocking { api.galleryBd09ViewportPage("owner-secret",b) }
                fail("Invalid BD09 camera accepted: $b")
            } catch (_: IllegalArgumentException) { }
            for (offset in listOf(-1,10_000_001)) try {
                runBlocking { api.galleryBd09ViewportPage("owner-secret",
                    bounds,offset) }
                fail("Invalid offset accepted")
            } catch (_: IllegalArgumentException) { }
            for ((by,dir) in listOf("name" to "desc","captured" to "random"))
                try {
                    runBlocking { api.galleryBd09ViewportPage("owner-secret",
                        bounds,0,by,dir) }
                    fail("Bad sort accepted")
                } catch (_: IllegalArgumentException) {}
            assertEquals(0, server.requestCount)
        } }
    }
}
