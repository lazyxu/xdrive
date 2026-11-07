package com.tfluid.xdrive.core

import java.io.ByteArrayInputStream
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Real Android transport through Go's single managed UploadSession writer. */
class NativeAndroidManagedOriginalTransportTest {
    private val device = NativeAndroidDeviceEnrollment(
        "00000000-0000-4000-8000-000000000188", "A".repeat(43), "Pixel", "1")
    private val destination = NativeAndroidPhotoDestination(
        configured = true, deviceId = device.deviceId,
        name = "Pixel 原件", sourceId = 19, sourceRevision = 2,
        targetNodeId = 120, targetPath = "同步文件夹/Push/Pixel_${device.deviceId}/Pixel 原件")
    private val name = "xdrive-photo-" + "b".repeat(20) + "-" + "c".repeat(20) + ".jpg"
    private val key = "and_" + "d".repeat(64)
    private val sessionId = "00000000-0000-4000-8000-000000000199"
    private val original = byteArrayOf(1, 2, 3, 4, 5, 6)
    private val hash = MessageDigest.getInstance("SHA-256").digest(original)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    private val receivedNode = """
        {"id":85,"parent_id":120,"name":"$name",
         "type":"file","size":6,"revision":2}
    """.trimIndent()

    private fun uploadSession(status: String, result: Boolean = false): String {
        val extra = if (result) ",\"result\":" + receivedNode else ""
        return """{"id":"$sessionId","parent_id":120,"name":"$name","size":6,
            "sha256":"$hash","resume_key":"$key","chunk_size":8388608,
            "chunk_count":1,"status":"$status"$extra}"""
    }

    @Test fun exactManagedOriginalNeverUsesGenericOwnerWriter(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(uploadSession("active")))
            server.enqueue(MockResponse().setResponseCode(201)
                .setBody("""{"index":0,"size":6,"sha256":"$hash"}"""))
            server.enqueue(MockResponse().setBody(uploadSession("finalized", true)))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), allowHttp = true))
                .use { api ->
                    val done = api.uploadManagedAndroidPhotoOriginal(
                        "owner-token", device, destination, name, 6, hash, key,
                        { ByteArrayInputStream(original) }, {})
                    assertEquals(85L, done.id)
                    assertEquals(120L, done.parentId)
                    assertEquals(3, server.requestCount)
                    val init = server.takeRequest()
                    val chunk = server.takeRequest()
                    val finalize = server.takeRequest()
                    assertEquals("POST", init.method)
                    assertEquals("/api/v1/android/photos/managed/uploads", init.path)
                    assertEquals("PUT", chunk.method)
                    assertEquals("/api/v1/android/photos/managed/uploads/$sessionId/chunks/0",
                        chunk.path)
                    assertEquals("POST", finalize.method)
                    assertEquals("/api/v1/android/photos/managed/uploads/$sessionId/finalize",
                        finalize.path)
                    for (req in listOf(init, chunk, finalize)) {
                        assertEquals("Bearer owner-token", req.getHeader("Authorization"))
                        assertEquals(device.deviceId, req.getHeader("X-XDrive-Device-ID"))
                        assertEquals(device.deviceToken, req.getHeader("X-XDrive-Device-Token"))
                        assertFalse(req.path!!.contains(key))
                        assertFalse(req.path!!.contains(hash))
                    }
                    assertTrue(init.body.readUtf8().contains(key))
                    assertArrayEquals(original, chunk.body.readByteArray())
                    assertFalse(device.toString().contains(device.deviceToken))
                }
        }
    }

    @Test fun managedLostAckLookupIsReadOnlyAndTargetScoped(): Unit = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(uploadSession("finalized", true)))
            server.enqueue(MockResponse().setBody(uploadSession("active")))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), allowHttp = true))
                .use { api ->
                    val done = api.inspectManagedAndroidPhotoUpload(
                        "owner-token", device, destination, name, 6, hash, key)
                    assertEquals(120L, done?.parentId)
                    assertNull(api.inspectManagedAndroidPhotoUpload(
                        "owner-token", device, destination, name, 6, hash, key))
                    assertEquals(2, server.requestCount)
                    repeat(2) {
                        val read = server.takeRequest()
                        assertEquals("/api/v1/android/photos/managed/uploads/resume-lookup",
                            read.path)
                        assertEquals("POST", read.method)
                        assertEquals(device.deviceToken,
                            read.getHeader("X-XDrive-Device-Token"))
                        assertTrue(read.body.readUtf8().contains(key))
                    }
                }
        }
    }

    @Test fun forgedDestinationCannotStartAnyNetworkWrite(): Unit = runBlocking {
        MockWebServer().use { server ->
            XDriveApi(ServerAddress.parse(server.url("/").toString(), allowHttp = true))
                .use { api ->
                    val other = device.copy(deviceId = "00000000-0000-4000-8000-000000000189")
                    assertThrows(IllegalArgumentException::class.java) {
                        runBlocking { api.uploadManagedAndroidPhotoOriginal(
                            "owner-token", other, destination, name, 6, hash, key,
                            { ByteArrayInputStream(original) }) }
                    }
                    assertThrows(IllegalArgumentException::class.java) {
                        runBlocking { api.inspectManagedAndroidPhotoUpload(
                            "owner-token", device,
                            destination.copy(targetPath = "用户根目录/原件"),
                            name, 6, hash, key) }
                    }
                    assertEquals(0, server.requestCount)
                }
        }
    }
}
