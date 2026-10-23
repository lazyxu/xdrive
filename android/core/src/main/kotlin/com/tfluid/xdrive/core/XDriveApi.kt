package com.tfluid.xdrive.core

import java.io.Closeable
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer

/** A root origin only: credentials, paths and URL repair are deliberately rejected. */
class ServerAddress private constructor(val url: String) {
    companion object {
        fun parse(input: String, allowHttp: Boolean = false): ServerAddress {
            fun invalid(): Nothing = throw IllegalArgumentException("Invalid server address")
            if (input.isEmpty() || input.any { it.isWhitespace() || it == '\\' || it.isISOControl() }) invalid()
            val uri = try { URI(input) } catch (_: Exception) { invalid() }
            val scheme = uri.scheme?.lowercase()
            if (scheme != "https" && !(scheme == "http" && allowHttp)) invalid()
            if (uri.rawAuthority.isNullOrEmpty() || uri.host.isNullOrEmpty() || uri.rawUserInfo != null ||
                uri.rawQuery != null || uri.rawFragment != null || uri.rawPath !in listOf("", "/") ||
                uri.port !in -1..65535 || uri.port == 0 || uri.rawAuthority.endsWith(":")) invalid()
            val parsed = input.toHttpUrlOrNull() ?: invalid()
            return ServerAddress(parsed.toString())
        }
    }
}

data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val username: String,
    val mustChangePassword: Boolean = false,
) {
    override fun toString() = "AuthSession(accessToken=[redacted], refreshToken=[redacted], username=[redacted], mustChangePassword=$mustChangePassword)"
}

data class DriveNode(
    val id: Long,
    val parentId: Long? = null,
    val name: String,
    val type: String,
    val size: Long = 0,
    val revision: Long = 0,
    val updatedAt: String = "",
) {
    val isDirectory: Boolean get() = type == "dir"
}

data class NodeRange(val items: List<DriveNode>, val totalCount: Long, val offset: Int, val limit: Int = 100)

/** Messages are client-owned constants; response bodies and transport causes are never retained. */
enum class ApiFailureReason { UNKNOWN, CURRENT_PASSWORD_INCORRECT }

class ApiException(val statusCode: Int, message: String, val reason: ApiFailureReason = ApiFailureReason.UNKNOWN) : IOException(message)

interface XDriveService {
    suspend fun login(username: String, password: String): AuthSession
    suspend fun refresh(refreshToken: String): AuthSession
    suspend fun logout(refreshToken: String)
    suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String): AuthSession
    suspend fun root(accessToken: String): DriveNode
    suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange
}

class XDriveApi(private val address: ServerAddress, client: OkHttpClient = OkHttpClient()) : XDriveService, Closeable {
    // Separate owned resources also make closing this service safe when a client was injected.
    private val http = client.newBuilder()
        .dispatcher(Dispatcher()).connectionPool(ConnectionPool())
        .cache(null)
        .followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .callTimeout(30, TimeUnit.SECONDS)
        .build()
    private val json = Json

    override suspend fun login(username: String, password: String): AuthSession =
        session(request("auth/login", values = mapOf("username" to username, "password" to password)))

    override suspend fun refresh(refreshToken: String): AuthSession =
        session(request("auth/refresh", values = mapOf("refresh_token" to refreshToken)))

    override suspend fun logout(refreshToken: String) {
        request("auth/logout", values = mapOf("refresh_token" to refreshToken), emptyResponse = true)
    }

