package com.tfluid.xdrive.core

import java.util.UUID
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Real Owner + device-gated HTTP clipboard, without E2EE or vault. */
class NativeClipboardDirectedApiTest {
    private val device = NativeAndroidDeviceEnrollment(
        deviceId = UUID.randomUUID().toString(), deviceToken = "A".repeat(43),
        displayName = "Android Test", clientVersion = "1.0",
    )

    @Test fun enrollmentRequiresOwnerAndDeviceCredentials() = runBlocking {
        MockWebServer().use { server ->
            val response = "{\"device_id\":\"" + device.deviceId + "\"}"
            server.enqueue(MockResponse().setHeader("Content-Type","application/json")
                .setBody(response))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                api.clipboardEnrollRecipient("current-owner-bearer", device)
                val req = server.takeRequest()
                assertEquals("PUT", req.method)
                assertEquals("/api/v1/clipboard/devices/self", req.path)
                assertEquals("Bearer current-owner-bearer", req.getHeader("Authorization"))
                assertEquals(device.deviceId, req.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, req.getHeader("X-XDrive-Device-Token"))
                assertEquals("{}", req.body.readUtf8())
            }
        }
    }

    @Test fun directedPlaintextMailboxRequiresSeparateInstallationProof() = runBlocking {
        MockWebServer().use { server ->
            val event = UUID.randomUUID().toString()
            val body = """{"items":[{"id":5,"client_event_id":"$event",
                "kind":"application/x-xdrive-node-ref","content":"asset:118",
                "target_device_id":"${device.deviceId}","node_id":118,
                "created_at":"2026-11-07T00:00:00Z",
                "expires_at":"2026-11-08T00:00:00Z"}],"next_before":null}"""
            server.enqueue(MockResponse().setHeader("Content-Type","application/json")
                .setBody(body))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                val page = api.clipboardListForDevice("current-owner-bearer", device)
                assertEquals(1, page.items.size)
                assertEquals(device.deviceId, page.items[0].targetDeviceID)
                assertEquals(118L, page.items[0].nodeID)
                assertEquals("asset:118", page.items[0].content)
                val req = server.takeRequest()
                assertEquals("GET", req.method)
                assertEquals("/api/v1/clipboard/items", req.path)
                assertEquals("Bearer current-owner-bearer", req.getHeader("Authorization"))
                assertEquals(device.deviceId, req.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, req.getHeader("X-XDrive-Device-Token"))
            }
        }
    }

    @Test fun plaintextCreateBindsExactContentTargetNodeAndEventID() = runBlocking {
        MockWebServer().use { server ->
            val item = XDriveClipboardWrite(UUID.randomUUID().toString(),
                "image/x-xdrive-node-ref", "asset:118", device.deviceId, 118L)
            assertTrue(item.valid())
            val receipt = """{"id":9,"client_event_id":"${item.clientEventID}",
                "kind":"${item.kind}","content":"${item.content}",
                "target_device_id":"${device.deviceId}","node_id":118,
                "created_at":"2026-11-07T00:00:00Z",
                "expires_at":"2026-11-08T00:00:00Z"}"""
            server.enqueue(MockResponse().setHeader("Content-Type","application/json")
                .setBody(receipt))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                val result = api.clipboardCreate("current-owner-bearer", item)
                assertEquals(9L, result.id)
                assertEquals(item.content, result.content)
                val req = server.takeRequest()
                assertEquals("POST", req.method)
                assertEquals("/api/v1/clipboard/items", req.path)
                assertEquals("Bearer current-owner-bearer", req.getHeader("Authorization"))
                assertNull(req.getHeader("X-XDrive-Device-Token"))
                val raw = req.body.readUtf8()
                assertTrue(raw.contains("\"content\":\"asset:118\""))
                assertTrue(raw.contains("\"node_id\":118"))
                assertTrue(raw.contains(device.deviceId))
                assertFalse(raw.contains("nonce"))
                assertFalse(raw.contains("ciphertext"))
                assertFalse(raw.contains("wrapped_key"))
            }
        }
    }

    @Test fun invalidFileReferenceOrOverlongContentIsNeverValid() {
        val event = UUID.randomUUID().toString()
        assertFalse(XDriveClipboardWrite(event, "image/x-xdrive-node-ref",
            "asset:119", device.deviceId, 118L).valid())
        assertFalse(XDriveClipboardWrite(event, "image/x-xdrive-node-ref",
            "asset:118", null, 118L).valid())
        assertFalse(XDriveClipboardWrite(event, "text/plain", "x".repeat(65537)).valid())
        assertFalse(XDriveClipboardWrite(event, "text/plain", "").valid())
        assertTrue(XDriveClipboardWrite(event, "text/plain", "你好 Clipboard").valid())
    }

    @Test fun targetedSSEOnlyInvalidatesAndRevocationFailsClosed() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setBody("event: sync\ndata: {}\n\nid: 4\nevent: change\ndata: {}\n\n"))
            server.enqueue(MockResponse().setResponseCode(403)
                .setBody("{\"error\":\"device revoked\"}"))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                var notifications = 0
                val cursor = api.clipboardWatchForDevice("current-owner-bearer", device, 3) {
                    notifications++
                }
                assertEquals(4L, cursor)
                assertEquals(2, notifications)
                val req = server.takeRequest()
                assertEquals("/api/v1/clipboard/events?after=3", req.path)
                assertEquals(device.deviceToken, req.getHeader("X-XDrive-Device-Token"))
                try {
                    api.clipboardWatchForDevice("current-owner-bearer", device, 4) {
                        notifications++
                    }
                    fail("revoked recipient must fail closed")
                } catch (expected: ApiException) {
                    assertEquals(403, expected.statusCode)
                }
                assertEquals(2, notifications)
            }
        }
    }
}
