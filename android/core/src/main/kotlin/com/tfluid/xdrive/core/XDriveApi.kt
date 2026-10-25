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

/** Owner-checked location emitted by the existing Go recent/favorite API. */
data class DriveCrumb(val id: Long, val name: String)
data class DriveCollectionItem(val node: DriveNode, val path: String, val crumbs: List<DriveCrumb>)
data class FileSearchPage(val items: List<DriveCollectionItem>, val nextCursor: String)

/** Match the Server's Windows-compatible filename subset before sending a
 * mutating request. Server validation remains authoritative. */
fun validDriveNodeName(name: String): Boolean {
    if (name.isEmpty() || name == "." || name == ".." ||
        name.toByteArray(Charsets.UTF_8).size > 255 ||
        name.endsWith(" ") || name.endsWith(".") ||
        name.any { it.code < 32 || it in "<>:\"/\\|?*" }) return false
    val base = name.substringBefore('.').uppercase(java.util.Locale.ROOT)
    if (base in setOf("CON", "PRN", "AUX", "NUL")) return false
    if (base.length == 4 && (base.startsWith("COM") || base.startsWith("LPT")) &&
        base[3] in '1'..'9') return false
    return true
}

/** Messages are client-owned constants; response bodies and transport causes are never retained. */
enum class ApiFailureReason { UNKNOWN, CURRENT_PASSWORD_INCORRECT, DNS, CONNECTION, TIMEOUT, TLS, INVALID_RESPONSE }

class ApiException(val statusCode: Int, message: String, val reason: ApiFailureReason = ApiFailureReason.UNKNOWN) : IOException(message)

interface XDriveService {
    suspend fun login(username: String, password: String): AuthSession
    suspend fun refresh(refreshToken: String): AuthSession
    suspend fun logout(refreshToken: String)
    suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String): AuthSession
    suspend fun root(accessToken: String): DriveNode
    suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange
    // The safe defaults keep independent core/Compose fixtures explicit: a
    // missing collection capability is an error, never a fabricated empty list.
    suspend fun fileRecent(accessToken: String): List<DriveCollectionItem> =
        throw ApiException(501, "File recent API unavailable")
    suspend fun fileFavorites(accessToken: String): List<DriveCollectionItem> =
        throw ApiException(501, "File favorites API unavailable")
    suspend fun favoriteFile(accessToken: String, nodeId: Long): DriveCollectionItem =
        throw ApiException(501, "Favorite API unavailable")
    suspend fun unfavoriteFile(accessToken: String, nodeId: Long) {
        throw ApiException(501, "Favorite API unavailable")
    }
    suspend fun searchFiles(accessToken: String, query: String, cursor: String = ""): FileSearchPage =
        throw ApiException(501, "Search API unavailable")
    suspend fun createDirectory(accessToken: String, parentId: Long, name: String): DriveNode =
        throw ApiException(501, "Create directory API unavailable")
    suspend fun renameNode(accessToken: String, original: DriveNode, name: String): DriveNode =
        throw ApiException(501, "Rename API unavailable")
    suspend fun trashNode(accessToken: String, original: DriveNode) {
        throw ApiException(501, "Trash API unavailable")
    }
    suspend fun copyNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode =
        throw ApiException(501, "Copy API unavailable")
    suspend fun moveNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode =
        throw ApiException(501, "Move API unavailable")
    suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
        throw ApiException(501, "Batch Trash API unavailable")
    }
}

class XDriveApi(private val address: ServerAddress, client: OkHttpClient = OkHttpClient(), connectionIp: String? = null) : XDriveService, Closeable {
    // Separate owned resources also make closing this service safe when a client was injected.
    private val http = client.newBuilder()
        .pinConnection(address, connectionIp)
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

    /** Use the already-configured Owner-authenticated OkHttp request pipeline. */
    override suspend fun createDirectory(accessToken: String, parentId: Long, name: String): DriveNode {
        require(parentId > 0 && validDriveNodeName(name)) { "Invalid directory name" }
        val created = node(request("nodes/$parentId/directories", accessToken, values = mapOf("name" to name)))
        if (created.parentId != parentId || created.name != name || !created.isDirectory) invalidPayload()
        return created
    }

    override suspend fun renameNode(accessToken: String, original: DriveNode, name: String): DriveNode {
        require(original.id > 0 && original.parentId != null && original.revision > 0 &&
            validDriveNodeName(name)) { "Invalid rename request" }
        val renamed = node(request("nodes/${original.id}", accessToken,
            values = mapOf("name" to name), method = "PATCH", ifMatch = original.revision))
        if (renamed.id != original.id || renamed.parentId != original.parentId ||
            renamed.name != name || renamed.type != original.type ||
            renamed.revision <= original.revision) invalidPayload()
        return renamed
    }

    override suspend fun trashNode(accessToken: String, original: DriveNode) {
        require(original.id > 0 && original.parentId != null && original.revision > 0) {
            "Invalid trash request"
        }
        request("nodes/${original.id}", accessToken, method = "DELETE",
            ifMatch = original.revision, emptyResponse = true)
    }

