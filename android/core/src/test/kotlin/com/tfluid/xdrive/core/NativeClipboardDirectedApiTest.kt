package com.tfluid.xdrive.core

import java.util.Base64
import java.util.UUID
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Real OkHttp device credentials require the current interactive Owner bearer.
 * The X25519 public key is only a separately revocable Clipboard capability. */
class NativeClipboardDirectedApiTest {
    private val device = NativeAndroidDeviceEnrollment(
        deviceId = UUID.randomUUID().toString(), deviceToken = "A".repeat(43),
        displayName = "Android Test", clientVersion = "1.0",
    )

    @Test fun enrollmentRequiresOwnerAndDeviceCredentialTogether() = runBlocking {
        MockWebServer().use { server ->
            val publicKey = Base64.getEncoder().encodeToString(ByteArray(32) { 0x23 })
            val body = "{\"device_id\":\"" + device.deviceId +
                "\",\"public_key\":\"" + publicKey + "\"}"
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(body))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                api.clipboardEnrollRecipient("current-owner-bearer", device, publicKey)
                val request = server.takeRequest()
                assertEquals("PUT", request.method)
                assertEquals("/api/v1/clipboard/devices/self", request.path)
                assertEquals("Bearer current-owner-bearer", request.getHeader("Authorization"))
                assertEquals(device.deviceId, request.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, request.getHeader("X-XDrive-Device-Token"))
                assertTrue(request.body.readUtf8().contains(publicKey))
            }
        }
    }

    @Test fun directedMailboxUsesSeparateVerifiedDeviceIdentity() = runBlocking {
        MockWebServer().use { server ->
            val event = UUID.randomUUID().toString()
            val nonce = Base64.getEncoder().encodeToString(ByteArray(12))
            val cipher = Base64.getEncoder().encodeToString(ByteArray(24) { 1 })
            val ephemeral = Base64.getEncoder().encodeToString(ByteArray(32) { 2 })
            val wrapped = Base64.getEncoder().encodeToString(ByteArray(60) { 3 })
            val body = "{\"items\":[{\"id\":5,\"client_event_id\":\"" + event +
                "\",\"kind\":\"application/x-xdrive-node-ref\",\"nonce\":\"" + nonce +
                "\",\"ciphertext\":\"" + cipher + "\",\"target_device_id\":\"" + device.deviceId +
                "\",\"ephemeral_key\":\"" + ephemeral + "\",\"wrapped_key\":\"" + wrapped +
                "\",\"node_id\":118,\"created_at\":\"2026-11-07T00:00:00Z\"," +
                "\"expires_at\":\"2026-11-08T00:00:00Z\"}],\"next_before\":null}"
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(body))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                val page = api.clipboardListForDevice("current-owner-bearer", device)
                assertEquals(1, page.items.size)
                assertEquals(device.deviceId, page.items[0].targetDeviceID)
                assertEquals(118L, page.items[0].nodeID)
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/v1/clipboard/items", request.path)
                assertEquals("Bearer current-owner-bearer", request.getHeader("Authorization"))
                assertEquals(device.deviceId, request.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, request.getHeader("X-XDrive-Device-Token"))
            }
        }
    }

    @Test fun directedSSETransportsOnlyInvalidations() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("event: sync\ndata: {}\n\nid: 4\nevent: change\ndata: {}\n\n"))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                var received = 0
                val cursor = api.clipboardWatchForDevice("current-owner-bearer", device, 3) {
                    received++
                }
                assertEquals(4L, cursor)
                assertEquals(2, received)
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/v1/clipboard/events?after=3", request.path)
                assertEquals(device.deviceId, request.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, request.getHeader("X-XDrive-Device-Token"))
            }
        }
    }
}
