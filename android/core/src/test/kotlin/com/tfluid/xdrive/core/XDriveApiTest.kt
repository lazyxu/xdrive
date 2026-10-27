package com.tfluid.xdrive.core

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Locale
import okio.Buffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class XDriveApiTest {
    private fun textNode(revision: Int = 4, size: Long = 12L): String =
        """{"id":7,"parent_id":1,"name":"note.txt","type":"file",
            "size":$size,"revision":$revision}"""

    @Test fun filesMediaItemVerifiesOwnerRevisionAndServerMediaType() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val file = DriveNode(27, 1, "family.jpg", "file", 5, revision = 4)
            server.enqueue(MockResponse().setBody("""{
                "node":{"id":27,"parent_id":1,"name":"family.jpg",
                    "type":"file","size":5,"revision":4},
                "metadata":{"media_kind":"image","has_thumbnail":true},
                "live_photo":false
            }"""))
            val media = api.filesMediaItem("owner-secret", file)
            assertEquals(file, media.node)
            assertEquals("image", media.mediaKind)
            assertTrue(media.hasThumbnail)
            val req = server.takeRequest()
            assertEquals("/api/v1/media/items/27", req.path)
            assertEquals("Bearer owner-secret", req.getHeader("Authorization"))
            assertFalse(req.path!!.contains("owner-secret"))

            server.enqueue(MockResponse().setBody("""{
                "node":{"id":27,"parent_id":1,"name":"family.jpg",
                    "type":"file","size":5,"revision":5},
                "metadata":{"media_kind":"image","has_thumbnail":true}
            }"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.filesMediaItem("owner-secret", file) }.reason)
            server.enqueue(MockResponse().setBody("""{
                "node":{"id":27,"parent_id":1,"name":"family.jpg",
                    "type":"file","size":5,"revision":4},
                "metadata":{"media_kind":"video","has_thumbnail":true},
                "live_photo":true
            }"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.filesMediaItem("owner-secret", file) }.reason)
        } }
    }

    @Test fun filesPdfPreviewUsesExactOwnerRevisionAndEtagShaCheckedBytes() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val payload = "%PDF-1.4\n%%EOF".toByteArray()
            val node = DriveNode(27, 1, "private.pdf", "file",
                payload.size.toLong(), revision = 4)
            val nodeJson = """{"id":27,"parent_id":1,"name":"private.pdf",
                "type":"file","size":${payload.size},"revision":4}"""
            val digest = MessageDigest.getInstance("SHA-256").digest(payload)
                .joinToString("") { "%02x".format(it.toInt() and 255) }
            server.enqueue(MockResponse().setBody(nodeJson))
            server.enqueue(MockResponse().setBody(String(payload))
                .addHeader("ETag", "\"4\"")
                .addHeader("X-Content-SHA256", digest))
            server.enqueue(MockResponse().setBody(nodeJson))
            val copied = ByteArrayOutputStream()
            val progress = mutableListOf<Long>()
            assertEquals(payload.size.toLong(), api.filesPdfDownload(
                "owner-secret", node, { copied }, { progress += it }))
            assertArrayEquals(payload, copied.toByteArray())
            assertEquals(payload.size.toLong(), progress.last())
            val requests = (0 until 3).map { server.takeRequest() }
            assertEquals(listOf("/api/v1/nodes/27",
                "/api/v1/files/27/content", "/api/v1/nodes/27"),
                requests.map { it.path })
            assertTrue(requests.all {
                it.method == "GET" && it.getHeader("Authorization") == "Bearer owner-secret"
            })

            server.enqueue(MockResponse().setBody(nodeJson.replace(
                "\"revision\":4", "\"revision\":5")))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.filesPdfDownload("owner-secret", node,
                    { ByteArrayOutputStream() }) }.reason)
            // The Owner node may change *after* the byte stream ACK.
            server.enqueue(MockResponse().setBody(nodeJson))
            server.enqueue(MockResponse().setBody(String(payload))
                .addHeader("ETag", "\"4\""))
            server.enqueue(MockResponse().setBody(nodeJson.replace(
                "\"revision\":4", "\"revision\":5")))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.filesPdfDownload("owner-secret", node,
                    { ByteArrayOutputStream() }) }.reason)
        } }
    }

    @Test fun filesAudioPlaybackVerifiesNodeAndPinsRangeBearerAndRevision() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val audio = DriveNode(7, 1, "song.mp3", "file", 6, revision = 4)
            server.enqueue(MockResponse().setBody("""{
                "id":7,"parent_id":1,"name":"song.mp3","type":"file",
                "size":6,"revision":4
            }"""))
            server.enqueue(MockResponse().setResponseCode(206).setBody("abcd")
                .addHeader("ETag", "\"4\"")
                .addHeader("Content-Range", "bytes 0-3/6"))
            val playback = api.filesAudioPlayback("owner-secret", audio)
            playback.use {
                val call = it.client.newCall(Request.Builder().url(it.url)
                    .header("Range", "bytes=0-3").build())
                call.execute().use { response ->
                    assertEquals(206, response.code)
                    assertEquals("abcd", response.body!!.string())
                }
            }
            val detail = server.takeRequest()
            val streaming = server.takeRequest()
            assertEquals("/api/v1/nodes/7", detail.path)
            assertEquals("/api/v1/files/7/content", streaming.path)
            assertEquals("Bearer owner-secret", detail.getHeader("Authorization"))
            assertEquals("Bearer owner-secret", streaming.getHeader("Authorization"))
            assertEquals("\"4\"", streaming.getHeader("If-Match"))
            assertEquals("bytes=0-3", streaming.getHeader("Range"))

            server.enqueue(MockResponse().setBody("""{
                "id":7,"parent_id":1,"name":"song.mp3","type":"file",
                "size":6,"revision":5
            }"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.filesAudioPlayback("owner-secret", audio) }.reason)
        } }
    }

    @Test fun textPreviewUsesBearerAndCurrentRevisionBeforeAndAfterRead() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(textNode()))
            server.enqueue(MockResponse().setBody(
                """{"text":"hello world!","truncated":false,"size":12}"""))
            server.enqueue(MockResponse().setBody(textNode()))
            val preview = api.textFilePreview("owner-secret",
                DriveNode(7, 1, "note.txt", "file", 12, revision = 4))
            assertEquals(FileTextPreview("hello world!", false, 12), preview)
            val requests = (0 until 3).map { server.takeRequest() }
            assertEquals(listOf("/api/v1/nodes/7",
                "/api/v1/files/7/preview/text", "/api/v1/nodes/7"),
                requests.map { it.path })
            assertTrue(requests.all { it.method == "GET" &&
                it.getHeader("Authorization") == "Bearer owner-secret" })
            assertEquals("\"4\"", requests[1].getHeader("If-Match"))
            assertTrue(requests.all { !it.path!!.contains("owner-secret") })
        } }
    }

    @Test fun textPreviewRejectsStaleRevisionAndMalformedPayloadBeforeDisplay() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val original = DriveNode(7, 1, "note.txt", "file", 12, revision = 4)
            server.enqueue(MockResponse().setBody(textNode()))
            server.enqueue(MockResponse().setBody(
                """{"text":"hello world!","truncated":false,"size":12}"""))
            server.enqueue(MockResponse().setBody(textNode(revision = 5)))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.textFilePreview("owner-secret", original) }.reason)

            // A binary filename/UTF-8 error is determined by Go (415), never
            // represented as an empty successful preview.
            server.enqueue(MockResponse().setBody(textNode()))
            server.enqueue(MockResponse().setResponseCode(415))
            assertEquals(415,
                failure { api.textFilePreview("owner-secret", original) }.statusCode)

            val bad = listOf(
                """{"text":"hello world!","truncated":"false","size":12}""",
                """{"text":"hello world!","truncated":true,"size":12}""",
                """{"text":"too long for declared size","truncated":false,"size":12}""",
                """{"text":"hello world!","truncated":false,"size":13}""",
            )
            for (payload in bad) {
                server.enqueue(MockResponse().setBody(textNode()))
                server.enqueue(MockResponse().setBody(payload))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.textFilePreview("owner-secret", original) }.reason)
            }
            assertEquals(13, server.requestCount)
        } }
    }

    @Test fun textPreviewCapsActualUtf8BytesAndHonorsServerTruncation() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val big = DriveNode(7, 1, "note.txt", "file", 1_048_577, revision = 4)
            server.enqueue(MockResponse().setBody(textNode(size = big.size)))
            server.enqueue(MockResponse().setBody(
                """{"text":"small","truncated":true,"size":1048577}"""))
            server.enqueue(MockResponse().setBody(textNode(size = big.size)))
            val preview = api.textFilePreview("owner-secret", big)
            assertTrue(preview.truncated)
            assertEquals("small", preview.text)

            // Never keep more than 1 MiB in Android UI State even if an
            // inconsistent/compromised Server sends a larger JSON body.
            server.enqueue(MockResponse().setBody(textNode(size = big.size)))
            server.enqueue(MockResponse().setBody(
                """{"text":"${"x".repeat(1_048_577)}","truncated":true,"size":1048577}"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.textFilePreview("owner-secret", big) }.reason)

            // A valid 1 MiB text of newlines grows beyond 2 MiB in JSON
            // escaping. The preview-only JSON cap must still accept it,
            // without increasing the cap of any other API endpoint.
            val escapedText = "\n".repeat(1_048_576)
            val capped = big.copy(size = 1_048_576)
            server.enqueue(MockResponse().setBody(textNode(size = capped.size)))
            server.enqueue(MockResponse().setBody(
                """{"text":${JsonPrimitive(escapedText)},"truncated":false,"size":1048576}"""))
            server.enqueue(MockResponse().setBody(textNode(size = capped.size)))
            val exact = api.textFilePreview("owner-secret", capped)
            assertEquals(1_048_576, exact.text.toByteArray(Charsets.UTF_8).size)
            assertFalse(exact.truncated)
        } }
    }

        @Test fun nodeLocationAndDirectoryPositionUseCurrentOwnerContracts() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "node_id":155,"revision":7,"node_type":"file","parent_id":20,
                "path":"Photos/target.jpg","parent_path":"Photos",
                "breadcrumbs":[{"id":1,"name":"","path":""},{"id":20,"name":"Photos","path":"Photos"}],
                "sources":[],"sync_folders":[]
            }"""))
            val location = api.nodeLocation("owner-secret", 155)
            assertEquals(155L, location.nodeId)
            assertEquals(7L, location.revision)
            assertEquals(20L, location.parentId)
            assertEquals(listOf(1L, 20L), location.parentDirectories.map { it.id })
            val request = server.takeRequest()
            assertEquals("/api/v1/nodes/155/location", request.path)
            assertEquals("Bearer owner-secret", request.getHeader("Authorization"))

            server.enqueue(MockResponse().setBody("""{
                "node_id":155,"revision":7,"index":12345,
                "sort":"name","order":"asc","group":"none","folders_first":true
            }"""))
            val position = api.childPosition("owner-secret", 20, 155)
            assertEquals(12345, position.index)
            assertEquals(7L, position.revision)
            val requested = server.takeRequest()
            assertEquals("/api/v1/nodes/20/children/position", requested.requestUrl!!.encodedPath)
            assertEquals("155", requested.requestUrl!!.queryParameter("node_id"))
            assertEquals("name", requested.requestUrl!!.queryParameter("sort"))
            assertEquals("asc", requested.requestUrl!!.queryParameter("order"))
            assertEquals("none", requested.requestUrl!!.queryParameter("group"))
            assertEquals("true", requested.requestUrl!!.queryParameter("folders_first"))
            assertEquals("Bearer owner-secret", requested.getHeader("Authorization"))
            assertFalse(requested.path!!.contains("owner-secret"))
        } }
    }

    @Test fun nodeLocationRejectsStaleOrUnverifiedOwnerResponse() = runBlocking {
        val badLocations = listOf(
            // Search item no longer matches the Owner Node identity.
            """{"node_id":999,"revision":7,"node_type":"file","parent_id":20,
                "breadcrumbs":[{"id":1,"name":""},{"id":20,"name":"Photos"}]}""",
            // A parent must be the final current Owner directory.
            """{"node_id":155,"revision":7,"node_type":"file","parent_id":21,
                "breadcrumbs":[{"id":1,"name":""},{"id":20,"name":"Photos"}]}""",
            // Directory breadcrumb must end at the actual directory Node.
            """{"node_id":155,"revision":7,"node_type":"dir","parent_id":20,
                "breadcrumbs":[{"id":1,"name":""},{"id":20,"name":"Photos"}]}""",
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (payload in badLocations) {
                server.enqueue(MockResponse().setBody(payload))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.nodeLocation("owner-secret", 155) }.reason)
            }
            server.enqueue(MockResponse().setResponseCode(404))
            assertEquals(404, failure { api.nodeLocation("owner-secret", 155) }.statusCode)
            val invalidPositions = listOf(
                """{"node_id":156,"revision":7,"index":12345,
                    "sort":"name","order":"asc","group":"none","folders_first":true}""",
                """{"node_id":155,"revision":7,"index":-1,
                    "sort":"name","order":"asc","group":"none","folders_first":true}""",
                """{"node_id":155,"revision":7,"index":12345,
                    "sort":"updated","order":"asc","group":"none","folders_first":true}""",
                """{"node_id":155,"revision":7,"index":12345,
                    "sort":"name","order":"asc","group":"none","folders_first":false}""",
            )
            for (payload in invalidPositions) {
                server.enqueue(MockResponse().setBody(payload))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.childPosition("owner-secret", 20, 155) }.reason)
            }
            assertEquals(8, server.requestCount)
        } }
    }

    @Test fun videoUsesExactPinnedOwnerRangeAndNoTokenInUrl() {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val video = DriveNode(71, 1, "clip.mp4", "file", size = 7, revision = 9)
            server.enqueue(MockResponse().setResponseCode(206)
                .setHeader("ETag", "\"9\"")
                .setHeader("Content-Range", "bytes 3-6/7")
                .setBody("defg"))
            val source = api.galleryVideoPlayback("owner-secret", video)
            try {
                assertFalse(source.url.contains("owner-secret"))
                val request = Request.Builder().url(source.url)
                    .header("Range", "bytes=3-").build()
                source.client.newCall(request).execute().use {
                    assertEquals(206, it.code)
                    assertEquals("defg", it.body!!.string())
                }
                val sent = server.takeRequest()
                assertEquals("/api/v1/files/71/content", sent.path)
                assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
                assertEquals("\"9\"", sent.getHeader("If-Match"))
                assertEquals("bytes=3-", sent.getHeader("Range"))
                assertEquals("identity", sent.getHeader("Accept-Encoding"))
            } finally { source.close() }
        } }
    }

    @Test fun videoRejectsRevisionMismatchRangeDowngradeAndForeignHost() {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val video = DriveNode(72, 1, "clip.mp4", "file", size = 7, revision = 3)
            val source = api.galleryVideoPlayback("owner-secret", video)
            try {
                val invalid = listOf(
                    MockResponse().setResponseCode(206)
                        .setHeader("ETag", "\"4\"")
                        .setHeader("Content-Range", "bytes 3-6/7").setBody("defg"),
                    MockResponse().setResponseCode(200)
                        .setHeader("ETag", "\"3\"").setBody("abcdefg"),
                    MockResponse().setResponseCode(206)
                        .setHeader("ETag", "\"3\"")
                        .setHeader("Content-Range", "bytes 2-5/7").setBody("cdef"),
                )
                for (response in invalid) {
                    server.enqueue(response)
                    try {
                        source.client.newCall(Request.Builder().url(source.url)
                            .header("Range", "bytes=3-").build()).execute().close()
                        fail("Unsafe video response accepted")
                    } catch (_: java.io.IOException) { }
                }
                assertEquals(3, server.requestCount)
                try {
                    source.client.newCall(Request.Builder().url(source.url)
                        .header("Range", "bytes=999-").build()).execute().close()
                    fail("Out-of-bounds Range accepted")
                } catch (_: java.io.IOException) { }
                try {
                    source.client.newCall(Request.Builder()
                        .url("https://unexpected.example/video.mp4").build()).execute().close()
                    fail("Cross-origin credentials must be refused")
                } catch (_: java.io.IOException) { }
                assertEquals(3, server.requestCount)
            } finally { source.close() }
        } }
    }

    private val auth = """{"access_token":"access-secret","refresh_token":"refresh-secret","username":"owner","must_change_password":true}"""
    private val directory = """{"id":1,"name":"root","type":"dir","revision":4,"size":0,"updated_at":"2026-10-23T00:00:00Z"}"""
    private fun page(items: String = "[]", total: Long = 0, offset: Int = 0, limit: Int = 100) =
        """{"items":$items,"total_count":$total,"total_count_included":true,"offset":$offset,"limit":$limit,"sort":"name","order":"asc"}"""
    private fun address(server: MockWebServer) = ServerAddress.parse(server.url("/").toString(), true)
    private fun body(request: RecordedRequest) = Json.parseToJsonElement(request.body.readUtf8()).jsonObject
    private suspend fun failure(block: suspend () -> Unit): ApiException {
        try { block() } catch (e: ApiException) { return e }
        throw AssertionError("Expected safe API failure")
    }




    @Test fun `Gallery album listing uses true Owner PhotoCollections and rejects corrupted rows`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""[
                {"id":"manual:11111111-1111-4111-8111-111111111111","kind":"manual",
                 "name":"旅途","revision":3,"album_folder_id":0,
                 "item_count":42,"cover_node_id":17},
                {"id":"source:device:album 1","kind":"imported",
                 "name":"设备相册","revision":1,"album_folder_id":0,
                 "item_count":0}
            ]"""))
            val albums = api.galleryAlbums("owner-secret")
            assertEquals(2, albums.size)
            assertEquals("旅途", albums.first().name)
            assertEquals(42L, albums.first().itemCount)
            assertEquals(17L, albums.first().coverNodeId)
            assertEquals("source:device:album 1", albums.last().id)
            val request = server.takeRequest()
            assertEquals("GET", request.method)
            assertEquals("/api/v1/media/albums", request.path)
            assertEquals("Bearer owner-secret", request.getHeader("Authorization"))
            assertFalse(request.path!!.contains("owner-secret"))

            // Fail closed: never blend duplicate, malformed or cross-identity
            // album rows into the current Owner's Collections presentation.
            for (bad in listOf(
                """[{"id":"manual:x","kind":"manual","name":"Good",
                    "revision":1,"album_folder_id":0,"item_count":1},
                   {"id":"manual:x","kind":"manual","name":"Other",
                    "revision":2,"album_folder_id":0,"item_count":2}]""",
                """[{"id":"../../nodes","kind":"manual","name":"Bad",
                    "revision":1,"album_folder_id":0,"item_count":1}]""",
                """[{"id":"manual:x","kind":"manual","name":"Bad",
                    "revision":1,"album_folder_id":0,"item_count":-1}]""",
            )) {
                server.enqueue(MockResponse().setBody(bad))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.galleryAlbums("owner-secret") }.reason)
            }
            assertEquals(4, server.requestCount)
        } }
    }

    @Test fun `Gallery album range retains opaque ID in one path segment and real Owner sparse offsets`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":87,"parent_id":1,"name":"album.jpg","type":"file",
                    "size":128,"revision":6},"metadata":{"media_kind":"image",
                    "has_thumbnail":true}}],
                "total_count":121,"offset":120,"limit":60
            }"""))
            val page = api.galleryAlbumPage("owner-secret",
                "source:device:2026/holiday", initialLatest = true)
            assertEquals(121L, page.totalCount)
            assertEquals(120, page.offset)
            assertEquals(87L, page.items.single().node.id)
            val request = server.takeRequest()
            assertEquals("Bearer owner-secret", request.getHeader("Authorization"))
            assertTrue(request.requestUrl!!.encodedPath.contains(
                "/media/albums/source:device:2026%2Fholiday/items"))
            assertEquals("true", request.requestUrl!!.queryParameter("range"))
            assertEquals("latest", request.requestUrl!!.queryParameter("initial_position"))
            assertEquals("true", request.requestUrl!!.queryParameter("fold_duplicates"))

            server.enqueue(MockResponse().setBody("""{
                "items":[],"total_count":121,"offset":10,"limit":60
            }"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE, failure {
                api.galleryAlbumPage("owner-secret", "manual:x", offset = 60)
            }.reason)
            try {
                api.galleryAlbumPage("owner-secret", "other:x")
                fail("Accepted unsupported album identity")
            } catch (_: IllegalArgumentException) { }
            assertEquals(2, server.requestCount)
        } }
    }

    @Test fun `album cover resolves current Owner node revision before bounded thumbnail`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val album = GalleryAlbum("manual:trip", "manual", "旅途", 5, 3, 0, 17)
            server.enqueue(MockResponse().setBody("""{
                "node":{"id":17,"parent_id":1,"name":"cover.jpg","type":"file",
                    "size":2048,"revision":12},
                "metadata":{"media_kind":"image","has_thumbnail":true}
            }"""))
            val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2,
                0xff.toByte(), 0xd9.toByte())
            server.enqueue(MockResponse().setHeader("Content-Type", "image/jpeg")
                .setBody(Buffer().write(jpeg)))
            val cover = api.galleryAlbumCover("owner-secret", album)!!
            assertEquals(17L, cover.nodeId)
            assertEquals(12L, cover.revision)
            assertArrayEquals(jpeg, cover.jpegBytes)
            val a = server.takeRequest()
            val b = server.takeRequest()
            assertEquals("GET", a.method)
            assertEquals("/api/v1/media/items/17", a.path)
            assertEquals("Bearer owner-secret", a.getHeader("Authorization"))
            assertEquals("GET", b.method)
            assertEquals("/api/v1/media/items/17/thumbnail?revision=12", b.path)
            assertEquals("Bearer owner-secret", b.getHeader("Authorization"))
            assertEquals("image/jpeg", b.getHeader("Accept"))
            assertFalse((a.path + b.path).contains("owner-secret"))
        } }
    }

    @Test fun `album cover without a real Server ID or derived thumbnail never guesses bytes`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            assertNull(api.galleryAlbumCover("owner-secret",
                GalleryAlbum("manual:empty", "manual", "空", 0, 1, 0)))
            assertEquals(0, server.requestCount)

            server.enqueue(MockResponse().setBody("""{
                "node":{"id":17,"parent_id":1,"name":"no-poster.mp4","type":"file",
                    "size":2048,"revision":5},
                "metadata":{"media_kind":"video","has_thumbnail":false}
            }"""))
            assertNull(api.galleryAlbumCover("owner-secret",
                GalleryAlbum("manual:video", "manual", "视频", 1, 2, 0, 17)))
            val request = server.takeRequest()
            assertEquals("/api/v1/media/items/17", request.path)
            assertEquals(1, server.requestCount)
        } }
    }

    @Test fun `album cover rejects stale or unrelated metadata before thumbnail request`() = runBlocking {
        val bad = listOf(
            """{"node":{"id":18,"parent_id":1,"name":"other.jpg","type":"file",
                "size":1024,"revision":3},
                "metadata":{"media_kind":"image","has_thumbnail":true}}""",
            """{"node":{"id":17,"parent_id":1,"name":"folder","type":"dir",
                "size":0,"revision":3},
                "metadata":{"media_kind":"image","has_thumbnail":true}}""",
            """{"node":{"id":17,"parent_id":1,"name":"stale.jpg","type":"file",
                "size":1024,"revision":0},
                "metadata":{"media_kind":"image","has_thumbnail":true}}""",
            """{"node":{"id":17,"parent_id":1,"name":"nonmedia.bin","type":"file",
                "size":1024,"revision":3},
                "metadata":{"media_kind":"other","has_thumbnail":true}}""",
            """{"node":{"id":17,"parent_id":1,"name":"invalid.jpg","type":"file",
                "size":1024,"revision":3},
                "metadata":{"media_kind":"image","has_thumbnail":"true"}}""",
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val album = GalleryAlbum("manual:trip", "manual", "Trip", 1, 1, 0, 17)
            for (data in bad) {
                server.enqueue(MockResponse().setBody(data))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.galleryAlbumCover("owner-secret", album) }.reason)
                assertEquals("/api/v1/media/items/17", server.takeRequest().path)
            }
            assertEquals(bad.size, server.requestCount) // no thumbnail GET
        } }
    }

    @Test fun `Gallery Owner Range starts at real chronological tail and preserves absolute offset`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":87,"parent_id":1,"name":"latest.jpg","type":"file",
                    "size":128,"revision":6},"metadata":{"media_kind":"image",
                    "captured_at":"2026-10-25T12:00:00Z","has_thumbnail":true},"live_photo":true}],
                "total_count":121,"offset":120,"limit":60
            }"""))
            val page = api.galleryPage("owner-secret", initialLatest = true)
            assertEquals(121L, page.totalCount)
            assertEquals(120, page.offset)
            assertEquals(87L, page.items.single().node.id)
            assertTrue(page.items.single().livePhoto)
            assertTrue(page.items.single().hasThumbnail)
            val sent = server.takeRequest()
            assertEquals("GET", sent.method)
            assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            assertEquals("true", sent.requestUrl!!.queryParameter("range"))
            assertEquals("latest", sent.requestUrl!!.queryParameter("initial_position"))
            assertEquals("captured", sent.requestUrl!!.queryParameter("sort_by"))
            assertEquals("asc", sent.requestUrl!!.queryParameter("sort_dir"))
            assertEquals("true", sent.requestUrl!!.queryParameter("unknown_first"))
            assertEquals("true", sent.requestUrl!!.queryParameter("fold_duplicates"))
        } }
    }

    @Test fun `Gallery sorting requests Server Owner Range instead of locally reordering tiles`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":79,"parent_id":1,"name":"clip.mp4",
                    "type":"file","size":256,"revision":2},
                    "metadata":{"media_kind":"video","has_thumbnail":true}}],
                "total_count":1,"offset":0,"limit":60
            }"""))
            val page = api.gallerySortedPage("owner-secret", 0, true,
                "sunset", "video", null, "added", "desc")
            assertEquals(79L, page.items.single().node.id)
            assertNull(page.timeline)
            val req = server.takeRequest()
            assertEquals("Bearer owner-secret", req.getHeader("Authorization"))
            assertEquals("added", req.requestUrl!!.queryParameter("sort_by"))
            assertEquals("desc", req.requestUrl!!.queryParameter("sort_dir"))
            assertEquals("sunset", req.requestUrl!!.queryParameter("q"))
            assertEquals("video", req.requestUrl!!.queryParameter("kind"))
            assertEquals("true", req.requestUrl!!.queryParameter("range"))
            assertNull(req.requestUrl!!.queryParameter("initial_position"))
            for ((by, dir) in listOf("invalid" to "asc", "added" to "wrong")) {
                try {
                    api.gallerySortedPage("owner-secret", 0, true, "", "",
                        null, by, dir)
                    fail("Invalid server sort accepted")
                } catch (_: IllegalArgumentException) { }
            }
            assertEquals(1, server.requestCount)
        } }
    }

    @Test fun `Gallery search is remote Owner query with the same sparse latest Range`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":78,"parent_id":1,"name":"sunset.jpg","type":"file",
                    "size":128,"revision":6},"metadata":{"media_kind":"image",
                    "captured_at":"2026-10-25T12:00:00Z","has_thumbnail":true}}],
                "total_count":1,"offset":0,"limit":60
            }"""))
            val page = api.gallerySearchPage("owner-secret", 0, true, "sunset")
            assertEquals(listOf(78L), page.items.map { it.node.id })
            val sent = server.takeRequest()
            assertEquals("sunset", sent.requestUrl!!.queryParameter("q"))
            assertEquals("latest", sent.requestUrl!!.queryParameter("initial_position"))
            assertEquals("true", sent.requestUrl!!.queryParameter("range"))
            assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            assertFalse(sent.path!!.contains("owner-secret"))
            try {
                api.gallerySearchPage("owner-secret", 0, true, " ")
                fail("Blank search accepted")
            } catch (_: IllegalArgumentException) { }
            assertEquals(1, server.requestCount)
        } }
    }

    @Test fun `Gallery media kind filters full Owner range and rejects wrong kind`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":80,"parent_id":1,"name":"movie.mp4",
                    "type":"file","size":256,"revision":7},
                    "metadata":{"media_kind":"video","duration_ms":1000,"has_thumbnail":true}}],
                "total_count":1,"offset":0,"limit":60
            }"""))
            val page = api.galleryKindPage("owner-secret", 0, true, "holiday", "video")
            assertEquals(listOf(80L), page.items.map { it.node.id })
            val request = server.takeRequest()
            assertEquals("Bearer owner-secret", request.getHeader("Authorization"))
            assertEquals("video", request.requestUrl!!.queryParameter("kind"))
            assertEquals("holiday", request.requestUrl!!.queryParameter("q"))
            assertEquals("true", request.requestUrl!!.queryParameter("range"))
            assertEquals("latest", request.requestUrl!!.queryParameter("initial_position"))
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":81,"parent_id":1,"name":"wrong.jpg",
                    "type":"file","size":100,"revision":3},
                    "metadata":{"media_kind":"image","has_thumbnail":true}}],
                "total_count":1,"offset":0,"limit":60
            }"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.galleryKindPage("owner-secret", 0, true, "", "video") }.reason)
            try {
                api.galleryKindPage("owner-secret", 0, true, "", "audio")
                fail("Unsupported media kind accepted")
            } catch (_: IllegalArgumentException) { }
            assertEquals(2, server.requestCount)
        } }
    }

    @Test fun `Gallery consumes real Server timeline indexes without scanning loaded rows`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{
                "items":[{"node":{"id":121,"parent_id":1,"name":"last.jpg",
                    "type":"file","size":120,"revision":5},
                    "metadata":{"media_kind":"image","has_thumbnail":true}}],
                "total_count":121,"offset":120,"limit":60,
                "timeline_group_sets":{
                  "year":[{"key":"2025","item_count":60,"start_index":0},
                          {"key":"2026","item_count":61,"start_index":60}],
                  "month":[{"key":"2025-12","item_count":60,"start_index":0},
                           {"key":"2026-10","item_count":61,"start_index":60}],
                  "day":[{"key":"unknown","item_count":60,"start_index":0},
                         {"key":"2026-10-25","item_count":61,"start_index":60}]
                }
            }"""))
            val page = api.galleryPage("owner-secret", initialLatest = true)
            assertEquals(120, page.offset)
            assertEquals(121L, page.totalCount)
            assertEquals(60, page.timeline!!.year[1].startIndex)
            assertEquals("2026-10", page.timeline!!.month.last().key)
            assertEquals("unknown", page.timeline!!.day.first().key)
            assertEquals(1, page.items.size) // Not a local 121-photo scan.
            val sent = server.takeRequest()
            assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            assertEquals("latest", sent.requestUrl!!.queryParameter("initial_position"))
        } }
    }

    @Test fun `Gallery rejects forged timeline starts and incomplete counts`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (group in listOf(
                """{"key":"2026","item_count":1,"start_index":2}""",
                """{"key":"2026","item_count":2,"start_index":0}""",
                """{"key":"malformed","item_count":1,"start_index":0}"""
            )) {
                val body = """{"items":[{"node":{"id":9,"parent_id":1,
                    "name":"photo.jpg","type":"file","size":12,"revision":2},
                    "metadata":{"media_kind":"image","has_thumbnail":true}}],
                    "total_count":1,"offset":0,"limit":60,
                    "timeline_group_sets":{"year":[$group],"month":[
                    {"key":"2026-10","item_count":1,"start_index":0}],
                    "day":[{"key":"2026-10-25","item_count":1,"start_index":0}]}}
                """
                server.enqueue(MockResponse().setBody(body))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.galleryPage("owner-secret", initialLatest = true) }.reason)
                server.takeRequest()
            }
        } }
    }

    @Test fun `Gallery rejects malformed or cross-range pages rather than publishing private items`() = runBlocking {
        val cases = listOf(
            """{"items":[],"total_count":4,"offset":0,"limit":60}""",
            """{"items":[{"node":{"id":7,"name":"bad","type":"dir","revision":1},
                "metadata":{"media_kind":"image","has_thumbnail":true}}],"total_count":1,"offset":0,"limit":60}""",
            """{"items":[{"node":{"id":7,"name":"bad","type":"file","revision":1},
                "metadata":{"media_kind":"image","has_thumbnail":true}}],
                "total_count":1,"offset":2,"limit":60}""",
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (payload in cases) {
                server.enqueue(MockResponse().setBody(payload))
                assertEquals(ApiFailureReason.INVALID_RESPONSE,
                    failure { api.galleryPage("owner-secret") }.reason)
            }
            assertEquals(3, server.requestCount)
        } }
    }

    @Test fun `Gallery thumbnail uses revision fence pinned Bearer and bounded bytes`() = runBlocking {
        val bytes = byteArrayOf(0xff.toByte(),0xd8.toByte(),1,2,0xff.toByte(),0xd9.toByte())
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setHeader("Content-Type","image/jpeg")
                .setBody(Buffer().write(bytes)))
            assertArrayEquals(bytes, api.galleryThumbnail("owner-secret", 7, 3))
            val sent = server.takeRequest()
            assertEquals("/api/v1/media/items/7/thumbnail?revision=3", sent.path)
            assertEquals("Bearer owner-secret", sent.getHeader("Authorization"))
            assertEquals("image/jpeg", sent.getHeader("Accept"))
        } }
    }

    @Test fun `native manual upload uses exact Go session chunks and final result`() = runBlocking {
        val file = "hello xdrive".toByteArray()
        val digest = MessageDigest.getInstance("SHA-256").digest(file).joinToString("") {
            "%02x".format(Locale.ROOT, it.toInt() and 0xff)
        }
        val id = "11111111-1111-4111-8111-111111111111"
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"id":"$id","status":"active","parent_id":1,"name":"hello.txt","size":12,"chunk_size":8388608,"chunk_count":1}"""))
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"index":0,"size":12,"sha256":"$digest"}"""))
            server.enqueue(MockResponse().setBody(
                """{"id":"$id","status":"finalized","parent_id":1,"size":12,
                "result":{"id":83,"parent_id":1,"name":"hello.txt","type":"file","revision":1,"size":12}}"""))
            val progress = mutableListOf<Long>()
            val result = api.uploadFile("access-secret", DriveNode(1, name = "", type = "dir"),
                "hello.txt", file.size.toLong(), { ByteArrayInputStream(file) }, progress::add)
            assertEquals(83L, result.id)
            assertEquals(listOf(12L), progress)
            assertEquals(3, server.requestCount)
            val create = server.takeRequest()
            assertEquals("POST", create.method)
            assertEquals("/api/v1/uploads", create.path)
            assertEquals("Bearer access-secret", create.getHeader("Authorization"))
            // RecordedRequest.body is a consumable Buffer: parse it exactly once.
            val createFields = body(create)
            assertEquals(1L, createFields["parent_id"]!!.jsonPrimitive.long)
            assertEquals(12L, createFields["size"]!!.jsonPrimitive.long)
            assertEquals("fail", createFields["conflict_policy"]!!.jsonPrimitive.content)
            val chunk = server.takeRequest()
            assertEquals("PUT", chunk.method)
            assertEquals("/api/v1/uploads/$id/chunks/0", chunk.path)
            assertEquals(digest, chunk.getHeader("X-Chunk-SHA256"))
            assertEquals("Bearer access-secret", chunk.getHeader("Authorization"))
            assertArrayEquals(file, chunk.body.readByteArray())
            val finalize = server.takeRequest()
            assertEquals("POST", finalize.method)
            assertEquals("/api/v1/uploads/$id/finalize", finalize.path)
        } }
    }

    @Test fun `native upload fails closed when selected SAF content is truncated`() = runBlocking {
        val id = "11111111-1111-4111-8111-111111111111"
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"id":"$id","status":"active","parent_id":1,"name":"file.txt","size":5,"chunk_size":8388608,"chunk_count":1}"""))
            server.enqueue(MockResponse().setResponseCode(204))
            val exception = failure {
                api.uploadFile("access-secret", DriveNode(1, name = "", type = "dir"),
                    "file.txt", 5, { ByteArrayInputStream("abc".toByteArray()) })
            }
            assertTrue(exception.message!!.contains("Selected file ended"))
            assertEquals(2, server.requestCount)
            assertEquals("/api/v1/uploads/$id", server.takeRequest().let { request ->
                assertEquals("POST", request.method)
                server.takeRequest().also { assertEquals("DELETE", it.method) }.path
            })
        } }
    }

    @Test fun `manual upload validates name size and directory before network`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for ((node, name, size) in listOf(
                Triple(DriveNode(1, name = "root", type = "dir"), "CON", 1L),
                Triple(DriveNode(1, name = "root", type = "file"), "a.txt", 1L),
                Triple(DriveNode(1, name = "root", type = "dir"), "a.txt", -1L),
            )) {
                assertThrows(IllegalArgumentException::class.java) {
                    runBlocking { api.uploadFile("token", node, name, size,
                        { ByteArrayInputStream(byteArrayOf(1)) }) }
                }
            }
            assertEquals(0, server.requestCount)
        } }
    }

    @Test fun `native Owner download streams authenticated file with verified size and hash`() = runBlocking {
        val raw = ByteArray(160_000) { (it % 251).toByte() }
        val sha = MessageDigest.getInstance("SHA-256").digest(raw).joinToString("") {
            "%02x".format(Locale.ROOT, it.toInt() and 0xff)
        }
        val file = DriveNode(42, 1, "vacation.jpg", "file", raw.size.toLong(), revision = 5)
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(200)
                .setHeader("ETag", 34.toChar().toString() + "5" + 34.toChar())
                .setHeader("X-Content-SHA256", sha).setBody(Buffer().write(raw)))
            val output = ByteArrayOutputStream()
            val progress = mutableListOf<Long>()
            val count = api.downloadFile("access-secret", file, { output }, progress::add)
            assertEquals(raw.size.toLong(), count)
            assertArrayEquals(raw, output.toByteArray())
            assertEquals(raw.size.toLong(), progress.last())
            val sent = server.takeRequest()
            assertEquals("GET", sent.method)
            assertEquals("/api/v1/files/42/content", sent.path)
            assertEquals("Bearer access-secret", sent.getHeader("Authorization"))
            assertEquals("identity", sent.getHeader("Accept-Encoding"))
            assertNull(sent.getHeader("Range"))
        } }
    }

    @Test fun `native Owner download rejects stale revision before opening SAF sink`() = runBlocking {
        val file = DriveNode(42, 1, "sample.bin", "file", 5, revision = 3)
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(200)
                .setHeader("ETag", 34.toChar().toString() + "4" + 34.toChar())
                .setBody("hello"))
            var opened = false
            val error = failure {
                api.downloadFile("access-secret", file, { opened = true; ByteArrayOutputStream() })
            }
            assertEquals(ApiFailureReason.INVALID_RESPONSE, error.reason)
            assertFalse(opened)
            assertEquals(1, server.requestCount)
        } }
    }

    @Test fun `native Owner download refuses short body checksum mismatch and redirect`() = runBlocking {
        val node = DriveNode(42, 1, "sample.bin", "file", 5, revision = 3)
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val etag = 34.toChar().toString() + "3" + 34.toChar()
            server.enqueue(MockResponse().setResponseCode(200)
                .setHeader("ETag", etag).setBody("abc"))
            assertEquals(ApiFailureReason.INVALID_RESPONSE, failure {
                api.downloadFile("token", node, { ByteArrayOutputStream() })
            }.reason)
            server.takeRequest()
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", etag)
                .setHeader("X-Content-SHA256", "0".repeat(64)).setBody("hello"))
            assertEquals(ApiFailureReason.INVALID_RESPONSE, failure {
                api.downloadFile("token", node, { ByteArrayOutputStream() })
            }.reason)
            server.takeRequest()
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/"))
            var opened = false
            assertEquals(302, failure {
                api.downloadFile("token", node, { opened = true; ByteArrayOutputStream() })
            }.statusCode)
            assertFalse(opened)
            assertEquals(3, server.requestCount)
        } }
    }

    @Test fun `atomic batch Trash sends numeric revisioned Owner refs once`() = runBlocking {
        val first = DriveNode(7, 1, "a.txt", "file", revision = 3)
        val second = DriveNode(8, 1, "folder", "dir", revision = 2)
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(
                """{"operation_id":"ack-batch-1","deleted_ids":[7,8]}"""))
            api.trashNodes("access-secret", listOf(first, second))
            assertEquals(1, server.requestCount)
            val sent = server.takeRequest()
            assertEquals("POST", sent.method)
            assertEquals("/api/v1/nodes/batch/delete", sent.path)
            assertEquals("Bearer access-secret", sent.getHeader("Authorization"))
            val items = body(sent)["items"]!!.jsonArray
            assertEquals(2, items.size)
            assertEquals(7L, items[0].jsonObject["id"]!!.jsonPrimitive.long)
            assertEquals(3L, items[0].jsonObject["revision"]!!.jsonPrimitive.long)
            assertFalse(items[0].jsonObject["id"]!!.jsonPrimitive.isString)
            assertFalse(items[1].jsonObject["revision"]!!.jsonPrimitive.isString)
            assertNull(sent.getHeader("If-Match")) // each item owns its revision
        } }
    }

    @Test fun `batch Trash refuses empty duplicate oversized or versionless selections`() = runBlocking {
        val node = DriveNode(2, 1, "item.txt", "file", revision = 3)
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (nodes in listOf(emptyList(), listOf(node, node),
                listOf(node.copy(revision = 0)),
                (1..201).map { DriveNode(it.toLong(), 1, "n$it", "file", revision = 1) })) {
                assertThrows(IllegalArgumentException::class.java) {
                    runBlocking { api.trashNodes("access-secret", nodes) }
                }
            }
            assertEquals(0, server.requestCount)
        } }
    }

    @Test fun `batch Trash fails closed on mismatched ACK and never retries 409`() = runBlocking {
        val node = DriveNode(2, 1, "item.txt", "file", revision = 4)
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(
                """{"operation_id":"ack-batch","deleted_ids":[100]}"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.trashNodes("access-secret", listOf(node)) }.reason)
            server.takeRequest()
            server.enqueue(MockResponse().setResponseCode(409).setBody(
                """{"error":"revision_conflict","private":"secret"}"""))
            val conflict = failure { api.trashNodes("access-secret", listOf(node)) }
            assertEquals(409, conflict.statusCode)
            assertFalse(conflict.toString().contains("secret"))
            assertEquals(2, server.requestCount)
        } }
    }

    @Test fun `copy and move use numeric parent id Owner bearer and move If Match`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val original = DriveNode(10, 1, "notes.txt", "file", size = 123, revision = 4)
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"id":11,"parent_id":9,"name":"notes.txt","type":"file","size":123,"revision":1}"""))
            val copied = api.copyNode("access-secret", original, 9)
            assertEquals(11L, copied.id)
            val copyReq = server.takeRequest()
            assertEquals("POST", copyReq.method)
            assertEquals("/api/v1/nodes/10/copy", copyReq.path)
            assertEquals("Bearer access-secret", copyReq.getHeader("Authorization"))
            assertNull(copyReq.getHeader("If-Match"))
            val copyValue = body(copyReq)["parent_id"]!!.jsonPrimitive
            assertFalse(copyValue.isString)
            assertEquals(9L, copyValue.long)

            server.enqueue(MockResponse().setResponseCode(200).setBody(
                """{"id":10,"parent_id":9,"name":"notes.txt","type":"file","size":123,"revision":5}"""))
            val moved = api.moveNode("access-secret", original, 9)
            assertEquals(9L, moved.parentId)
            assertEquals(5L, moved.revision)
            val moveReq = server.takeRequest()
            assertEquals("PATCH", moveReq.method)
            assertEquals("/api/v1/nodes/10", moveReq.path)
            assertEquals("Bearer access-secret", moveReq.getHeader("Authorization"))
            assertEquals("\"4\"", moveReq.getHeader("If-Match"))
            val moveValue = body(moveReq)["parent_id"]!!.jsonPrimitive
            assertFalse(moveValue.isString)
            assertEquals(9L, moveValue.long)
        } }
    }

    @Test fun `copy target and move revision errors fail closed without replay`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val original = DriveNode(10, 1, "notes.txt", "file", revision = 4)
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.moveNode("access-secret", original, 1) }
            }
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.copyNode("access-secret", original, 0) }
            }
            assertEquals(0, server.requestCount)
            server.enqueue(MockResponse().setResponseCode(409).setBody(
                """{"error":"conflict","token":"access-secret"}"""))
            val conflict = failure { api.moveNode("access-secret", original, 9) }
            assertEquals(409, conflict.statusCode)
            assertFalse(conflict.toString().contains("secret"))
            assertEquals(1, server.requestCount)
            server.takeRequest()

            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"id":11,"parent_id":8,"name":"notes.txt","type":"file","revision":1}"""))
            val wrongParent = failure { api.copyNode("access-secret", original, 9) }
            assertEquals(ApiFailureReason.INVALID_RESPONSE, wrongParent.reason)
            assertEquals(2, server.requestCount)
        } }
    }

    @Test fun `native Files mutation routes use same bearer client and exact node revisions`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(201).setBody(
                """{"id":9,"parent_id":1,"name":"旅行","type":"dir","revision":1}"""))
            val created = api.createDirectory("access-secret", 1, "旅行")
            assertEquals(9L, created.id)
            val post = server.takeRequest()
            assertEquals("POST", post.method)
            assertEquals("/api/v1/nodes/1/directories", post.path)
            assertEquals("Bearer access-secret", post.getHeader("Authorization"))
            assertNull(post.getHeader("If-Match"))
            assertEquals("旅行", body(post)["name"]!!.jsonPrimitive.content)

            val previous = DriveNode(10, 1, "before.txt", "file", 128, revision = 3)
            server.enqueue(MockResponse().setResponseCode(200).setBody(
                """{"id":10,"parent_id":1,"name":"after.txt","type":"file","size":128,"revision":4}"""))
            val renamed = api.renameNode("access-secret", previous, "after.txt")
            assertEquals("after.txt", renamed.name)
            assertEquals(4L, renamed.revision)
            val patch = server.takeRequest()
            assertEquals("PATCH", patch.method)
            assertEquals("/api/v1/nodes/10", patch.path)
            assertEquals("Bearer access-secret", patch.getHeader("Authorization"))
            assertEquals("\"3\"", patch.getHeader("If-Match"))
            assertEquals("after.txt", body(patch)["name"]!!.jsonPrimitive.content)

            server.enqueue(MockResponse().setResponseCode(204))
            api.trashNode("access-secret", renamed)
            val delete = server.takeRequest()
            assertEquals("DELETE", delete.method)
            assertEquals("/api/v1/nodes/10", delete.path)
            assertEquals("Bearer access-secret", delete.getHeader("Authorization"))
            assertEquals("\"4\"", delete.getHeader("If-Match"))
        } }
    }

    @Test fun `file mutation name rules match Go Windows subset and reject bad inputs locally`() = runBlocking {
        assertTrue(validDriveNodeName("旅行 2026"))
        assertTrue(validDriveNodeName(".gitignore"))
        for (value in listOf("", ".", "..", "bad/", "a?", "a.", "a ", "CON", "NUL.txt",
            "com1.log", "Lpt9", "a\\b", "x".repeat(256))) {
            assertFalse(value, validDriveNodeName(value))
        }
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.createDirectory("access-secret", 1, "NUL.txt") }
            }
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.renameNode("access-secret", DriveNode(4, 1, "a", "file", revision = 0), "b") }
            }
            assertEquals(0, server.requestCount)
        } }
    }

    @Test fun `409 revision conflicts never retry destructive write or leak credentials`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(409).setBody(
                """{"error":"revision_conflict","detail":"password-secret"}"""))
            val before = DriveNode(2, 1, "a.txt", "file", revision = 7)
            val err = failure { api.trashNode("access-secret", before) }
            assertEquals(409, err.statusCode)
            assertFalse(err.toString().contains("secret"))
            assertEquals(1, server.requestCount)
            assertEquals("\"7\"", server.takeRequest().getHeader("If-Match"))
        } }
    }

    @Test fun `wrong current password has a safe endpoint specific reason`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"current password is incorrect","detail":"password-secret"}"""))
            val error = failure { api.changePassword("access-secret", "old-secret", "new-secret") }
            assertEquals(401, error.statusCode)
            assertNull(error.cause)
            assertFalse(error.toString().contains("secret"))
            assertEquals(ApiFailureReason.CURRENT_PASSWORD_INCORRECT, error.reason)
        } }
    }

    @Test fun `password error classification rejects other endpoints statuses malformed and oversized bodies`() = runBlocking {
        val known = """{"error":"current password is incorrect"}"""
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val cases = listOf(
                MockResponse().setResponseCode(401).setBody(known),
                MockResponse().setResponseCode(403).setBody(known),
                MockResponse().setResponseCode(401).setBody("""{"error":"expired access-secret"}"""),
                MockResponse().setResponseCode(401).setBody("password-secret"),
                MockResponse().setResponseCode(401).setBody(known + " ".repeat(4096)),
                MockResponse().setResponseCode(401).setChunkedBody(known + " ".repeat(4096), 128),
            )
            cases.forEachIndexed { index, response ->
                server.enqueue(response)
                val error = failure {
                    if (index == 0) api.login("owner", "password-secret")
                    else api.changePassword("access-secret", "old-secret", "new-secret")
                }
                assertEquals(ApiFailureReason.UNKNOWN, error.reason)
                assertEquals("Server request failed", error.message)
                assertNull(error.cause)
                assertFalse(error.toString().contains("secret"))
            }
        } }
    }

    @Test fun `Owner global search uses existing bounded cursor HTTP API`() = runBlocking {
        // The Go /search contract emits directory-only breadcrumbs for
        // files, unlike Recent/Favorites which include the file itself.
        val row = """{"node":{"id":7,"parent_id":1,"name":"trip.jpg","type":"file","revision":8,"size":100},"path":"trip.jpg","breadcrumbs":[{"id":1,"name":""}]}"""
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("""{"items":[$row],"next_cursor":"opaque_cursor_1"}"""))
            val first = api.searchFiles("access-secret", " trip ")
            assertEquals(7L, first.items.single().node.id)
            assertEquals(listOf(1L), first.items.single().crumbs.map { it.id })
            assertEquals("opaque_cursor_1", first.nextCursor)
            val request = server.takeRequest()
            assertEquals("GET", request.method)
            assertEquals("/api/v1/search", request.requestUrl!!.encodedPath)
            assertEquals("trip", request.requestUrl!!.queryParameter("q"))
            assertEquals("100", request.requestUrl!!.queryParameter("limit"))
            assertEquals("name", request.requestUrl!!.queryParameter("sort"))
            assertEquals("asc", request.requestUrl!!.queryParameter("order"))
            assertNull(request.requestUrl!!.queryParameter("cursor"))
            assertEquals("Bearer access-secret", request.getHeader("Authorization"))

            server.enqueue(MockResponse().setBody("""{"items":[$row]}"""))
            val last = api.searchFiles("access-secret", "trip", "opaque_cursor_1")
            assertEquals("", last.nextCursor)
            assertEquals(7L, last.items.single().node.id)
            val second = server.takeRequest()
            assertEquals("opaque_cursor_1", second.requestUrl!!.queryParameter("cursor"))
            assertEquals("Bearer access-secret", second.getHeader("Authorization"))
        } }
    }

    @Test fun `search rejects malformed cursors responses and invalid query before request`() = runBlocking {
        val malformed = listOf(
            """{"items":{}}""",
            """{"items":[],"next_cursor":"nonprogress"}""",
            """{"items":[{"node":{"id":2,"parent_id":1,"name":"foo","type":"file"},"path":"foo","crumbs":[{"id":1,"name":""},{"id":2,"name":"foo"}]}]}""",
            """{"items":[{"node":{"id":2,"parent_id":1,"name":"foo","type":"file"},"path":"foo","breadcrumbs":[{"id":1,"name":""},{"id":3,"name":"foo"}]}]}""",
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.searchFiles("access-secret", "x") }
            }
            // UTF-16 surrogate pairs are one Unicode scalar; the Server requires
            // at least two runes and must not receive a one-emoji query.
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.searchFiles("access-secret", "😀") }
            }
            assertEquals(0, server.requestCount)
            malformed.forEachIndexed { index, body ->
                server.enqueue(MockResponse().setBody(body))
                val err = failure {
                    api.searchFiles("access-secret", "foobar", if (index == 1) "old" else "")
                }
                assertEquals(ApiFailureReason.INVALID_RESPONSE, err.reason)
                assertFalse(err.toString().contains("secret"))
            }
        } }
    }

    @Test fun `real Owner recent and favorites use existing JSON routes and verified crumbs`() = runBlocking {
        val row = """{"node":{"id":2,"parent_id":1,"name":"doc.txt","type":"file","size":32,"revision":7},"path":"doc.txt","crumbs":[{"id":1,"name":""},{"id":2,"name":"doc.txt"}],"accessed_at":"2026-10-25T00:00:00Z"}"""
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody("[$row]"))
            val recent = api.fileRecent("access-secret")
            assertEquals(1, recent.size)
            assertEquals(2L, recent.single().node.id)
            assertEquals(listOf(1L, 2L), recent.single().crumbs.map { it.id })
            val r = server.takeRequest()
            assertEquals("/api/v1/file-recent?limit=50", r.path)
            assertEquals("GET", r.method)
            assertEquals("Bearer access-secret", r.getHeader("Authorization"))

            server.enqueue(MockResponse().setBody("[$row]"))
            val favorite = api.fileFavorites("access-secret")
            assertEquals(2L, favorite.single().node.id)
            val f = server.takeRequest()
            assertEquals("/api/v1/file-favorites", f.path)
            assertEquals("Bearer access-secret", f.getHeader("Authorization"))

            server.enqueue(MockResponse().setResponseCode(201).setBody(row))
            assertEquals(2L, api.favoriteFile("access-secret", 2).node.id)
            val put = server.takeRequest()
            assertEquals("PUT", put.method)
            assertEquals("/api/v1/file-favorites/2", put.path)
            assertEquals("Bearer access-secret", put.getHeader("Authorization"))

            server.enqueue(MockResponse().setResponseCode(204))
            api.unfavoriteFile("access-secret", 2)
            val delete = server.takeRequest()
            assertEquals("DELETE", delete.method)
            assertEquals("/api/v1/file-favorites/2", delete.path)
            assertEquals("Bearer access-secret", delete.getHeader("Authorization"))
        } }
    }

    @Test fun `recent and favorites reject wrong JSON shape identity or unsafe owner range`() = runBlocking {
        val node = """{"id":3,"parent_id":1,"name":"doc.txt","type":"file"}"""
        val cases = listOf(
            "{}",
            """[{"node":$node,"path":"doc.txt","crumbs":[]}]""",
            """[{"node":$node,"path":"doc.txt","crumbs":[{"id":1,"name":""},{"id":2,"name":"doc.txt"}]}]""",
            """[{"node":$node,"path":"doc.txt","crumbs":[{"id":3,"name":"doc.txt"}]}]""",
            """[{"node":$node,"path":"doc.txt","crumbs":[{"id":1,"name":""},{"id":1,"name":""},{"id":3,"name":"doc.txt"}]}]""",
            "password-secret",
        )
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            cases.forEach { invalid ->
                server.enqueue(MockResponse().setBody(invalid))
                val err = failure { api.fileRecent("access-secret") }
                assertEquals(ApiFailureReason.INVALID_RESPONSE, err.reason)
                assertFalse(err.toString().contains("secret"))
            }
            server.enqueue(MockResponse().setBody("""[{"node":$node,"path":"doc.txt","crumbs":[{"id":1,"name":""},{"id":3,"name":"doc.txt"}]}]"""))
            val valid = api.fileFavorites("access-secret")
            assertEquals(3L, valid.single().node.id)
            server.enqueue(MockResponse().setBody("{}"))
            val err = failure { api.fileFavorites("access-secret") }
            assertEquals(ApiFailureReason.INVALID_RESPONSE, err.reason)
        } }
    }

    @Test fun `short nonfinal range is rejected instead of skipping missing rows`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(page("""[{"id":2,"parent_id":1,"name":"a","type":"file"}]""", 101)))
            assertEquals("Invalid server response", failure { api.children("access-secret", 1, 0) }.message)
        } }
    }

    @Test fun `origin validation rejects credential and ambiguous URLs`() {
        for (input in listOf("", "http://example.com", "ftp://example.com", "https://u:p@example.com", "https://example.com?x=1", "https://example.com#x", "https://example.com/api", "https:\\example.com", "https://example.com\\evil", "https:///example.com", "https://example.com:99999", "https://example.com/..")) {
            assertThrows(input, IllegalArgumentException::class.java) { ServerAddress.parse(input, false) }
        }
        assertEquals("https://example.com/", ServerAddress.parse("HTTPS://EXAMPLE.COM:443/", false).url)
        assertEquals("http://localhost:8080/", ServerAddress.parse("http://localhost:8080", true).url)
    }

    @Test fun `real HTTP auth password refresh logout contracts and redaction`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(auth))
            server.enqueue(MockResponse().setBody(auth.replace("access_token", "token")))
            server.enqueue(MockResponse().setBody(auth.replace("true", "false")))
            server.enqueue(MockResponse().setResponseCode(204))
            XDriveApi(address(server)).use { api ->
                val session = api.login("owner", "password-secret")
                assertTrue(session.mustChangePassword)
                assertFalse(session.toString().contains("secret"))
                val login = server.takeRequest()
                assertEquals("/api/v1/auth/login", login.path)
                assertEquals("POST", login.method)
                assertNull(login.getHeader("Authorization"))
                assertEquals("password-secret", body(login)["password"]!!.jsonPrimitive.content)
                assertEquals("access-secret", api.refresh("refresh-secret").accessToken)
                val refresh = server.takeRequest()
                assertEquals("/api/v1/auth/refresh", refresh.path)
                assertEquals("refresh-secret", body(refresh)["refresh_token"]!!.jsonPrimitive.content)
                assertFalse(api.changePassword(session.accessToken, "old-secret", "new-secret").mustChangePassword)
                val change = server.takeRequest()
                assertEquals("/api/v1/me/change-password", change.path)
                assertEquals("Bearer access-secret", change.getHeader("Authorization"))
                val payload = body(change)
                assertEquals("old-secret", payload["current_password"]!!.jsonPrimitive.content)
                assertEquals("new-secret", payload["new_password"]!!.jsonPrimitive.content)
                api.logout("refresh-secret")
                val logout = server.takeRequest()
                assertEquals("/api/v1/auth/logout", logout.path)
                assertEquals("refresh-secret", body(logout)["refresh_token"]!!.jsonPrimitive.content)
            }
        }
    }

    @Test fun `real HTTP root and bounded range use owner bearer and exact query`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(directory))
            server.enqueue(MockResponse().setBody(page("""[{"id":2,"parent_id":1,"name":"photo.jpg","type":"file","size":123,"revision":8}]""", 101, 100)))
            XDriveApi(address(server)).use { api ->
                assertTrue(api.root("access-secret").isDirectory)
                val root = server.takeRequest()
                assertEquals("/api/v1/nodes/root", root.path)
                assertEquals("Bearer access-secret", root.getHeader("Authorization"))
                val result = api.children("access-secret", 1, 100)
                assertEquals(101L, result.totalCount)
                assertEquals(123L, result.items.single().size)
                val request = server.takeRequest()
                assertEquals("/api/v1/nodes/1/children", request.requestUrl!!.encodedPath)
                assertEquals(mapOf("offset" to "100", "limit" to "100", "sort" to "name", "order" to "asc", "group" to "none", "folders_first" to "true", "include_count" to "true"), request.requestUrl!!.queryParameterNames.associateWith { request.requestUrl!!.queryParameter(it) })
                assertEquals("Bearer access-secret", request.getHeader("Authorization"))
            }
        }
    }

    @Test fun `range refuses missing count mismatched bounds duplicates invalid nodes and oversized pages`() = runBlocking {
        val node = """{"id":2,"parent_id":1,"name":"a","type":"file"}"""
        val invalid = listOf(page(total = -1), page(offset = 1), page(limit = 101), page("[$node]"), page("[$node,$node]", 2), page("[${node.replace("\"file\"", "\"bad\"")}]", 1), page("[${node.replace("\"id\":2", "\"id\":0")}]", 1), page("[${node.replace("\"parent_id\":1", "\"parent_id\":7")}]", 1), page("null", 1), page("[${List(101) { node.replace("\"id\":2", "\"id\":${it + 2}") }.joinToString(",")}]", 101), page().replace("\"total_count\":0,", ""), page().replace("\"total_count_included\":true", "\"total_count_included\":false"))
        MockWebServer().use { server ->
            XDriveApi(address(server)).use { api ->
                for (payload in invalid) {
                    server.enqueue(MockResponse().setBody(payload))
                    failure { api.children("access-secret", 1, 0) }
                }
                server.enqueue(MockResponse().setBody(page("null")))
                assertTrue(api.children("access-secret", 1, 0).items.isEmpty())
                server.enqueue(MockResponse().setBody(page("null", offset = 100)))
                assertTrue(api.children("access-secret", 1, 100).items.isEmpty())
            }
        }
    }

    @Test fun `redirects are refused without forwarding secrets even on injected client`() = runBlocking {
        MockWebServer().use { target -> MockWebServer().use { server ->
            target.enqueue(MockResponse().setBody(directory))
            server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", target.url("/stolen")))
            val client = OkHttpClient()
            try {
                XDriveApi(address(server), client).use { api -> assertEquals(307, failure { api.root("access-secret") }.statusCode) }
                assertEquals(0, target.requestCount)
            } finally { client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
        } }
    }

    @Test fun `malformed oversized HTTP and network errors never retain secrets`() = runBlocking {
        MockWebServer().use { server ->
            XDriveApi(address(server)).use { api ->
                for (response in listOf(MockResponse().setResponseCode(401).setBody("password-secret access-secret"), MockResponse().setBody("password-secret"), MockResponse().setBody("""{"access_token":"","refresh_token":"refresh-secret","username":"owner"}"""), MockResponse().setBody("x".repeat(2 * 1024 * 1024 + 1)), MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))) {
                    server.enqueue(response)
                    val error = failure { api.login("owner", "password-secret") }
                    assertFalse(error.toString().contains("secret"))
                    assertNull(error.cause)
                }
            }
        }
    }

    @Test fun `authentication rejects absent empty and header unsafe tokens`() = runBlocking {
        val invalid = listOf(auth.replace("access-secret", ""), auth.replace("refresh-secret", ""), auth.replace("access-secret", "bad token"), auth.replace("access-secret", "private-秘密-token"), auth.replace("refresh-secret", "private-秘密-token"), auth.replace("refresh-secret", "bad\\ntoken"), auth.replace("\"must_change_password\":true", "\"must_change_password\":\"true\""), auth.replace("\"username\":\"owner\",", ""))
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            invalid.forEach { payload ->
                server.enqueue(MockResponse().setBody(payload))
                failure { api.login("owner", "password-secret") }
            }
        } }
    }

    @Test fun `supplied unsafe bearer tokens receive client owned constant validation errors`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            for (token in listOf("private-秘密-token", "private-\u007f-token", "private-\n-token", "private- token")) {
                try {
                    api.root(token)
                    fail("Unsafe bearer token must be rejected")
                } catch (error: Exception) {
                    assertTrue(error is IllegalArgumentException)
                    assertEquals("Invalid access token", error.message)
                    assertFalse(error.toString().contains(token))
                    assertFalse(error.toString().contains("private-"))
                    assertNull(error.cause)
                }
            }
            assertEquals(0, server.requestCount)
        } }
    }

    @Test fun `unknown length response is bounded while receiving bytes`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setChunkedBody("x".repeat(2 * 1024 * 1024 + 1), 8192))
            XDriveApi(address(server)).use { api ->
                failure { api.root("access-secret") }
                Unit
            }
        }
    }

    @Test fun `HTTPS uses platform trust and accepts only explicitly supplied test CA`() = runBlocking {
        val certificate = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        MockWebServer().use { server ->
            server.useHttps(serverTls.sslSocketFactory(), false)
            server.enqueue(MockResponse().setBody(directory))
            // MockWebServer's default bind address may expose a numeric IP on Windows.
            // Use the precise DNS name covered by this fixture certificate's SAN.
            val address = ServerAddress.parse(server.url("/").newBuilder().host("localhost").build().toString(), false)
            XDriveApi(address).use { api ->
                val error = failure { api.root("access-secret") }
                assertEquals(0, error.statusCode)
                assertNull(error.cause)
                assertFalse(error.toString().contains("access-secret"))
            }
            val testTrust = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
            val client = OkHttpClient.Builder().sslSocketFactory(testTrust.sslSocketFactory(), testTrust.trustManager).build()
            try {
                XDriveApi(address, client).use { api -> assertEquals(1L, api.root("access-secret").id) }
            } finally { client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
        }
    }

    @Test fun `coroutine cancellation cancels actual in flight call`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val canceled = CountDownLatch(1)
            val client = OkHttpClient.Builder().eventListener(object : EventListener() {
                override fun canceled(call: Call) { canceled.countDown() }
            }).build()
            try {
                XDriveApi(address(server), client).use { api ->
                    val job = launch { api.root("access-secret") }
                    withContext(Dispatchers.IO) { assertNotNull(server.takeRequest(5, TimeUnit.SECONDS)) }
                    job.cancelAndJoin()
                    assertTrue(canceled.await(5, TimeUnit.SECONDS))
                }
            } finally { client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
        }
    }
    @Test fun `Trash uses Owner Bearer, a strict 100-row range and If-Match restore`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val row = """{"id":42,"parent_id":1,"name":"deleted.jpg","type":"file",
                "size":9,"revision":6,"deleted_at":"2026-10-26T00:00:00Z"}"""
            server.enqueue(MockResponse().setBody(
                """{"items":[$row],"total_count":1,"total_count_included":true,
                "offset":0,"limit":100,"sort":"updated","order":"desc"}"""))
            server.enqueue(MockResponse().setBody(
                """{"id":42,"parent_id":1,"name":"deleted.jpg","type":"file",
                "size":9,"revision":7}"""))
            val page = api.trashPage("owner-secret", 0)
            assertEquals(1L, page.totalCount)
            assertEquals(42L, page.items.single().node.id)
            assertEquals("2026-10-26T00:00:00Z", page.items.single().deletedAt)
            val list = server.takeRequest()
            assertEquals("GET", list.method)
            assertEquals("/api/v1/trash?range=true&offset=0&limit=100&sort=updated&order=desc&include_count=true", list.path)
            assertEquals("Bearer owner-secret", list.getHeader("Authorization"))
            val restored = api.restoreTrash("owner-secret", page.items.single().node)
            assertEquals(7L, restored.revision)
            val mutation = server.takeRequest()
            assertEquals("POST", mutation.method)
            assertEquals("/api/v1/trash/42/restore", mutation.path)
            assertEquals(34.toChar().toString() + "6" + 34.toChar(), mutation.getHeader("If-Match"))
            assertEquals("Bearer owner-secret", mutation.getHeader("Authorization"))
            assertEquals("{}", mutation.body.readUtf8())
        } }
    }

    @Test fun `Trash rejects active row and never retries failed restore`() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            server.enqueue(MockResponse().setBody(
                """{"items":[{"id":7,"parent_id":1,"name":"active","type":"file",
                "revision":3}],"total_count":1,"total_count_included":true,
                "offset":0,"limit":100,"sort":"updated","order":"desc"}"""))
            assertEquals(ApiFailureReason.INVALID_RESPONSE,
                failure { api.trashPage("owner-secret", 0) }.reason)
            server.enqueue(MockResponse().setResponseCode(412).setBody("{}"))
            val original = DriveNode(42, 1, "deleted.jpg", "file", revision = 6)
            assertEquals(412, failure { api.restoreTrash("owner-secret", original) }.statusCode)
            assertEquals(2, server.requestCount)
            server.takeRequest()
            assertEquals(34.toChar().toString() + "6" + 34.toChar(),
                server.takeRequest().getHeader("If-Match"))
        } }
    }


    @Test fun livePhotoMotionUsesSignedOwnerResourceAndPinsFirstETagAcrossSeeks() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val still = DriveNode(7, 1, "photo.livp", "file", size = 10_000, revision = 4)
            val etag = "\"live-photo-motion-" + "a".repeat(64) + "\""
            server.enqueue(MockResponse().setBody("""
                {"url":"/api/v1/media-live-photo-motion/7?ticket=short-lived",
                 "expires_at":"2026-10-26T09:00:00Z","kind":"video","mime_type":"video/quicktime"}
            """.trimIndent()))
            server.enqueue(MockResponse().setResponseCode(206)
                .setHeader("ETag", etag)
                .setHeader("Content-Range", "bytes 3-6/7").setBody("defg"))
            server.enqueue(MockResponse().setResponseCode(206)
                .setHeader("ETag", etag)
                .setHeader("Content-Range", "bytes 1-2/7").setBody("bc"))
            val player = api.galleryLivePhotoMotionPlayback("owner-secret", still)
            try {
                assertFalse(player.url.contains("owner-secret"))
                assertTrue(player.url.contains("ticket=short-lived"))
                player.client.newCall(Request.Builder().url(player.url)
                    .header("Range", "bytes=3-").build()).execute().use {
                    assertEquals(206, it.code)
                    assertEquals("defg", it.body!!.string())
                }
                player.client.newCall(Request.Builder().url(player.url)
                    .header("Range", "bytes=1-2").build()).execute().use {
                    assertEquals(206, it.code)
                    assertEquals("bc", it.body!!.string())
                }
                val issue = server.takeRequest()
                assertEquals("POST", issue.method)
                assertEquals("/api/v1/media/items/7/live-photo-motion-ticket", issue.path)
                assertEquals("Bearer owner-secret", issue.getHeader("Authorization"))
                val first = server.takeRequest()
                assertEquals("/api/v1/media-live-photo-motion/7?ticket=short-lived", first.path)
                assertNull(first.getHeader("Authorization"))
                assertNull(first.getHeader("If-Match"))
                assertEquals("identity", first.getHeader("Accept-Encoding"))
                val second = server.takeRequest()
                assertEquals(etag, second.getHeader("If-Match"))
                assertEquals("bytes=1-2", second.getHeader("Range"))
            } finally { player.close() }
        } }
    }

    @Test fun livePhotoMotionRejectsETagSwapRangeDowngradeAndForeignURL() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val still = DriveNode(8, 1, "photo.livp", "file", size = 1000, revision = 3)
            val firstETag = "\"live-photo-motion-" + "a".repeat(64) + "\""
            val otherETag = "\"live-photo-motion-" + "b".repeat(64) + "\""
            server.enqueue(MockResponse().setBody("""
                {"url":"/api/v1/media-live-photo-motion/8?ticket=one",
                 "kind":"video","mime_type":"video/quicktime"}
            """.trimIndent()))
            server.enqueue(MockResponse().setResponseCode(206).setHeader("ETag", firstETag)
                .setHeader("Content-Range", "bytes 0-2/7").setBody("abc"))
            val source = api.galleryLivePhotoMotionPlayback("owner-secret", still)
            try {
                source.client.newCall(Request.Builder().url(source.url)
                    .header("Range", "bytes=0-").build()).execute().close()
                for (response in listOf(
                    MockResponse().setResponseCode(206).setHeader("ETag", otherETag)
                        .setHeader("Content-Range", "bytes 3-6/7").setBody("defg"),
                    MockResponse().setResponseCode(200).setHeader("ETag", firstETag)
                        .setBody("abcdefg"),
                )) {
                    server.enqueue(response)
                    try {
                        source.client.newCall(Request.Builder().url(source.url)
                            .header("Range", "bytes=3-").build()).execute().close()
                        fail("Unverified Live Photo seek must fail closed")
                    } catch (_: java.io.IOException) { }
                }
                try {
                    source.client.newCall(Request.Builder()
                        .url("https://unexpected.invalid/motion.mov").build()).execute().close()
                    fail("Foreign Live Photo origin must be rejected before network")
                } catch (_: java.io.IOException) { }
                assertEquals("Only ticket plus three local requests", 4, server.requestCount)
            } finally { source.close() }
        } }
    }

    @Test fun livePhotoStillUsesRevisionBoundTicketAndBoundedSameOriginGET() = runBlocking {
        MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
            val still = DriveNode(9, 1, "photo.livp", "file", size = 5000, revision = 5)
            val etag = "\"live-photo-still-" + "c".repeat(64) + "-100-4\""
            server.enqueue(MockResponse().setBody("""
                {"url":"/api/v1/media-live-photo-still/9?ticket=one",
                 "kind":"image","mime_type":"image/jpeg"}
            """.trimIndent()))
            server.enqueue(MockResponse().setHeader("ETag", etag)
                .setHeader("Content-Type", "image/jpeg").setBody("jpeg"))
            val progress = mutableListOf<Pair<Long, Long?>>()
            assertArrayEquals("jpeg".toByteArray(), api.galleryLivePhotoStill(
                "owner-secret", still, { done, total -> progress += done to total }))
            assertEquals(listOf(4L to 4L), progress)
            val ticket = server.takeRequest()
            assertEquals("POST", ticket.method)
            assertEquals("Bearer owner-secret", ticket.getHeader("Authorization"))
            assertEquals("/api/v1/media/items/9/live-photo-still-ticket", ticket.path)
            val stream = server.takeRequest()
            assertNull(stream.getHeader("Authorization"))
            assertEquals("/api/v1/media-live-photo-still/9?ticket=one", stream.path)
            assertEquals("identity", stream.getHeader("Accept-Encoding"))
        } }
    }

    @Test fun livePhotoTicketsRejectForeignOriginAndUnrelatedSignedPaths() = runBlocking {
        for (bad in listOf(
            "https://attacker.invalid/media-live-photo-motion/7?ticket=foo",
            "//attacker.invalid/api/v1/media-live-photo-motion/7?ticket=foo",
            "/api/v1/media-live-photo-still/7?ticket=foo",
            "/api/v1/media-live-photo-motion/99?ticket=foo",
            "/api/v1/media-live-photo-motion/7?ticket=one&other=secret",
        )) {
            MockWebServer().use { server -> XDriveApi(address(server)).use { api ->
                server.enqueue(MockResponse().setBody(
                    """{"url":""" + JsonPrimitive(bad).toString() +
                        ""","kind":"video","mime_type":"video/quicktime"}"""))
                val node = DriveNode(7, 1, "private.livp", "file", size = 1000, revision = 4)
                failure { api.galleryLivePhotoMotionPlayback("owner-secret", node) }
                assertEquals("Only the trusted ticket POST is allowed", 1, server.requestCount)
            } }
        }
    }

}
