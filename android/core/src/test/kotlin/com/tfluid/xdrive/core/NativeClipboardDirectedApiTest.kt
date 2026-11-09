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

    @Test fun revokedDeviceStopsDirectedSSEWithoutAStaleCallback() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(403).setBody(
                "{\"error\":\"Clipboard device revoked\"}"
            ))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                var delivered = 0
                try {
                    api.clipboardWatchForDevice("current-owner-bearer", device, 9) {
                        delivered++
                    }
                    fail("revoked device SSE must be rejected before callback")
                } catch (expected: ApiException) {
                    assertEquals(403, expected.statusCode)
                }
                assertEquals(0, delivered)
                val request = server.takeRequest()
                assertEquals("/api/v1/clipboard/events?after=9", request.path)
                assertEquals("Bearer current-owner-bearer", request.getHeader("Authorization"))
                assertEquals(device.deviceId, request.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, request.getHeader("X-XDrive-Device-Token"))
                assertNull(request.getHeader("Cookie"))
            }
        }
    }

    @Test fun ownerSwitchCannotReuseAnOldDeviceProofForDirectedReads() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(403).setBody(
                "{\"error\":\"cross Owner device denied\"}"
            ))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                try {
                    api.clipboardListForDevice("second-owner-bearer", device)
                    fail("cross-Owner device proof must not produce a readable inbox")
                } catch (expected: ApiException) {
                    assertEquals(403, expected.statusCode)
                }
                val request = server.takeRequest()
                assertEquals("/api/v1/clipboard/items", request.path)
                assertEquals("Bearer second-owner-bearer", request.getHeader("Authorization"))
                assertEquals(device.deviceId, request.getHeader("X-XDrive-Device-ID"))
                assertEquals(device.deviceToken, request.getHeader("X-XDrive-Device-Token"))
            }
        }
    }


    @Test fun ownerRecipientDirectoryIsPublicKeyOnlyAndHasNoInstallationCredential() = runBlocking {
        MockWebServer().use { server ->
            val key = XDriveClipboardTargetCrypto.newDeviceKey().publicKeyBase64
            val id = device.deviceId
            val wire = """{"devices":[{"device_id":"$id","name":"Verified phone","platform":"android","public_key":"$key"}]}"""
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(wire))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                val recipients = api.clipboardDevices("verified-owner-bearer")
                assertEquals(1, recipients.size)
                assertEquals(id, recipients[0].deviceID)
                assertEquals(key, recipients[0].publicKey)
                val sent = server.takeRequest()
                assertEquals("GET", sent.method)
                assertEquals("/api/v1/clipboard/devices", sent.path)
                assertEquals("Bearer verified-owner-bearer", sent.getHeader("Authorization"))
                assertNull(sent.getHeader("X-XDrive-Device-ID"))
                assertNull(sent.getHeader("X-XDrive-Device-Token"))
            }
        }
    }

    @Test fun directedCreateBindsNumericNodeKindTargetAndUnknownAckReceipt() = runBlocking {
        MockWebServer().use { server ->
            val event = UUID.randomUUID().toString()
            val target = device.deviceId
            val wire = XDriveClipboardTargetCrypto.Wire(
                event, target, "application/x-xdrive-node-ref",
                Base64.getEncoder().encodeToString(ByteArray(12) { 1 }),
                Base64.getEncoder().encodeToString(ByteArray(32) { 2 }),
                Base64.getEncoder().encodeToString(ByteArray(32) { 3 }),
                Base64.getEncoder().encodeToString(ByteArray(60) { 4 }), 118L,
            )
            val kind = wire.kind
            val nonce = wire.nonce
            val ciphertext = wire.ciphertext
            val ephemeral = wire.ephemeralKey
            val wrapped = wire.wrappedKey
            val response = """{"id":9,"client_event_id":"$event","kind":"$kind","nonce":"$nonce","ciphertext":"$ciphertext","target_device_id":"$target","ephemeral_key":"$ephemeral","wrapped_key":"$wrapped","node_id":118,"created_at":"2026-11-07T00:00:00Z","expires_at":"2026-11-08T00:00:00Z"}"""
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(response))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                assertEquals(118L, api.clipboardCreateDirected("verified-owner-bearer", wire).nodeID)
                val sent = server.takeRequest()
                assertEquals("POST", sent.method)
                assertEquals("/api/v1/clipboard/items", sent.path)
                assertEquals("Bearer verified-owner-bearer", sent.getHeader("Authorization"))
                assertNull(sent.getHeader("X-XDrive-Device-Token"))
                val json = sent.body.readUtf8()
                assertTrue(json.contains("\"node_id\":118"))
                assertFalse(json.contains("\"node_id\":\"118\""))
                assertTrue(json.contains(target))
                assertTrue(json.contains(wrapped))
            }
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
                .setBody(response.replace("\"node_id\":118", "\"node_id\":119")))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                try {
                    api.clipboardCreateDirected("verified-owner-bearer", wire)
                    fail("Mismatched CAS Node receipt must never be accepted as confirmed send")
                } catch (_: Exception) { }
                assertEquals(2, server.requestCount)
            }
        }
    }

}
