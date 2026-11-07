package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Exact Go Android managed Source/Target contract, not a simulated upload grant. */
class NativePhotoManagedDestinationTest {
    private val device = NativeAndroidDeviceEnrollment(
        "00000000-0000-4000-8000-000000000111", "A".repeat(43), "Pixel", "0.1")
    private val endpoint = "/api/v1/android/photos/backup-destination"
    private val unconfigured = """{"configured":false,"device_id":"00000000-0000-4000-8000-000000000111","suggested_name":"Pixel"}"""
    private val configured = """{"configured":true,"device_id":"00000000-0000-4000-8000-000000000111","source_id":19,"source_revision":2,"name":"Android 相册","target_node_id":120,"target_path":"同步文件夹/Push/Pixel_00000000-0000-4000-8000-000000000111/Android 相册"}"""

    @Test fun currentDeviceOnlyCanReadAndExplicitlyConfigure(): Unit = runBlocking {
        MockWebServer().use { server ->
            val address = ServerAddress.parse(server.url("/").toString(), allowHttp = true)
            XDriveApi(address).use { api ->
                server.enqueue(MockResponse().setBody(unconfigured))
                val suggested = api.nativeAndroidPhotoDestination("owner-token", device)
                assertFalse(suggested.configured)
                assertEquals("Pixel", suggested.suggestedName)
                assertEquals(device.deviceId, suggested.deviceId)
                val get = server.takeRequest()
                assertEquals("GET", get.method)
                assertEquals(endpoint, get.path)
                assertEquals("Bearer owner-token", get.getHeader("Authorization"))
                assertEquals(device.deviceId, get.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, get.getHeader("X-XDrive-Device-Token"))
                assertEquals(0L, get.body.size)

                server.enqueue(MockResponse().setResponseCode(201).setBody(configured))
                val added = api.configureNativeAndroidPhotoDestination(
                    "owner-token", device, "Android 相册")
                assertTrue(added.configured)
                assertEquals(19L, added.sourceId)
                assertEquals(2L, added.sourceRevision)
                assertEquals(120L, added.targetNodeId)
                assertEquals("同步文件夹/Push/Pixel_00000000-0000-4000-8000-000000000111/Android 相册", added.targetPath)
                val put = server.takeRequest()
                assertEquals("PUT", put.method)
                assertEquals(endpoint, put.path)
                assertEquals(device.deviceToken, put.getHeader("X-XDrive-Device-Token"))
                assertEquals("""{"name":"Android 相册"}""", put.body.readUtf8())

                server.enqueue(MockResponse().setBody(configured))
                assertEquals(19L, api.nativeAndroidPhotoDestination(
                    "owner-token", device).sourceId)
                server.takeRequest()
                assertEquals(3, server.requestCount)
                assertFalse(added.toString().contains(device.deviceToken))
            }
        }
    }

    @Test fun failedOrForgedResponseCannotAuthorizeAnotherOwnerOrRoot(): Unit = runBlocking {
        val invalid = listOf(
            unconfigured.replace(device.deviceId, "00000000-0000-4000-8000-000000000112"),
            configured.replace("同步文件夹/Push/Pixel_00000000-0000-4000-8000-000000000111/Android 相册", "用户根目录/Android 相册"),
            configured.replace("120", "0"),
            configured.replace("19", "0"),
            configured.replace("true", "false"),
            configured.dropLast(1) + ""","source_device_id":"other"}""",
            """{"configured":true,"device_id":"00000000-0000-4000-8000-000000000111"}""",
        )
        MockWebServer().use { server ->
            val address = ServerAddress.parse(server.url("/").toString(), allowHttp = true)
            XDriveApi(address).use { api ->
                for (payload in invalid) {
                    server.enqueue(MockResponse().setBody(payload))
                    assertThrows(ApiException::class.java) {
                        runBlocking { api.nativeAndroidPhotoDestination("owner-token", device) }
                    }
                    server.takeRequest()
                }
                server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"revoked"}"""))
                assertThrows(ApiException::class.java) {
                    runBlocking { api.nativeAndroidPhotoDestination("owner-token", device) }
                }
                server.takeRequest()
                val before = server.requestCount
                for (bad in listOf("", "a/b", " CON ", ".", "bad\\folder")) {
                    assertThrows(IllegalArgumentException::class.java) {
                        runBlocking { api.configureNativeAndroidPhotoDestination("owner-token", device, bad) }
                    }
                }
                assertEquals(before, server.requestCount)
            }
        }
    }
}
