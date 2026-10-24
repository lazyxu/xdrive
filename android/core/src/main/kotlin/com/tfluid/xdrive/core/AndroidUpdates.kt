package com.tfluid.xdrive.core

import java.io.Closeable
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okio.Buffer

enum class UpdateSource(val preference: String, val label: String, val releasesUrl: String) {
    GITHUB("github", "GitHub", "https://api.github.com/repos/lazyxu/xdrive/releases?per_page=100"),
    GITLAB("gitlab", "GitLab", "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/releases?per_page=100");
    companion object {
        fun fromPreference(value: String?) = entries.firstOrNull { it.preference == value } ?: GITHUB
    }
}

data class AndroidUpdate(val versionCode: Long, val versionName: String, val downloadUrl: String, val available: Boolean)
class UpdateException : IOException("检查更新失败，请稍后重试。")

interface AndroidUpdateService {
    suspend fun check(source: UpdateSource, installedCode: Long): AndroidUpdate?
}

/** Public release metadata only. Never shares a Drive API client, cookies or account credentials. */
class AndroidUpdateClient : AndroidUpdateService, Closeable {
    private val closed = AtomicBoolean(false)
    private val http = OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(25, TimeUnit.SECONDS).connectTimeout(10, TimeUnit.SECONDS)
        .build()

    override suspend fun check(source: UpdateSource, installedCode: Long): AndroidUpdate? =
        check(source, installedCode, source.releasesUrl.toHttpUrl())

    // The endpoint override is module-private for real local HTTP fixture tests.
    internal suspend fun check(source: UpdateSource, installedCode: Long, endpoint: HttpUrl): AndroidUpdate? {
        if (closed.get() || installedCode < 1) throw UpdateException()
        val body = suspendCancellableCoroutine<String> { continuation ->
            val call = http.newCall(Request.Builder().url(endpoint)
                .header("Accept", "application/json").header("User-Agent", "xDrive-Android-Updater").build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(UpdateException())
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val text = response.use {
                            if (!it.isSuccessful) throw UpdateException()
                            val data = it.body ?: throw UpdateException()
                            val max = 2L * 1024 * 1024
                            if (data.contentLength() > max) throw UpdateException()
                            val buffer = Buffer()
                            val input = data.source()
                            while (buffer.size <= max && input.read(buffer, minOf(8192, max + 1 - buffer.size)) != -1L) { /* bounded */ }
                            if (buffer.size > max) throw UpdateException()
                            buffer.readUtf8()
                        }
                        continuation.resume(text)
                    } catch (_: IOException) {
                        if (continuation.isActive) continuation.resumeWithException(UpdateException())
                    }
                }
            })
        }
        return try { parse(source, installedCode, body) }
        catch (_: IllegalArgumentException) { throw UpdateException() }
    }

    private fun parse(source: UpdateSource, installed: Long, body: String): AndroidUpdate? {
        val releases = Json.parseToJsonElement(body) as? JsonArray ?: throw UpdateException()
        if (releases.size > 100) throw UpdateException()
        val found = mutableMapOf<Long, AndroidUpdate>()
        for (raw in releases) {
            val release = raw as? JsonObject ?: throw UpdateException()
            if (release["draft"] == JsonPrimitive(true) || release["upcoming_release"] == JsonPrimitive(true)) continue
            val assets = when (source) {
                UpdateSource.GITHUB -> release["assets"] as? JsonArray
                UpdateSource.GITLAB -> (release["assets"] as? JsonObject)?.get("links") as? JsonArray
            } ?: continue
            for (rawAsset in assets) {
                val asset = rawAsset as? JsonObject ?: throw UpdateException()
                val name = asset.string("name") ?: continue
                val match = APK_NAME.matchEntire(name) ?: continue
                val code = match.groupValues[1].toLongOrNull()?.takeIf { it in 1..2100000000L } ?: continue
                val url = when (source) {
                    UpdateSource.GITHUB -> asset.string("browser_download_url")
                    UpdateSource.GITLAB -> asset.string("direct_asset_url")?.takeIf { it.isNotEmpty() } ?: asset.string("url")
                } ?: throw UpdateException()
                val candidate = AndroidUpdate(code, match.groupValues[2], trustedDownload(source, url, name), code > installed)
                val old = found[code]
                if (old != null && old.versionName != candidate.versionName) throw UpdateException()
                // A rolling snapshot and stable release can carry the same APK.
                // Keep the first official URL for the same Android version.
                if (old == null) found[code] = candidate
            }
        }
        return found.maxByOrNull { it.key }?.value
    }

    private fun trustedDownload(source: UpdateSource, value: String, name: String): String {
        val url = value.toHttpUrlOrNull() ?: throw UpdateException()
        if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.query != null || url.fragment != null ||
            url.pathSegments.lastOrNull() != name || value.any { it.isWhitespace() || it == '\\' || it.isISOControl() }) throw UpdateException()
        val valid = when (source) {
            UpdateSource.GITHUB -> url.scheme == "https" && url.host == "github.com" && url.port == 443 &&
                url.encodedPath.startsWith("/lazyxu/xdrive/releases/download/")
            UpdateSource.GITLAB -> url.scheme == "http" && url.host == "gitlab.t-fluid.com" && url.port == 1080 &&
                (url.encodedPath.startsWith("/xuliang/xdrive/-/releases/") ||
                    Regex("^/api/v4/projects/xuliang%2[Ff]xdrive/(?:packages/generic|releases)/.+").matches(url.encodedPath))
        }
        if (!valid) throw UpdateException()
        return url.toString()
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        http.dispatcher.cancelAll()
        http.dispatcher.executorService.shutdownNow()
        http.connectionPool.evictAll()
    }
    private fun JsonObject.string(key: String) = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    companion object {
        private val APK_NAME = Regex("^xdrive-android-([0-9]{1,10})-([A-Za-z0-9][A-Za-z0-9.+_-]{0,63})\\.apk$")
    }
}
