package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class NativePhotoDeviceEnrollmentTest {
    private val origin = ServerAddress.parse("https://drive.example").url
    private val root = DriveNode(42, null, "", "dir", revision = 3)
    private val identity = NativeServerOwnerIdentity(51, "owner", "user", "instance-1")
    private val uuid = "00000000-0000-4000-8000-000000000111"
    private val secret = "A".repeat(43)

    private class Fake(
        var owner: NativeServerOwnerIdentity,
        var rootNode: DriveNode,
        val onRegistration: () -> Unit = {},
    ) : XDriveService {
        var requests = 0
        override suspend fun login(username: String, password: String): AuthSession = error("unused")
        override suspend fun refresh(refreshToken: String): AuthSession = error("unused")
        override suspend fun logout(refreshToken: String): Unit = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String
        ): AuthSession = error("unused")
        override suspend fun verifiedOwnerIdentity(accessToken: String): NativeServerOwnerIdentity {
            check(accessToken == "owner-token")
            return owner
        }
        override suspend fun root(accessToken: String): DriveNode {
            check(accessToken == "owner-token")
            return rootNode
        }
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange =
            error("unused")
        override suspend fun registerNativeAndroidDevice(
            accessToken: String, displayName: String, clientVersion: String,
        ): NativeAndroidDeviceEnrollment {
            requests++
            assertEquals("owner-token", accessToken)
            assertEquals("Android Photos", displayName)
            assertEquals("0.1", clientVersion)
            onRegistration()
            return NativeAndroidDeviceEnrollment(
                "00000000-0000-4000-8000-000000000111",
                "A".repeat(43), displayName, clientVersion)
        }
    }

    @Test fun readOnlyDeviceSelfRequiresCurrentBearerAndValidExactAck(): Unit = runBlocking {
        MockWebServer().use { server ->
            val address = ServerAddress.parse(server.url("/").toString(), allowHttp = true)
            XDriveApi(address).use { api ->
                val enrolled = NativeAndroidDeviceEnrollment(uuid, secret, "Android Photos", "0.1")
                server.enqueue(MockResponse().setBody(
                    """{"device_id":"00000000-0000-4000-8000-000000000111"}"""))
                api.verifyNativeAndroidDevice("owner-token", enrolled)
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/v1/devices/self", request.path)
                assertEquals("Bearer owner-token", request.getHeader("Authorization"))
                assertEquals(uuid, request.getHeader("X-XDrive-Device-ID"))
                assertEquals(secret, request.getHeader("X-XDrive-Device-Token"))
                assertFalse(request.path!!.contains(secret))
                assertEquals(0L, request.body.size)
                val invalid = listOf(
                    """{"device_id":"00000000-0000-4000-8000-000000000112"}""",
                    """{"device_id":""}""",
                    """{"device_id":"00000000-0000-4000-8000-000000000111","extra":"spoof"}""",
                )
                for (payload in invalid) {
                    server.enqueue(MockResponse().setBody(payload))
                    assertThrows(ApiException::class.java) {
                        runBlocking { api.verifyNativeAndroidDevice("owner-token", enrolled) }
                    }
                    server.takeRequest()
                }
                server.enqueue(MockResponse().setResponseCode(403).setBody(
                    """{"error":"revoked"}"""))
                assertThrows(ApiException::class.java) {
                    runBlocking { api.verifyNativeAndroidDevice("owner-token", enrolled) }
                }
                server.takeRequest()
                assertEquals(5, server.requestCount)
            }
        }
    }

    @Test fun exactVerifiedOwnerRegistersOnlyOnce(): Unit = runBlocking {
        val service = Fake(identity, root)
        val proof = NativePhotoDeviceEnrollment.register(
            service, origin, "owner-token", "owner",
            "Android Photos", "0.1", { true })
        assertEquals(51L, proof.first.ownerId)
        assertEquals(uuid, proof.second.deviceId)
        assertEquals(1, service.requests)
        assertFalse(proof.second.toString().contains(secret))
    }

    @Test fun ownerOrRootChangeBlocksPostAndLateSessionChangeDropsReceipt(): Unit = runBlocking {
        val mismatched = Fake(identity.copy(username = "foreign"), root)
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                NativePhotoDeviceEnrollment.register(mismatched, origin,
                    "owner-token", "owner", "Android Photos", "0.1", { true })
            }
        }
        assertEquals(0, mismatched.requests)
        val noRoot = Fake(identity, root.copy(revision = 0))
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                NativePhotoDeviceEnrollment.register(noRoot, origin,
                    "owner-token", "owner", "Android Photos", "0.1", { true })
            }
        }
        assertEquals(0, noRoot.requests)
        var active = true
        val late = Fake(identity, root) { active = false }
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                NativePhotoDeviceEnrollment.register(late, origin,
                    "owner-token", "owner", "Android Photos", "0.1", { active })
            }
        }
        assertEquals(1, late.requests) // POST could already have happened; never replay.
    }

    @Test fun realHttpPostAcceptsOnlyExactAndroidDeviceAck(): Unit = runBlocking {
        MockWebServer().use { server ->
            val address = ServerAddress.parse(server.url("/").toString(), allowHttp = true)
            XDriveApi(address).use { api ->
                val valid =
                    """{"device":{"id":"00000000-0000-4000-8000-000000000111",
                        "name":"Android Photos","platform":"android",
                        "client_version":"0.1"},
                        "device_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"""
                server.enqueue(MockResponse().setResponseCode(201).setBody(valid))
                val device = api.registerNativeAndroidDevice(
                    "owner-token", "Android Photos", "0.1")
                assertEquals(uuid, device.deviceId)
                val sent = server.takeRequest()
                assertEquals("POST", sent.method)
                assertEquals("/api/v1/devices", sent.path)
                assertEquals("Bearer owner-token", sent.getHeader("Authorization"))
                assertTrue(sent.body.readUtf8().contains("\"platform\":\"android\""))
                val invalid = listOf(
                    valid.replace("\"platform\":\"android\"", "\"platform\":\"darwin\""),
                    valid.replace("\"device_token\":\"$secret\"", "\"device_token\":\"short\""),
                    valid.replace("\"name\":\"Android Photos\"", "\"name\":\"foreign\""),
                    valid.replace("\"client_version\":\"0.1\"", "\"client_version\":\"9\""),
                    valid.replace(uuid, "not-a-uuid"),
                )
                invalid.forEach { body ->
                    server.enqueue(MockResponse().setResponseCode(201).setBody(body))
                    assertThrows(ApiException::class.java) {
                        runBlocking {
                            api.registerNativeAndroidDevice("owner-token", "Android Photos", "0.1")
                        }
                    }
                    server.takeRequest()
                }
                assertEquals(6, server.requestCount)
            }
        }
    }
}
