package com.tfluid.xdrive

import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * A private immutable source snapshot is needed because MediaStore providers
 * may change or revoke an original between inventory, hashing and upload.
 * The only future writer is the existing Owner-authenticated UploadSession.
 */
internal class NativePhotoStagedOriginal internal constructor(
    private val temporary: File,
    val bytes: Long,
    val sha256: String,
) : Closeable {
    private var closed = false

    @Synchronized
    fun openVerifiedSource(): InputStream {
        check(!closed) { "Photo source already discarded" }
        check(temporary.isFile && temporary.length() == bytes) {
            "Photo source changed after staging"
        }
        return FileInputStream(temporary)
    }

    /** Re-hash the staged file immediately before a new UploadSession attempt. */
    suspend fun verifyBeforeWrite(): Boolean = withContext(Dispatchers.IO) {
        check(!closed)
        if (!temporary.isFile || temporary.length() != bytes) return@withContext false
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(temporary).use { input ->
            val buffer = ByteArray(64 * 1024)
            var readTotal = 0L
            while (true) {
                currentCoroutineContext().ensureActive()
                val n = input.read(buffer)
                if (n < 0) break
                check(n > 0)
                readTotal += n
                if (readTotal > bytes) return@withContext false
                digest.update(buffer, 0, n)
            }
            readTotal == bytes && hexDigest(digest.digest()) == sha256
        }
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        if (temporary.exists() && !temporary.delete()) {
            throw IOException("Unable to discard private photo staging file")
        }
    }

    override fun toString(): String = "NativePhotoStagedOriginal([redacted])"
}

private fun hexDigest(data: ByteArray): String {
    val out = StringBuilder(data.size * 2)
    for (byte in data) {
        val unsigned = byte.toInt() and 0xff
        out.append("0123456789abcdef"[unsigned ushr 4])
        out.append("0123456789abcdef"[unsigned and 0xf])
    }
    return out.toString()
}

/** Disposable foreground staging, not a persistent queue or a second uploader. */
internal object NativePhotoOriginalStager {
    const val MAX_ORIGINAL_BYTES = 8L * 1024 * 1024 * 1024
    private const val RESERVE_BYTES = 32L * 1024 * 1024

    suspend fun stage(
        privateRoot: File,
        expectedBytes: Long,
        openOriginal: () -> InputStream,
    ): NativePhotoStagedOriginal = withContext(Dispatchers.IO) {
        require(expectedBytes in 1..MAX_ORIGINAL_BYTES) {
            "Original outside current bounded native photo MVP"
        }
        val root = privateRoot.canonicalFile
        check(root.isDirectory && !java.nio.file.Files.isSymbolicLink(root.toPath())) {
            "Private stage root unavailable"
        }
        check(root.usableSpace >= expectedBytes + RESERVE_BYTES) {
            "Insufficient private staging capacity"
        }
        val destination = File(root, "photo-original-stage")
        check((destination.exists() || destination.mkdir()) &&
            destination.isDirectory &&
            destination.canonicalFile.parentFile == root &&
            !java.nio.file.Files.isSymbolicLink(destination.toPath())) {
            "Private staging directory unavailable"
        }
        // Random per-operation name. Never persist a MediaStore ID/URI/name.
        val temporary = File.createTempFile("original-", ".part", destination)
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            var count = 0L
            openOriginal().use { source ->
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (count < expectedBytes) {
                        currentCoroutineContext().ensureActive()
                        val next = minOf(buffer.size.toLong(), expectedBytes - count).toInt()
                        val n = source.read(buffer, 0, next)
                        if (n < 0) throw IOException("Original truncated during private staging")
                        if (n == 0) throw IOException("Unresponsive original source")
                        output.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                        count += n
                    }
                    // Disallow inaccurate declared sizes and changing providers.
                    if (source.read() != -1) throw IOException("Original grew during private staging")
                    output.fd.sync()
                }
            }
            NativePhotoStagedOriginal(temporary, count, hexDigest(digest.digest()))
        } catch (failure: Throwable) {
            if (temporary.exists()) temporary.delete()
            throw failure
        }
    }
}
