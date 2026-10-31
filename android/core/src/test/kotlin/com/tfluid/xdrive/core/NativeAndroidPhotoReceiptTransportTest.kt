package com.tfluid.xdrive.core

import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** The real HTTP transport never creates a second POST to reconcile an ACK. */
class NativeAndroidPhotoReceiptTransportTest {
    private val key = "and_" + "a".repeat(64)
    private val sha = "b".repeat(64)
    private val name = "xdrive-photo-" + "c".repeat(20) + "-" +
        "d".repeat(20) + ".jpg"
    private val id = "00000000-0000-4000-8000-000000000451"

    private fun response(status: String, resultName: String = name,
        resultHash: String = sha): String {
        val extra = if (status == "finalized") """,
            "result":{"id":85,"parent_id":7,"name":"$resultName",
                "type":"file","size":6,"revision":2}""" else ""
        return """{"id":"$id","parent_id":7,"name":"$name",
            "resume_key":"$key","size":6,"sha256":"$resultHash",
            "chunk_size":8388608,"chunk_count":1,
            "status":"$status"$extra}"""
    }

    @Test fun exactFinalizedGoReceiptUsesReadOnlyScopedPost(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(200)
                .setBody(response("finalized")))
            XDriveApi(ServerAddress.parse(server.url("/").toString(),
                allowHttp = true)).use { api ->
                val node = api.inspectNativePhotoUpload(
                    "owner-token", 7, name, 6, sha, key)
                assertEquals(85L, node?.id)
                assertEquals(name, node?.name)
                val req = server.takeRequest()
                assertEquals("POST", req.method)
                assertEquals("/api/v1/uploads/android-photo-receipt", req.path)
                assertEquals("Bearer owner-token", req.getHeader("Authorization"))
                val body = req.body.readUtf8()
                assertTrue(body.contains(key))
                assertTrue(body.contains(sha))
                assertFalse(req.path!!.contains(key))
                assertFalse(req.path!!.contains(sha))
                assertEquals(1, server.requestCount)
            }
        }
    }

    @Test fun activeOrMissingReceiptDoesNotProveUploadSucceeded(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(response("active")))
            server.enqueue(MockResponse().setResponseCode(404)
                .setBody("""{"error":"missing"}"""))
            XDriveApi(ServerAddress.parse(server.url("/").toString(),
                allowHttp = true)).use { api ->
                assertNull(api.inspectNativePhotoUpload(
                    "owner-token", 7, name, 6, sha, key))
                assertThrows(ApiException::class.java) {
                    runBlocking { api.inspectNativePhotoUpload(
                        "owner-token", 7, name, 6, sha, key) }
                }
                assertEquals(2, server.requestCount)
            }
        }
    }

    @Test fun forgedFinalizedShaOrNodeIsNeverAccepted(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(response("finalized",
                resultHash = "e".repeat(64))))
            server.enqueue(MockResponse().setBody(response("finalized",
                resultName = "wrong.jpg")))
            XDriveApi(ServerAddress.parse(server.url("/").toString(),
                allowHttp = true)).use { api ->
                repeat(2) {
                    assertThrows(ApiException::class.java) {
                        runBlocking { api.inspectNativePhotoUpload(
                            "owner-token", 7, name, 6, sha, key) }
                    }
                }
                assertEquals(2, server.requestCount)
            }
        }
    }

    @Test fun exactResumeKeyCanCreateAnInstantFinalizedPhotoOnce(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(response("finalized")))
            XDriveApi(ServerAddress.parse(server.url("/").toString(),
                allowHttp = true)).use { api ->
                val root = DriveNode(7, null, "", "dir", revision = 1)
                val original = byteArrayOf(1, 2, 3, 4, 5, 6)
                val node = api.uploadNativePhotoOriginal(
                    "owner-token", root, name, original.size.toLong(), sha, key,
                    { ByteArrayInputStream(original) }, {})
                assertEquals(85L, node.id)
                val create = server.takeRequest()
                assertEquals("POST", create.method)
                assertEquals("/api/v1/uploads", create.path)
                val data = create.body.readUtf8()
                assertTrue(data.contains(key))
                assertTrue(data.contains(sha))
                assertEquals(1, server.requestCount)
            }
        }
    }
}
