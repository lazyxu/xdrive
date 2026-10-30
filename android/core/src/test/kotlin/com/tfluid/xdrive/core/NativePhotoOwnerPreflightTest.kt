package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class NativePhotoOwnerPreflightTest {
    private val origin = ServerAddress.parse("https://drive.example").url
    private val owner = NativeServerOwnerIdentity(13, "owner", "user", "installation-one")
    private val root = DriveNode(42, null, "", "dir", revision = 4)

    private class Fake(
        var identity: NativeServerOwnerIdentity,
        var rootNode: DriveNode,
        val onIdentityRead: () -> Unit = {},
    ) : XDriveService {
        var identityCalls = 0
        var rootCalls = 0
        override suspend fun login(username: String, password: String): AuthSession = error("not used")
        override suspend fun refresh(refreshToken: String): AuthSession = error("not used")
        override suspend fun logout(refreshToken: String) = error("not used")
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String
        ): AuthSession = error("not used")
        override suspend fun verifiedOwnerIdentity(accessToken: String): NativeServerOwnerIdentity {
            identityCalls++
            check(accessToken == "owner-bearer")
            onIdentityRead()
            return identity
        }
        override suspend fun root(accessToken: String): DriveNode {
            rootCalls++
            check(accessToken == "owner-bearer")
            return rootNode
        }
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange =
            error("not used")
    }

    @Test fun twoExactOwnerGetsAndNoAdminElevation(): Unit = runBlocking {
        val service = Fake(owner, root)
        val proof = NativePhotoOwnerPreflight.verify(
            service, origin, "owner-bearer", "owner", { true })
        assertEquals("installation-one", proof.serverInstanceId)
        assertEquals(13L, proof.ownerId)
        assertEquals(42L, proof.rootId)
        assertEquals(4L, proof.rootRevision)
        assertEquals(1, service.identityCalls)
        assertEquals(1, service.rootCalls)
        assertFalse(proof.toString().contains("drive.example"))
        assertFalse(proof.toString().contains("installation-one"))
    }

    @Test fun logoutOrOwnerAbaFencesBeforeRoot(): Unit = runBlocking {
        var generation = 7
        val service = Fake(owner, root) { generation = 9 }
        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                NativePhotoOwnerPreflight.verify(
                    service, origin, "owner-bearer", "owner",
                    { generation == 7 })
            }
        }
        assertEquals(1, service.identityCalls)
        assertEquals(0, service.rootCalls)
    }

    @Test fun rejectsIncorrectOwnerOrRootAndCleartext(): Unit = runBlocking {
        val badOwner = Fake(owner.copy(username = "other"), root)
        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                NativePhotoOwnerPreflight.verify(
                    badOwner, origin, "owner-bearer", "owner", { true })
            }
        }
        assertEquals(0, badOwner.rootCalls)
        for (node in listOf(root.copy(revision = 0), root.copy(parentId = 1),
            root.copy(type = "file"))) {
            assertThrows(IllegalStateException::class.java) {
                kotlinx.coroutines.runBlocking {
                    NativePhotoOwnerPreflight.verify(
                        Fake(owner, node), origin, "owner-bearer", "owner", { true })
                }
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                NativePhotoOwnerPreflight.verify(
                    Fake(owner, root), "http://drive.example/",
                    "owner-bearer", "owner", { true })
            }
        }
    }

    @Test fun realOwnerHttpGetRequiresExactServerInstallationIdAndExplicitRole(): Unit = runBlocking {
        MockWebServer().use { server ->
            val address = ServerAddress.parse(server.url("/").toString(), allowHttp = true)
            XDriveApi(address).use { api ->
                server.enqueue(MockResponse().setBody(
                    """{"id":13,"username":"owner","role":"user",
                       "must_change_password":false,
                       "pwa_offline_instance_id":"installation-one"}"""))
                assertEquals(owner, api.verifiedOwnerIdentity("owner-bearer"))
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/v1/me", request.path)
                assertEquals("Bearer owner-bearer", request.getHeader("Authorization"))

                val invalid = listOf(
                    """{"id":13,"username":"owner","role":"user","must_change_password":false}""",
                    """{"id":13,"username":"owner","role":"superuser",
                       "must_change_password":false,"pwa_offline_instance_id":"one"}""",
                    """{"id":13,"username":"owner","role":"user",
                       "must_change_password":true,"pwa_offline_instance_id":"one"}""",
                    """{"id":0,"username":"owner","role":"user",
                       "must_change_password":false,"pwa_offline_instance_id":"one"}""",
                )
                invalid.forEach { payload ->
                    server.enqueue(MockResponse().setBody(payload))
                    assertThrows(ApiException::class.java) {
                        kotlinx.coroutines.runBlocking { api.verifiedOwnerIdentity("owner-bearer") }
                    }
                    server.takeRequest()
                }
            }
        }
    }
}
