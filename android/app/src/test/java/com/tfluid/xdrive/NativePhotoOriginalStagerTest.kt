package com.tfluid.xdrive

import java.io.ByteArrayInputStream
import java.io.IOException
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class NativePhotoOriginalStagerTest {
    private fun root() = Files.createTempDirectory("native-photo-source-test-").toFile()

    private fun expectedHash(data: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { byte ->
            "%02x".format(byte.toInt() and 0xff)
        }

    @Test fun exactOriginalIsStreamedHashedReopenedAndDiscarded(): Unit = runBlocking {
        val privateRoot = root()
        try {
            val original = ByteArray(128 * 1024 + 17) { (it % 251).toByte() }
            NativePhotoOriginalStager.stage(privateRoot, original.size.toLong()) {
                ByteArrayInputStream(original)
            }.use { staged ->
                assertEquals(original.size.toLong(), staged.bytes)
                assertEquals(expectedHash(original), staged.sha256)
                assertTrue(staged.verifyBeforeWrite())
                staged.openVerifiedSource().use { input ->
                    assertArrayEquals(original, input.readBytes())
                }
                assertFalse(staged.toString().contains(staged.sha256))
            }
            assertTrue(java.io.File(privateRoot, "photo-original-stage")
                .listFiles().orEmpty().isEmpty())
        } finally { privateRoot.deleteRecursively() }
    }

    @Test fun truncationOrExcessBytesNeverLeavesStagingFiles(): Unit = runBlocking {
        val privateRoot = root()
        try {
            for ((bytes, declared) in listOf(
                3 to 5L, 7 to 5L,
            )) {
                try {
                    NativePhotoOriginalStager.stage(privateRoot, declared) {
                        ByteArrayInputStream(ByteArray(bytes) { 0x33 })
                    }
                    fail("Changed source $bytes/$declared was accepted")
                } catch (_: IOException) {}
            }
            assertTrue(java.io.File(privateRoot, "photo-original-stage")
                .listFiles().orEmpty().isEmpty())
        } finally { privateRoot.deleteRecursively() }
    }

    @Test fun revokedSourceAndPrivateStageTamperFailClosed(): Unit = runBlocking {
        val privateRoot = root()
        try {
            try {
                NativePhotoOriginalStager.stage(privateRoot, 1024) {
                    throw SecurityException("revoked grant")
                }
                fail("Revoked MediaStore grant was treated as success")
            } catch (_: SecurityException) {}
            assertTrue(java.io.File(privateRoot, "photo-original-stage")
                .listFiles().orEmpty().isEmpty())
            NativePhotoOriginalStager.stage(privateRoot, 4) {
                ByteArrayInputStream(byteArrayOf(1, 2, 3, 4))
            }.use { staged ->
                val temporary = java.io.File(privateRoot, "photo-original-stage")
                    .listFiles()!!.single()
                temporary.appendBytes(byteArrayOf(5))
                assertFalse(staged.verifyBeforeWrite())
                assertThrows(IllegalStateException::class.java) {
                    staged.openVerifiedSource()
                }
            }
        } finally { privateRoot.deleteRecursively() }
    }

    @Test fun oversizedOrZeroLengthIsDeniedBeforeOpeningMedia(): Unit = runBlocking {
        val privateRoot = root()
        var opens = 0
        try {
            for (badSize in listOf(0L, NativePhotoOriginalStager.MAX_ORIGINAL_BYTES + 1)) {
                assertThrows(IllegalArgumentException::class.java) {
                    kotlinx.coroutines.runBlocking {
                        NativePhotoOriginalStager.stage(privateRoot, badSize) {
                            opens++
                            ByteArrayInputStream(byteArrayOf(1))
                        }
                    }
                }
            }
            assertEquals(0, opens)
        } finally { privateRoot.deleteRecursively() }
    }
}