    /** Go copy and move share a numeric JSON parent_id, never a string.
     * Move requires If-Match; copy is a single no-replay Server POST. */
    override suspend fun copyNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
        require(original.id > 0 && original.parentId != null &&
            original.revision > 0 && parentId > 0) { "Invalid copy target" }
        require(!original.isDirectory || parentId != original.id) { "Cannot copy into self" }
        val copied = node(request("nodes/${original.id}/copy", accessToken,
            numberValues = mapOf("parent_id" to parentId)))
        if (copied.id == original.id || copied.parentId != parentId ||
            copied.type != original.type || copied.revision <= 0) invalidPayload()
        return copied
    }

    override suspend fun moveNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
        require(original.id > 0 && original.parentId != null &&
            original.revision > 0 && parentId > 0 &&
            parentId != original.parentId &&
            (!original.isDirectory || parentId != original.id)) { "Invalid move target" }
        val moved = node(request("nodes/${original.id}", accessToken,
            numberValues = mapOf("parent_id" to parentId), method = "PATCH",
            ifMatch = original.revision))
        if (moved.id != original.id || moved.parentId != parentId ||
            moved.name != original.name || moved.type != original.type ||
            moved.revision <= original.revision) invalidPayload()
        return moved
    }

    /** Atomic Go batch Trash, capped at 200 Server-verified revisions.
     * No optimistic success is inferred from an uncertain response. */
    override suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
        require(originals.isNotEmpty() && originals.size <= 200 &&
            originals.all { it.id > 0 && it.parentId != null && it.revision > 0 } &&
            originals.map { it.id }.toSet().size == originals.size) { "Invalid batch selection" }
        val items = JsonArray(originals.map { node ->
            JsonObject(mapOf("id" to JsonPrimitive(node.id),
                "revision" to JsonPrimitive(node.revision)))
        })
        val response = request("nodes/batch/delete", accessToken,
            bodyObject = JsonObject(mapOf("items" to items)))
        if (response.string("operation_id").isBlank()) invalidPayload()
        val deleted = response["deleted_ids"] as? JsonArray ?: invalidPayload()
        if (deleted.size != originals.size ||
            deleted.map { (it as? JsonPrimitive)?.longOrNull ?: invalidPayload() }.toSet() !=
                originals.map { it.id }.toSet()) invalidPayload()
    }

    override suspend fun searchFiles(accessToken: String, query: String, cursor: String): FileSearchPage {
        val trimmed = query.trim()
        require(trimmed.codePointCount(0, trimmed.length) >= 2 && trimmed.toByteArray(Charsets.UTF_8).size <= 256) { "Invalid search query" }
        require(cursor.length <= 4096) { "Invalid search cursor" }
        val parameters = mutableMapOf("q" to trimmed, "limit" to "100", "sort" to "name", "order" to "asc")
        if (cursor.isNotEmpty()) parameters["cursor"] = cursor
        val result = request("search", accessToken, query = parameters)
        val items = result["items"] as? JsonArray ?: invalidPayload()
        if (items.size > 100) invalidPayload()
        val records = items.map { collectionItem(it as? JsonObject ?: invalidPayload(),
            crumbsKey = "breadcrumbs", searchDirectoryCrumbs = true) }
        if (records.map { it.node.id }.toSet().size != records.size) invalidPayload()
        val next = result.optionalString("next_cursor") ?: ""
        if (next.length > 4096 || (next.isNotEmpty() && records.isEmpty()) ||
            (cursor.isNotEmpty() && next == cursor)) invalidPayload()
        return FileSearchPage(records, next)
    }

    override suspend fun fileRecent(accessToken: String): List<DriveCollectionItem> =
        collectionList(requestArray("file-recent", accessToken, query = mapOf("limit" to "50")), 50)

    override suspend fun fileFavorites(accessToken: String): List<DriveCollectionItem> =
        collectionList(requestArray("file-favorites", accessToken), 256)

    override suspend fun favoriteFile(accessToken: String, nodeId: Long): DriveCollectionItem {
        require(nodeId > 0) { "Invalid file ID" }
        // Existing Server endpoint returns the full Owner-checked collection
        // record. PUT is idempotent; no optimistic local mutation on failure.
        return collectionItem(request("file-favorites/$nodeId", accessToken,
            method = "PUT"), expectedID = nodeId)
    }

    override suspend fun unfavoriteFile(accessToken: String, nodeId: Long) {
        require(nodeId > 0) { "Invalid file ID" }
        request("file-favorites/$nodeId", accessToken, method = "DELETE", emptyResponse = true)
    }

    private fun collectionList(raw: JsonArray, max: Int): List<DriveCollectionItem> {
        if (raw.size > max) invalidPayload()
        val result = raw.map { collectionItem(it as? JsonObject ?: invalidPayload()) }
        if (result.map { it.node.id }.toSet().size != result.size) invalidPayload()
        return result
    }

    private fun collectionItem(data: JsonObject, expectedID: Long? = null,
        crumbsKey: String = "crumbs", searchDirectoryCrumbs: Boolean = false): DriveCollectionItem {
        val entry = node(data["node"] as? JsonObject ?: invalidPayload())
        if (expectedID != null && entry.id != expectedID) invalidPayload()
        val path = data.string("path")
        if (path.length > 4096) invalidPayload()
        val rawCrumbs = data[crumbsKey] as? JsonArray ?: invalidPayload()
        if (rawCrumbs.isEmpty() || rawCrumbs.size > 512) invalidPayload()
        val crumbs = rawCrumbs.map { raw ->
            val c = raw as? JsonObject ?: invalidPayload()
            val id = c.long("id")
            val name = c.string("name")
            if (id <= 0 || name.length > 255) invalidPayload()
            DriveCrumb(id, name)
        }
        if (crumbs.map { it.id }.toSet().size != crumbs.size) invalidPayload()
        // file-recent and file-favorites return *node-inclusive* crumbs.
        // Go /search instead returns *directory-only* crumbs for a file,
        // because its SQL breadcrumb tree intentionally excludes the leaf.
        // Do not require identical shapes or drop the real parent directory.
        if (searchDirectoryCrumbs && !entry.isDirectory) {
            if (entry.parentId == null || crumbs.last().id != entry.parentId) invalidPayload()
        } else if (crumbs.last().id != entry.id || crumbs.last().name != entry.name ||
            (entry.parentId != null && (crumbs.size < 2 ||
                crumbs[crumbs.lastIndex - 1].id != entry.parentId))) invalidPayload()
        return DriveCollectionItem(entry, path, crumbs)
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
        method: String? = null,
        ifMatch: Long? = null,
        numberValues: Map<String, Long> = emptyMap(),
        bodyObject: JsonObject? = null,
    ): JsonObject = requestElement(path, accessToken, values, query, emptyResponse, method,
        ifMatch, numberValues, bodyObject)
        as? JsonObject ?: invalidPayload()

    private suspend fun requestArray(
        path: String,
        accessToken: String,
        query: Map<String, String> = emptyMap(),
    ): JsonArray = requestElement(path, accessToken, query = query) as? JsonArray ?: invalidPayload()

    /** Shared single bounded, cancellable Owner-authenticated JSON transport. */
    private suspend fun requestElement(
        path: String,
        accessToken: String? = null,
        values: Map<String, String>? = null,
        query: Map<String, String> = emptyMap(),
        emptyResponse: Boolean = false,
        method: String? = null,
        ifMatch: Long? = null,
        numberValues: Map<String, Long> = emptyMap(),
        bodyObject: JsonObject? = null,
    ): JsonElement {
        val url = address.url.toHttpUrlOrNull()!!.newBuilder().addPathSegments("api/v1/$path").apply {
            query.forEach { (name, value) -> addQueryParameter(name, value) }
        }.build()
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (accessToken != null) {
            require(validToken(accessToken)) { "Invalid access token" }
            builder.header("Authorization", "Bearer $accessToken")
        }
        if (ifMatch != null) {
            require(ifMatch > 0) { "Invalid node revision" }
            builder.header("If-Match", "\"$ifMatch\"")
        }
        if (values != null || numberValues.isNotEmpty() || bodyObject != null) {
            val fields = mutableMapOf<String, JsonElement>()
            bodyObject?.let { fields.putAll(it) }
            values?.forEach { (name, value) ->
                require(name !in fields) { "Duplicate JSON field" }
                fields[name] = JsonPrimitive(value)
            }
            numberValues.forEach { (name, value) ->
                require(name !in fields && value > 0) { "Invalid numeric mutation field" }
                fields[name] = JsonPrimitive(value)
            }
            val payload = JsonObject(fields).toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            when (method) {
                null -> builder.post(payload)
                "PATCH" -> builder.patch(payload)
                else -> throw IllegalArgumentException("Invalid HTTP method")
            }
        } else when (method) {
            "PUT" -> builder.put("".toRequestBody())
            "DELETE" -> builder.delete()
            null -> Unit
            else -> throw IllegalArgumentException("Invalid HTTP method")
        }
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(builder.build())
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(transportFailure(e))
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
                            json.parseToJsonElement(buffer.readUtf8())
                        }
                        continuation.resume(result)
                    } catch (e: ApiException) {
                        continuation.resumeWithException(e)
                    } catch (_: SerializationException) {
                        continuation.resumeWithException(ApiException(response.code, "Invalid server response", ApiFailureReason.INVALID_RESPONSE))
                    } catch (e: IOException) {
                        continuation.resumeWithException(transportFailure(e))
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
    private fun invalidPayload(): Nothing = throw ApiException(0, "Invalid server response", ApiFailureReason.INVALID_RESPONSE)
}
