package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** Foreground one-shot is Owner checked and cannot replay a lost final ACK. */
class NativePhotoOneShotUploaderTest {
    private val root = DriveNode(42, null, "", "dir", revision = 4)
    private val owner = NativePhotoBackupScope(
        origin = ServerAddress.parse("https://drive.example").url,
        serverInstanceId = "server-one", ownerId = 13, username = "owner",
        rootId = 42, rootRevision = 4,
    )
    private val source = byteArrayOf(1, 2, 3, 4, 5)
    private val ack = DriveNode(57, 42, "original.jpg", "file", size = 5, revision = 1)

    private class Fake(val expected: ByteArray, var receipt: DriveNode) : XDriveService {
        var uploads = 0
        var loseAck = false
        override suspend fun login(username: String, password: String): AuthSession =
            error("not used")
        override suspend fun refresh(refreshToken: String): AuthSession =
            error("not used")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String
        ): AuthSession = error("not used")
        override suspend fun root(accessToken: String): DriveNode = error("not used")
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange =
            error("not used")
        override suspend fun uploadFile(
            accessToken: String, parent: DriveNode, name: String, size: Long,
            openSource: () -> InputStream, onProgress: (Long) -> Unit,
        ): DriveNode {
            uploads++
            assertEquals("owner-token", accessToken)
            assertEquals(42L, parent.id)
            assertEquals("original.jpg", name)
            assertEquals(expected.size.toLong(), size)
            openSource().use { assertArrayEquals(expected, it.readBytes()) }
            onProgress(size)
            if (loseAck) throw IOException("lost finalize response")
            return receipt
        }
    }

    @Test fun exactOwnerRootAndOriginalUseOneRealUploader(): Unit = runBlocking {
        val privateRoot = Files.createTempDirectory("oneshot-source-").toFile()
        try {
            NativePhotoOriginalStager.stage(privateRoot, source.size.toLong()) {
                ByteArrayInputStream(source)
            }.use { original ->
                val service = Fake(source, ack)
                val progress = mutableListOf<Long>()
                val result = NativePhotoOneShotUploader.upload(
                    service, "owner-token", owner, root, "original.jpg",
                    original, { true }, progress::add)
                assertEquals(ack, result)
                assertEquals(1, service.uploads)
                assertEquals(listOf(5L), progress)
            }
        } finally { privateRoot.deleteRecursively() }
    }

    @Test fun wrongRootOrStaleOwnerCannotStartUploadSession(): Unit = runBlocking {
        val privateRoot = Files.createTempDirectory("oneshot-block-").toFile()
        try {
            NativePhotoOriginalStager.stage(privateRoot, source.size.toLong()) {
                ByteArrayInputStream(source)
            }.use { original ->
                val service = Fake(source, ack)
                assertThrows(IllegalStateException::class.java) {
                    runBlocking {
                        NativePhotoOneShotUploader.upload(service, "owner-token",
                            owner, root.copy(revision = 9), "original.jpg", original, { true })
                    }
                }
                assertThrows(IllegalStateException::class.java) {
                    runBlocking {
                        NativePhotoOneShotUploader.upload(service, "owner-token",
                            owner, root, "original.jpg", original, { false })
                    }
                }
                assertEquals(0, service.uploads)
            }
        } finally { privateRoot.deleteRecursively() }
    }

    @Test fun tamperedOriginalAndForgedReceiptCannotBeSuccess(): Unit = runBlocking {
        val privateRoot = Files.createTempDirectory("oneshot-tamper-").toFile()
        try {
            NativePhotoOriginalStager.stage(privateRoot, source.size.toLong()) {
                ByteArrayInputStream(source)
            }.use { original ->
                val service = Fake(source, ack)
                java.io.File(privateRoot, "photo-original-stage")
                    .listFiles()!!.single().appendBytes(byteArrayOf(7))
                assertThrows(IllegalStateException::class.java) {
                    runBlocking {
                        NativePhotoOneShotUploader.upload(service, "owner-token",
                            owner, root, "original.jpg", original, { true })
                    }
                }
                assertEquals(0, service.uploads)
            }
            NativePhotoOriginalStager.stage(privateRoot, source.size.toLong()) {
                ByteArrayInputStream(source)
            }.use { original ->
                val service = Fake(source, ack.copy(parentId = 99))
                assertThrows(IllegalStateException::class.java) {
                    runBlocking {
                        NativePhotoOneShotUploader.upload(service, "owner-token",
                            owner, root, "original.jpg", original, { true })
                    }
                }
                assertEquals(1, service.uploads)
            }
        } finally { privateRoot.deleteRecursively() }
    }

    @Test fun uncertainAckNeverTriggersAutomaticReplay(): Unit = runBlocking {
        val privateRoot = Files.createTempDirectory("oneshot-uncertain-").toFile()
        try {
            NativePhotoOriginalStager.stage(privateRoot, source.size.toLong()) {
                ByteArrayInputStream(source)
            }.use { original ->
                val service = Fake(source, ack).apply { loseAck = true }
                assertThrows(IOException::class.java) {
                    runBlocking {
                        NativePhotoOneShotUploader.upload(service, "owner-token",
                            owner, root, "original.jpg", original, { true })
                    }
                }
                assertEquals(1, service.uploads)
            }
        } finally { privateRoot.deleteRecursively() }
    }
}
