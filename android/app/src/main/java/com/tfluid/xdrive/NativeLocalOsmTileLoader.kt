package com.tfluid.xdrive

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Cache
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

/** Real OSM tiles, only used after the local Gallery user explicitly enables
 * a provider basemap. Never send a media ID, GPS latitude, Owner token, or
 * custom query argument to the tile host. */
internal object NativeLocalOsmTileLoader {
    const val PROVIDER_COPYRIGHT = "https://www.openstreetmap.org/copyright"
    private const val USER_AGENT =
        "xDrive-Android-PhotoMap/0.1 (+https://github.com/lazyxu/xdrive)"
    private const val MAX_RESPONSE_BYTES = 1_048_576
    private const val MAX_BITMAP_DIMENSION = 512
    private const val CACHE_BYTES = 96L * 1024L * 1024L

    @Volatile private var sharedClient: OkHttpClient? = null

    /** Respect the tile server's Cache-Control/Expires/ETag rather than
     * forcing revalidation or storing tiles in an unrelated image cache.
     * If the disk cache is unavailable, fail closed to the GPS-only map. */
    @Synchronized private fun client(context: Context): OkHttpClient? {
        sharedClient?.let { return it }
        val cache = runCatching {
            Cache(context.applicationContext.cacheDir.resolve("native-osm-photo-tiles"),
                CACHE_BYTES)
        }.getOrNull() ?: return null
        val dispatcher = Dispatcher().apply {
            maxRequests = 2
            maxRequestsPerHost = 2
        }
        return OkHttpClient.Builder()
            .cache(cache)
            .dispatcher(dispatcher)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .callTimeout(20, TimeUnit.SECONDS)
            .build().also { sharedClient = it }
    }

    private fun boundedImage(response: Response): ByteArray? {
        if (!response.isSuccessful ||
            response.header("Content-Type")?.substringBefore(';')?.trim() != "image/png")
            return null
        val body = response.body ?: return null
        if (body.contentLength() > MAX_RESPONSE_BYTES) return null
        return body.byteStream().use { input ->
            val out = ByteArrayOutputStream(8192)
            val buffer = ByteArray(8192)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                if (out.size() + n > MAX_RESPONSE_BYTES) return null
                out.write(buffer, 0, n)
            }
            out.toByteArray()
        }
    }

    /** OkHttp's real asynchronous dispatcher enforces two simultaneous tile
     * downloads. Cancellation closes in-flight sockets immediately. */
    private suspend fun fetchBytes(client: OkHttpClient, request: Request): ByteArray? =
        suspendCancellableCoroutine { continuation: CancellableContinuation<ByteArray?> ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resume(null)
                }
                override fun onResponse(call: Call, response: Response) {
                    val bytes = try {
                        response.use(::boundedImage)
                    } catch (_: Exception) { null }
                    if (continuation.isActive) continuation.resume(bytes)
                }
            })
        }

    suspend fun image(context: Context, tile: NativeLocalOsmTile): ImageBitmap? {
        val activeClient = client(context) ?: return null
        // A stable app-identifying UA is required for a NATIVE OSM tile client;
        // the host receives only XYZ raster URLs, not a Server request.
        val request = Request.Builder()
            .url(tile.url)
            .header("User-Agent", USER_AGENT)
            .header("Accept", "image/png")
            .get().build()
        val bytes = try { fetchBytes(activeClient, request) } catch (_: IOException) { null }
            ?: return null
        return withContext(Dispatchers.IO) {
            val probe = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, probe)
            if (probe.outWidth !in 1..MAX_BITMAP_DIMENSION ||
                probe.outHeight !in 1..MAX_BITMAP_DIMENSION) return@withContext null
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }
    }
}
