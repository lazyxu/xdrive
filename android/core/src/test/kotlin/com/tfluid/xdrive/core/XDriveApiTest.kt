package com.tfluid.xdrive.core

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class XDriveApiTest {
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
}