    override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String): AuthSession =
        session(request("me/change-password", accessToken, mapOf("current_password" to currentPassword, "new_password" to newPassword)))

    override suspend fun root(accessToken: String): DriveNode = node(request("nodes/root", accessToken)).also {
        if (!it.isDirectory || it.parentId != null) invalidPayload()
    }

    override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange {
        require(parentId > 0 && offset >= 0) { "Invalid directory range" }
        val query = mapOf("offset" to "$offset", "limit" to "100", "sort" to "name", "order" to "asc", "group" to "none", "folders_first" to "true", "include_count" to "true")
        val result = request("nodes/$parentId/children", accessToken, query = query)
        val count = result.long("total_count")
        val returnedOffset = result.long("offset")
        val limit = result.long("limit")
        if (count < 0 || returnedOffset != offset.toLong() || limit != 100L ||
            result["total_count_included"] != JsonPrimitive(true)) invalidPayload()
        val items = when (val raw = result["items"]) {
            JsonNull -> emptyList()
            is JsonArray -> raw.map { node(it as? JsonObject ?: invalidPayload()) }
            else -> invalidPayload()
        }
        if (items.size.toLong() != minOf(100L, maxOf(0L, count - offset.toLong())) ||
            items.map { it.id }.toSet().size != items.size || items.any { it.parentId != parentId }) invalidPayload()
        return NodeRange(items, count, offset)
    }

    private fun session(data: JsonObject): AuthSession {
        val access = data.optionalString("access_token")?.takeIf { it.isNotBlank() }
            ?: data.optionalString("token") ?: invalidPayload()
        val refresh = data.string("refresh_token")
        val username = data.string("username")
        val mustChange = when (val raw = data["must_change_password"]) {
            null -> false
            JsonPrimitive(true) -> true
            JsonPrimitive(false) -> false
            else -> invalidPayload()
        }
        if (!validToken(access) || !validToken(refresh) || username.isBlank()) invalidPayload()
        return AuthSession(access, refresh, username, mustChange)
    }

    private fun node(data: JsonObject): DriveNode {
        val id = data.long("id")
        val parent = when (data["parent_id"]) { null, JsonNull -> null; else -> data.long("parent_id") }
        val type = data.string("type")
        val size = if ("size" in data) data.long("size") else 0
        val revision = if ("revision" in data) data.long("revision") else 0
        if (id <= 0 || (parent != null && parent <= 0) || type !in listOf("file", "dir") || size < 0 || revision < 0) invalidPayload()
        return DriveNode(id, parent, data.string("name"), type, size, revision, data.optionalString("updated_at") ?: "")
    }

    private suspend fun request(
        path: String,
        accessToken: String? = null,
        values: Map<String, String>? = null,
        query: Map<String, String> = emptyMap(),
        emptyResponse: Boolean = false,
    ): JsonObject {
        val url = address.url.toHttpUrlOrNull()!!.newBuilder().addPathSegments("api/v1/$path").apply {
            query.forEach { (name, value) -> addQueryParameter(name, value) }
        }.build()
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (accessToken != null) {
            require(validToken(accessToken)) { "Invalid access token" }
            builder.header("Authorization", "Bearer $accessToken")
        }
        if (values != null) builder.post(JsonObject(values.mapValues { JsonPrimitive(it.value) }).toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    continuation.resumeWithException(ApiException(0, "Unable to connect to server"))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val result = response.use {
                            if (!it.isSuccessful) throw ApiException(it.code, "Server request failed", errorReason(path, it))
                            if (emptyResponse) return@use JsonObject(emptyMap())
                            val body = it.body ?: invalidPayload()
                            val max = 2L * 1024 * 1024
                            if (body.contentLength() > max) invalidPayload()
                            val buffer = Buffer()
                            val source = body.source()
                            while (buffer.size <= max) {
                                val read = source.read(buffer, minOf(8192L, max + 1 - buffer.size))
                                if (read == -1L) break
                            }
                            if (buffer.size > max) invalidPayload()
                            json.parseToJsonElement(buffer.readUtf8()) as? JsonObject ?: invalidPayload()
                        }
                        continuation.resume(result)
                    } catch (e: ApiException) {
                        continuation.resumeWithException(e)
                    } catch (_: SerializationException) {
                        continuation.resumeWithException(ApiException(response.code, "Invalid server response"))
                    } catch (_: IOException) {
                        continuation.resumeWithException(ApiException(0, "Unable to read server response"))
                    } catch (_: IllegalArgumentException) {
                        continuation.resumeWithException(ApiException(response.code, "Invalid server response"))
                    }
                }
            })
        }
    }

    private fun errorReason(path: String, response: Response): ApiFailureReason {
        if (path != "me/change-password" || response.code != 401) return ApiFailureReason.UNKNOWN
        // Only the exact known Server business error is classified. Never retain error payloads.
        return try {
            val body = response.body ?: return ApiFailureReason.UNKNOWN
            val max = 4096L
            if (body.contentLength() > max) return ApiFailureReason.UNKNOWN
            val buffer = Buffer()
            val source = body.source()
            while (buffer.size <= max) {
                if (source.read(buffer, minOf(1024L, max + 1 - buffer.size)) == -1L) break
            }
            if (buffer.size > max) return ApiFailureReason.UNKNOWN
            val error = json.parseToJsonElement(buffer.readUtf8()) as? JsonObject
            if (error?.get("error") == JsonPrimitive("current password is incorrect")) ApiFailureReason.CURRENT_PASSWORD_INCORRECT
            else ApiFailureReason.UNKNOWN
        } catch (_: IOException) {
            ApiFailureReason.UNKNOWN
        } catch (_: IllegalArgumentException) {
            ApiFailureReason.UNKNOWN
        }
    }

    override fun close() {
        http.dispatcher.cancelAll()
        http.dispatcher.executorService.shutdownNow()
        http.connectionPool.evictAll()
        http.cache?.close()
    }

    private fun JsonObject.string(key: String): String = optionalString(key) ?: invalidPayload()
    private fun JsonObject.optionalString(key: String): String? = when (val value = this[key]) {
        null, JsonNull -> null
        is JsonPrimitive -> if (value.isString) value.content else invalidPayload()
        else -> invalidPayload()
    }
    private fun JsonObject.long(key: String): Long {
        val value = this[key] as? JsonPrimitive ?: invalidPayload()
        if (value.isString) invalidPayload()
        return value.longOrNull ?: invalidPayload()
    }
    private fun validToken(token: String): Boolean = token.isNotEmpty() && token.all { it in '!'..'~' }
    private fun invalidPayload(): Nothing = throw ApiException(0, "Invalid server response")
}
