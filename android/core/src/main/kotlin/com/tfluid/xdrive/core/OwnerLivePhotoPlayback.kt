package com.tfluid.xdrive.core

import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.HttpUrl
import okhttp3.OkHttpClient

private val motionRangeRequest = Regex("""^bytes=(\d+)-(\d*)$""")
private val motionRangeResponse = Regex("""^bytes (\d+)-(\d+)/(\d+)$""")
private val motionRevisionETag = Regex("\"live-photo-motion-[a-f0-9]{64}(?:-\\d+-\\d+)?\"")
private const val maxLiveMotionBytes = 4L * 1024L * 1024L * 1024L

/** Media3 plays Server-verified Live Photo motion from a short-lived Owner
 * ticket, not from the enclosing .livp ZIP or an arbitrary video Node.
 *
 * The ticket is revision- and resource-fingerprint-scoped by Go. Unlike a
 * normal /files/:id/content video, this motion has its own ETag and byte
 * length. Pin that identity on the first authenticated stream response, then
 * require it for every subsequent seek. Do not retry a mismatched Range.
 */
internal fun ownerLivePhotoPlayback(
    pinnedClient: OkHttpClient, signedURL: HttpUrl,
): OwnerVideoPlayback {
    val pinnedETag = AtomicReference<String?>(null)
    val pinnedSize = AtomicLong(0L)
    val client = pinnedClient.newBuilder()
        .dispatcher(Dispatcher())
        .connectionPool(ConnectionPool())
        .cache(null)
        .retryOnConnectionFailure(false)
        .followRedirects(false).followSslRedirects(false)
        .callTimeout(0L, TimeUnit.MILLISECONDS)
        .readTimeout(30L, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val incoming = chain.request()
            if (incoming.method != "GET" || incoming.url != signedURL)
                throw IOException("Unexpected private motion origin")
            val range = incoming.header("Range")?.let { value ->
                val parsed = motionRangeRequest.matchEntire(value)
                    ?: throw IOException("Invalid motion Range")
                val start = parsed.groupValues[1].toLongOrNull()
                    ?: throw IOException("Invalid motion Range")
                val rawEnd = parsed.groupValues[2]
                val end = if (rawEnd.isEmpty()) null else rawEnd.toLongOrNull()
                if (rawEnd.isNotEmpty() && end == null)
                    throw IOException("Invalid motion Range")
                val total = pinnedSize.get()
                if (start < 0 || (total > 0 && start >= total) ||
                    (end != null && (end < start || (total > 0 && end >= total))))
                    throw IOException("Motion Range out of bounds")
                start to end
            }
            val expected = pinnedETag.get()
            val request = incoming.newBuilder()
                .removeHeader("Authorization")
                .header("Accept-Encoding", "identity")
                .header("Cache-Control", "no-store")
                .apply { if (expected != null) header("If-Match", expected) }
                .build()
            val response = chain.proceed(request)
            try {
                val etag = response.header("ETag").orEmpty()
                if (!motionRevisionETag.matches(etag))
                    throw IOException("Invalid signed motion ETag")
                val body = response.body ?: throw IOException("Missing motion body")
                val length = body.contentLength()
                val total = if (range == null) {
                    if (response.code != 200 || length <= 0)
                        throw IOException("Invalid full motion response")
                    length
                } else {
                    if (response.code != 206) throw IOException("Motion Range not honored")
                    val content = motionRangeResponse.matchEntire(
                        response.header("Content-Range").orEmpty())
                        ?: throw IOException("Invalid motion Content-Range")
                    val first = content.groupValues[1].toLongOrNull()
                    val last = content.groupValues[2].toLongOrNull()
                    val size = content.groupValues[3].toLongOrNull()
                    if (first == null || first != range.first || last == null || size == null ||
                        last < first || last >= size ||
                        (range.second != null && last != range.second) ||
                        (length >= 0 && length != last - first + 1L))
                        throw IOException("Motion Range mismatch")
                    size
                }
                if (total <= 0 || total > maxLiveMotionBytes)
                    throw IOException("Motion size exceeds bound")
                val known = pinnedSize.get()
                if (known != 0L && known != total)
                    throw IOException("Motion size changed during playback")
                if (!pinnedETag.compareAndSet(null, etag) && pinnedETag.get() != etag)
                    throw IOException("Motion revision changed during playback")
                if (!pinnedSize.compareAndSet(0L, total) && pinnedSize.get() != total)
                    throw IOException("Motion size changed during playback")
                response
            } catch (error: IOException) {
                response.close()
                throw error
            }
        }
        .build()
    // The original .livp Node length is intentionally NOT the motion length.
    return OwnerVideoPlayback(signedURL.toString(), client, 0L) {
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }
}
