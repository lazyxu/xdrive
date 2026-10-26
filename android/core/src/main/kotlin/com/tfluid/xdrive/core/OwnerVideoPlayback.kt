package com.tfluid.xdrive.core

import java.io.Closeable
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.HttpUrl
import okhttp3.OkHttpClient

/** Per-Viewer opaque transport. The URL never contains a credential. */
class OwnerVideoPlayback(
    val url: String,
    val client: OkHttpClient,
    val size: Long,
    private val release: () -> Unit = {},
) : Closeable {
    private val closed = AtomicBoolean(false)
    override fun close() {
        if (closed.compareAndSet(false, true)) release()
    }
}

private val requestedBytes = Regex("""^bytes=(\d+)-(\d*)$""")
private val responseBytes = Regex("""^bytes (\d+)-(\d+)/(\d+)$""")

/** Wrap the XDriveApi route-pinned client, never the system/default HTTP stack.
 * Its scoped interceptor rejects any origin/path change before adding Bearer.
 * Every media seek validates Owner revision and the exact Server Range. */
internal fun ownerVideoPlayback(
    pinnedClient: OkHttpClient, url: HttpUrl, token: String, node: DriveNode,
): OwnerVideoPlayback {
    val size = node.size
    val etag = "\"" + node.revision + "\""
    val client = pinnedClient.newBuilder()
        .dispatcher(Dispatcher())
        .connectionPool(ConnectionPool())
        .cache(null)
        .retryOnConnectionFailure(false)
        .followRedirects(false).followSslRedirects(false)
        .callTimeout(0L, TimeUnit.MILLISECONDS)
        .readTimeout(30L, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val old = chain.request()
            if (old.method != "GET" || old.url != url)
                throw IOException("Invalid Owner video URL")
            val range = old.header("Range")?.let { value ->
                val m = requestedBytes.matchEntire(value)
                    ?: throw IOException("Invalid video Range")
                val start = m.groupValues[1].toLongOrNull()
                    ?: throw IOException("Invalid video Range")
                val suffix = m.groupValues[2]
                val end = suffix.takeIf { it.isNotEmpty() }?.toLongOrNull()
                if (start < 0 || start >= size ||
                    (suffix.isNotEmpty() && end == null) ||
                    (end != null && (end < start || end >= size)))
                    throw IOException("Video Range out of bounds")
                start to end
            }
            val request = old.newBuilder()
                .header("Authorization", "Bearer " + token)
                .header("If-Match", etag)
                .header("Accept-Encoding", "identity")
                .header("Cache-Control", "no-store")
                .build()
            val reply = chain.proceed(request)
            try {
                val length = reply.body?.contentLength() ?: -1L
                if (reply.header("ETag") != etag || reply.body == null)
                    throw IOException("Video revision mismatch")
                if (range == null) {
                    if (reply.code != 200 || (length >= 0 && length != size))
                        throw IOException("Invalid full video response")
                } else {
                    if (reply.code != 206) throw IOException("Video Range not honored")
                    val m = responseBytes.matchEntire(reply.header("Content-Range").orEmpty())
                        ?: throw IOException("Invalid Content-Range")
                    val start = m.groupValues[1].toLongOrNull()
                    val end = m.groupValues[2].toLongOrNull()
                    val total = m.groupValues[3].toLongOrNull()
                    if (start == null || end == null || total != size ||
                        start != range.first || end < start || end >= size ||
                        (range.second != null && end != range.second) ||
                        (length >= 0 && length != end - start + 1L))
                        throw IOException("Video Range mismatch")
                }
                reply
            } catch (error: IOException) {
                reply.close()
                throw error
            }
        }
        .build()
    return OwnerVideoPlayback(url.toString(), client, size) {
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }
}
