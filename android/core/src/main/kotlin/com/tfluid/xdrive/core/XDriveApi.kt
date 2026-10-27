package com.tfluid.xdrive.core

import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Locale
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
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

/** Only top-level deleted roots are recoverable; their descendants move with them. */
data class TrashEntry(val node: DriveNode, val deletedAt: String)
data class TrashPage(val items: List<TrashEntry>, val totalCount: Long, val offset: Int)


/** Owner-checked location emitted by the existing Go recent/favorite API. */
data class DriveCrumb(val id: Long, val name: String)
data class DriveCollectionItem(val node: DriveNode, val path: String, val crumbs: List<DriveCrumb>)
data class FileSearchPage(val items: List<DriveCollectionItem>, val nextCursor: String)

/** Bounded UTF-8 text returned by the existing Go Owner text-preview endpoint. */
data class FileTextPreview(val text: String, val truncated: Boolean, val size: Long)

/** Current Owner path from Go /nodes/:id/location, not stale search breadcrumbs. */
data class OwnedNodeLocation(
    val nodeId: Long, val revision: Long, val parentId: Long,
    val parentDirectories: List<DriveCrumb>,
)

/** One precise logical index in the same sort as Android's 100-item directory range. */
data class DirectoryItemPosition(val nodeId: Long, val revision: Long, val index: Int)

/** Go /media/items?range=true: canonical Owner photo wall, not a Files filter.
 * Keep the Server's sparse absolute offset; mobile first-open starts at tail. */
data class GalleryAsset(
    val node: DriveNode,
    val mediaKind: String,
    val capturedAt: String = "",
    val durationMs: Long = 0,
    val livePhoto: Boolean = false,
    val hasThumbnail: Boolean = false,
)
data class GalleryTimelineGroup(val key: String, val itemCount: Long, val startIndex: Int)
data class GalleryTimelineSets(
    val year: List<GalleryTimelineGroup>,
    val month: List<GalleryTimelineGroup>,
    val day: List<GalleryTimelineGroup>,
) {
    fun forScale(scale: String): List<GalleryTimelineGroup> = when (scale) {
        "year" -> year
        "month" -> month
        "day" -> day
        else -> emptyList()
    }
}
data class GalleryPage(
    val items: List<GalleryAsset>,
    val totalCount: Long,
    val offset: Int,
    val limit: Int = 60,
    val timeline: GalleryTimelineSets? = null,
)

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
    suspend fun textFilePreview(accessToken: String, node: DriveNode): FileTextPreview =
        throw ApiException(501, "Native Owner text preview unavailable")
    suspend fun nodeLocation(accessToken: String, nodeId: Long): OwnedNodeLocation =
        throw ApiException(501, "Node location API unavailable")
    suspend fun childPosition(accessToken: String, parentId: Long, nodeId: Long): DirectoryItemPosition =
        throw ApiException(501, "Directory position API unavailable")
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
    suspend fun trashPage(accessToken: String, offset: Int): TrashPage =
        throw ApiException(501, "Trash Range API unavailable")
    suspend fun restoreTrash(accessToken: String, original: DriveNode): DriveNode =
        throw ApiException(501, "Trash Restore API unavailable")
    suspend fun copyNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode =
        throw ApiException(501, "Copy API unavailable")
    suspend fun moveNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode =
        throw ApiException(501, "Move API unavailable")
    suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
        throw ApiException(501, "Batch Trash API unavailable")
    }
    /** Stream a single Owner file into a caller-owned Android document. Never buffer in memory. */
    suspend fun downloadFile(accessToken: String, node: DriveNode,
        openDestination: () -> OutputStream, onProgress: (Long) -> Unit = {}): Long =
        throw ApiException(501, "Native file download unavailable")
    /** One manual file, current verified Owner directory. No new content writer. */
    suspend fun uploadFile(accessToken: String, parent: DriveNode, name: String, size: Long,
        openSource: () -> InputStream, onProgress: (Long) -> Unit = {}): DriveNode =
        throw ApiException(501, "Native upload unavailable")
    suspend fun galleryPage(accessToken: String, offset: Int = 0,
        initialLatest: Boolean = false): GalleryPage =
        throw ApiException(501, "Gallery Owner range unavailable")
    /** Search uses the same bounded Owner range; no local visible-page filtering. */
    suspend fun gallerySearchPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String): GalleryPage =
        throw ApiException(501, "Gallery Owner search unavailable")
    /** Combined media kind + optional search, authoritative Owner Server Range. */
    suspend fun galleryKindPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String, kind: String): GalleryPage =
        throw ApiException(501, "Gallery Owner kind filter unavailable")
    suspend fun galleryThumbnail(accessToken: String, nodeId: Long, revision: Long): ByteArray =
        throw ApiException(501, "Gallery thumbnail unavailable")
    /** Opaque private native Video data source using this Server's pinned TLS/DNS. */
    fun galleryVideoPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback =
        throw ApiException(501, "Native Owner video unavailable")
    /** Signed revision-scoped .livp still, decoded by the caller, not the ZIP bytes. */
    suspend fun galleryLivePhotoStill(accessToken: String, node: DriveNode,
        onProgress: (Long, Long?) -> Unit = { _, _ -> }): ByteArray =
        throw ApiException(501, "Live Photo still unavailable")
    /** Only the current Owner's validated pair/embedded motion may be played. */
    suspend fun galleryLivePhotoMotionPlayback(
        accessToken: String, node: DriveNode,
    ): OwnerVideoPlayback =
        throw ApiException(501, "Live Photo motion unavailable")
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
    /** Read the current authenticated Node tree, never assume a search crumb is fresh.
     * No absolute source paths or connector identities are exposed to native UI. */
    override suspend fun nodeLocation(accessToken: String, nodeId: Long): OwnedNodeLocation {
        require(nodeId > 0 && validToken(accessToken))
        val result = request("nodes/$nodeId/location", accessToken)
        val returnedID = result.long("node_id")
        val revision = result.long("revision")
        val type = result.string("node_type")
        val parentID = result.long("parent_id")
        val raw = result["breadcrumbs"] as? JsonArray ?: invalidPayload()
        if (returnedID != nodeId || revision <= 0 || parentID <= 0 ||
            type !in listOf("dir", "file") || raw.isEmpty() || raw.size > 512) invalidPayload()
        val crumbs = raw.map { entry ->
            val crumb = entry as? JsonObject ?: invalidPayload()
            val id = crumb.long("id")
            val name = crumb.string("name")
            if (id <= 0 || name.toByteArray(Charsets.UTF_8).size > 255) invalidPayload()
            DriveCrumb(id, name)
        }
        if (crumbs.map { it.id }.toSet().size != crumbs.size) invalidPayload()
        val directories = if (type == "dir") {
            if (crumbs.last().id != nodeId || crumbs.size < 2) invalidPayload()
            crumbs.dropLast(1)
        } else crumbs
        if (directories.isEmpty() || directories.last().id != parentID ||
            directories.first().name.isNotEmpty()) invalidPayload()
        return OwnedNodeLocation(nodeId, revision, parentID, directories)
    }

    /** Server computes the target ordinal without sending thousands of rows. */
    override suspend fun childPosition(
        accessToken: String, parentId: Long, nodeId: Long,
    ): DirectoryItemPosition {
        require(parentId > 0 && nodeId > 0 && validToken(accessToken))
        val result = request("nodes/$parentId/children/position", accessToken, query = mapOf(
            "node_id" to nodeId.toString(), "sort" to "name", "order" to "asc",
            "group" to "none", "folders_first" to "true",
        ))
        val index = result.long("index")
        val revision = result.long("revision")
        if (result.long("node_id") != nodeId || revision <= 0 ||
            index < 0 || index > Int.MAX_VALUE ||
            result.string("sort") != "name" || result.string("order") != "asc" ||
            result.string("group") != "none" ||
            result["folders_first"] != JsonPrimitive(true)) invalidPayload()
        return DirectoryItemPosition(nodeId, revision, index.toInt())
    }

    /** Read Go's current Owner-checked text preview (up to 1 MiB) and
     * verify the exact Node/revision before AND after, fencing rename,
     * deletion, Owner revocation and in-place updates. No local disk cache. */
    override suspend fun textFilePreview(accessToken: String, original: DriveNode): FileTextPreview {
        require(original.id > 0 && original.revision > 0 && original.type == "file" &&
            original.parentId != null && original.size >= 0 && validToken(accessToken))
        suspend fun verifyNode() {
            val current = node(request("nodes/${original.id}", accessToken))
            if (current.id != original.id || current.parentId != original.parentId ||
                current.revision != original.revision || current.type != "file" ||
                current.name != original.name || current.size != original.size)
                invalidPayload()
        }
        verifyNode()
        val dto = request("files/${original.id}/preview/text", accessToken,
            ifMatch = original.revision)
        val content = dto.string("text")
        val truncated = (dto["truncated"] as? JsonPrimitive)
            ?.takeUnless { it.isString }?.booleanOrNull ?: invalidPayload()
        val size = dto.long("size")
        val utf8Length = content.toByteArray(Charsets.UTF_8).size
        val cap = 1 shl 20
        if (size != original.size || utf8Length > cap || utf8Length.toLong() > size ||
            content.contains('\u0000') || truncated != (size > cap.toLong()))
            invalidPayload()
        verifyNode()
        return FileTextPreview(content, truncated, size)
    }

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

    /** Owner-only paginated deleted roots. Reject non-deleted and duplicated rows
     * before any entry can be used as the target of a restore mutation. */
    override suspend fun trashPage(accessToken: String, offset: Int): TrashPage {
        require(offset >= 0 && offset <= Int.MAX_VALUE - 100) { "Invalid trash offset" }
        val response = request("trash", accessToken, query = mapOf(
            "range" to "true", "offset" to "$offset", "limit" to "100",
            "sort" to "updated", "order" to "desc", "include_count" to "true"))
        val count = response.long("total_count")
        if (count < 0 || response.long("offset") != offset.toLong() ||
            response.long("limit") != 100L ||
            response["total_count_included"] != JsonPrimitive(true) ||
            response.string("sort") != "updated" || response.string("order") != "desc")
            invalidPayload()
        val array = response["items"] as? JsonArray ?: invalidPayload()
        val entries = array.map { raw ->
            val item = raw as? JsonObject ?: invalidPayload()
            val parsed = node(item)
            val deletedAt = (item["deleted_at"] as? JsonPrimitive)?.contentOrNull
                ?.takeIf { it.isNotBlank() } ?: invalidPayload()
            if (parsed.parentId == null || parsed.revision <= 0) invalidPayload()
            TrashEntry(parsed, deletedAt)
        }
        if (entries.size.toLong() != minOf(100L, (count - offset).coerceAtLeast(0L)) ||
            entries.map { it.node.id }.toSet().size != entries.size) invalidPayload()
        return TrashPage(entries, count, offset)
    }

    /** One non-retried mutation, fenced by the exact deleted revision. */
    override suspend fun restoreTrash(accessToken: String, original: DriveNode): DriveNode {
        require(original.id > 0 && original.parentId != null && original.revision > 0) {
            "Invalid trash restore"
        }
        val restored = node(request("trash/${original.id}/restore", accessToken,
            values = emptyMap(), ifMatch = original.revision))
        if (restored.id != original.id || restored.parentId != original.parentId ||
            restored.name != original.name || restored.type != original.type ||
            restored.revision <= original.revision) invalidPayload()
        return restored
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


    /**
     * Single Owner-authenticated byte stream. Reuses the pinned TLS/Host client.
     * Refuses stale revision, length/checksum mismatch, redirects and partial EOF.
     * The caller owns cleanup of uncommitted SAF documents on failure/cancel.
     */
    override suspend fun downloadFile(
        accessToken: String, node: DriveNode,
        openDestination: () -> OutputStream, onProgress: (Long) -> Unit,
    ): Long {
        require(node.type == "file" && node.id > 0 && node.revision > 0 && node.size >= 0)
        require(validToken(accessToken)) { "Invalid access token" }
        val url = address.url.toHttpUrlOrNull()!!.newBuilder()
            .addPathSegments("api/v1/files/" + node.id + "/content").build()
        val request = Request.Builder().url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("Accept-Encoding", "identity")
            .header("Cache-Control", "no-store")
            .build()
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            // Existing 30s JSON call timeout is inappropriate for large files;
            // OkHttp's read-idle timeout and coroutine cancellation still apply.
            call.timeout().timeout(0, TimeUnit.MILLISECONDS)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(transportFailure(e))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val copied = response.use { reply ->
                            if (reply.code != 200)
                                throw ApiException(reply.code, "File download rejected")
                            val expectedETag = 34.toChar().toString() + node.revision + 34.toChar()
                            if (reply.header("ETag") != expectedETag) invalidPayload()
                            val body = reply.body ?: invalidPayload()
                            val length = body.contentLength()
                            if (length >= 0 && length != node.size) invalidPayload()
                            val sha = reply.header("X-Content-SHA256")
                            if (sha != null && !sha.matches(Regex("[0-9a-fA-F]{64}")))
                                invalidPayload()
                            val hash = MessageDigest.getInstance("SHA-256")
                            var written = 0L
                            var lastProgress = 0L
                            var lastNoticeNanos = System.nanoTime()
                            val bytes = ByteArray(64 * 1024)
                            openDestination().use { output ->
                                body.byteStream().use { input ->
                                    while (true) {
                                        if (!continuation.isActive) throw IOException("Cancelled")
                                        val size = input.read(bytes)
                                        if (size < 0) break
                                        if (size == 0) continue
                                        if (size.toLong() > node.size - written) invalidPayload()
                                        output.write(bytes, 0, size)
                                        hash.update(bytes, 0, size)
                                        written += size
                                        val now = System.nanoTime()
                                        if (written - lastProgress >= 8L * 1024 * 1024 ||
                                            now - lastNoticeNanos >= 100_000_000L) {
                                            lastProgress = written
                                            lastNoticeNanos = now
                                            if (continuation.isActive) onProgress(written)
                                        }
                                    }
                                }
                            }
                            if (written != node.size) invalidPayload()
                            if (sha != null && hash.digest().joinToString("") {
                                "%02x".format(Locale.ROOT, it.toInt() and 0xff)
                            } != sha.lowercase(Locale.ROOT)) invalidPayload()
                            if (continuation.isActive) onProgress(written)
                            written
                        }
                        if (continuation.isActive) continuation.resume(copied)
                    } catch (e: ApiException) {
                        if (continuation.isActive) continuation.resumeWithException(e)
                    } catch (e: IOException) {
                        if (continuation.isActive) continuation.resumeWithException(transportFailure(e))
                    } catch (_: RuntimeException) {
                        if (continuation.isActive) continuation.resumeWithException(
                            ApiException(0, "File download failed", ApiFailureReason.INVALID_RESPONSE))
                    }
                }
            })
        }
    }


    /**
     * Manual Android SAF upload via the existing Go UploadSession / CAS writer.
     * 8 MiB bounded chunks; no persisted grants, second upload runner, retries,
     * overwrite policy or speculative success. The caller owns the SAF URI.
     */
    override suspend fun uploadFile(
        accessToken: String, parent: DriveNode, name: String, size: Long,
        openSource: () -> InputStream, onProgress: (Long) -> Unit,
    ): DriveNode = withContext(Dispatchers.IO) {
        require(parent.isDirectory && parent.id > 0 && validDriveNodeName(name) && size >= 0)
        require(validToken(accessToken)) { "Invalid access token" }
        val chunkSize = 8 * 1024 * 1024
        val chunkCount = if (size == 0L) 0L else ((size - 1) / chunkSize + 1)
        require(chunkCount <= 1_000_000) { "Upload has too many chunks" }
        val session = request("uploads", accessToken, bodyObject = JsonObject(mapOf(
            "parent_id" to JsonPrimitive(parent.id),
            "name" to JsonPrimitive(name),
            "size" to JsonPrimitive(size),
            "chunk_size" to JsonPrimitive(chunkSize),
            "conflict_policy" to JsonPrimitive("fail"),
        )))
        val id = session.string("id")
        if (!id.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) ||
            session.string("status") != "active" || session.long("parent_id") != parent.id ||
            session.string("name") != name || session.long("size") != size ||
            session.long("chunk_size") != chunkSize.toLong() ||
            session.long("chunk_count") != chunkCount) invalidPayload()

        var completed = false
        try {
            var uploaded = 0L
            openSource().use { input ->
                for (index in 0 until chunkCount.toInt()) {
                    val wanted = minOf(chunkSize.toLong(), size - uploaded).toInt()
                    val bytes = ByteArray(wanted)
                    var count = 0
                    var emptyReads = 0
                    while (count < wanted) {
                        val received = input.read(bytes, count, wanted - count)
                        if (received < 0) throw ApiException(0, "Selected file ended before expected size")
                        if (received == 0) {
                            // Misbehaving SAF providers must not pin an IO worker forever.
                            if (++emptyReads > 16) throw ApiException(0, "Selected file did not make progress")
                        } else {
                            count += received
                            emptyReads = 0
                        }
                    }
                    val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
                        "%02x".format(Locale.ROOT, it.toInt() and 0xff)
                    }
                    val ack = putUploadChunk(accessToken, id, index, bytes, hash)
                    if (ack.long("index") != index.toLong() ||
                        ack.long("size") != wanted.toLong() ||
                        !ack.string("sha256").equals(hash, ignoreCase = true)) invalidPayload()
                    uploaded += wanted
                    onProgress(uploaded) // Only server-confirmed bytes count as uploaded.
                }
                if (input.read() != -1) throw ApiException(0, "Selected file grew during upload")
            }
            val finalized = request("uploads/$id/finalize", accessToken,
                bodyObject = JsonObject(emptyMap()), longRunning = true)
            if (finalized.string("id") != id || finalized.string("status") != "finalized" ||
                finalized.long("parent_id") != parent.id ||
                finalized.long("size") != size) invalidPayload()
            val result = node(finalized["result"] as? JsonObject ?: invalidPayload())
            if (result.id <= 0 || result.type != "file" || result.parentId != parent.id ||
                result.name != name || result.size != size || result.revision <= 0)
                invalidPayload()
            completed = true
            result
        } finally {
            if (!completed) {
                // May already be finalized after a lost ACK. DELETE is best effort;
                // it cannot remove a finalized Node. Never retry the finalize write.
                withContext(NonCancellable) {
                    withTimeoutOrNull(2_000) {
                        try {
                            request("uploads/$id", accessToken,
                                emptyResponse = true, method = "DELETE")
                        } catch (_: Exception) { /* Server TTL also reaps staging. */ }
                    }
                }
            }
        }
    }

    private suspend fun putUploadChunk(
        accessToken: String, sessionId: String, index: Int,
        bytes: ByteArray, checksum: String,
    ): JsonObject = suspendCancellableCoroutine { continuation ->
        val url = address.url.toHttpUrlOrNull()!!.newBuilder()
            .addPathSegments("api/v1/uploads/$sessionId/chunks/$index").build()
        val request = Request.Builder().url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("X-Chunk-SHA256", checksum)
            .header("Accept", "application/json")
            .put(bytes.toRequestBody("application/octet-stream".toMediaType())).build()
        val call = http.newCall(request)
        call.timeout().timeout(0, TimeUnit.MILLISECONDS)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(transportFailure(e))
            }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val obj = response.use { reply ->
                        if (!reply.isSuccessful) throw ApiException(reply.code, "Upload chunk rejected")
                        val body = reply.body ?: invalidPayload()
                        if (body.contentLength() > 4_096) invalidPayload()
                        val buffer = Buffer()
                        val source = body.source()
                        while (buffer.size <= 4_096) {
                            val read = source.read(buffer, minOf(4_097L - buffer.size, 4_096L))
                            if (read == -1L) break
                        }
                        if (buffer.size > 4_096) invalidPayload()
                        json.parseToJsonElement(buffer.readUtf8()) as? JsonObject
                            ?: invalidPayload()
                    }
                    if (continuation.isActive) continuation.resume(obj)
                } catch (e: ApiException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                } catch (e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(transportFailure(e))
                } catch (_: Exception) {
                    if (continuation.isActive) continuation.resumeWithException(
                        ApiException(0, "Invalid upload acknowledgement", ApiFailureReason.INVALID_RESPONSE))
                }
            }
        })
    }


    /** Same Owner Bearer/Origin and bounded JSON transport as Files, with the
     * Server's exact iOS Gallery chronological tail and sparse Range contract. */
    override suspend fun galleryPage(accessToken: String, offset: Int, initialLatest: Boolean): GalleryPage =
        ownerGalleryPage(accessToken, offset, initialLatest, "")

    override suspend fun gallerySearchPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String): GalleryPage {
        require(search.isNotBlank() && search == search.trim() && search.length <= 200)
        return ownerGalleryPage(accessToken, offset, initialLatest, search)
    }

    override suspend fun galleryKindPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String, kind: String): GalleryPage {
        require(kind == "image" || kind == "video")
        require(search.length <= 200 && search == search.trim())
        return ownerGalleryPage(accessToken, offset, initialLatest, search, kind)
    }

    private suspend fun ownerGalleryPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String, mediaKind: String = ""): GalleryPage {
        require(offset >= 0 && (!initialLatest || offset == 0))
        val query = mutableMapOf(
            "range" to "true", "limit" to "60", "offset" to offset.toString(),
            "sort_by" to "captured", "sort_dir" to "asc",
            "unknown_first" to "true", "fold_duplicates" to "true",
        )
        if (initialLatest) query["initial_position"] = "latest"
        if (search.isNotEmpty()) query["q"] = search
        if (mediaKind.isNotEmpty()) query["kind"] = mediaKind
        val result = request("media/items", accessToken, query = query)
        val raw = result["items"] as? JsonArray ?: invalidPayload()
        if (raw.size > 60) invalidPayload()
        val total = result.long("total_count")
        val returnedOffset = result.long("offset")
        val limit = result.long("limit")
        if (total < 0 || returnedOffset < 0 || returnedOffset > Int.MAX_VALUE ||
            limit != 60L || returnedOffset + raw.size > total ||
            (!initialLatest && returnedOffset.toInt() != offset)) invalidPayload()
        val items = raw.map {
            val entry = it as? JsonObject ?: invalidPayload()
            val itemNode = node(entry["node"] as? JsonObject ?: invalidPayload())
            val metadata = entry["metadata"] as? JsonObject ?: invalidPayload()
            val kind = metadata.string("media_kind")
            if (itemNode.type != "file" || itemNode.id <= 0 || itemNode.revision <= 0 ||
                kind !in listOf("image", "video") ||
                (mediaKind.isNotEmpty() && mediaKind != kind)) invalidPayload()
            val captured = metadata.optionalString("captured_at") ?: ""
            if (captured.length > 64) invalidPayload()
            val duration = when (metadata["duration_ms"]) {
                null, JsonNull -> 0L
                else -> metadata.long("duration_ms")
            }
            if (duration < 0) invalidPayload()
            val hasThumb = when (metadata["has_thumbnail"]) {
                JsonPrimitive(true) -> true
                JsonPrimitive(false) -> false
                else -> invalidPayload()
            }
            val live = when (entry["live_photo"]) {
                null, JsonNull, JsonPrimitive(false) -> false
                JsonPrimitive(true) -> true
                else -> invalidPayload()
            }
            GalleryAsset(itemNode, kind, captured, duration, live, hasThumb)
        }
        if (items.map { it.node.id }.toSet().size != items.size ||
            (total > returnedOffset && items.isEmpty())) invalidPayload()
        return GalleryPage(items, total, returnedOffset.toInt(), 60,
            parseGalleryTimelineSets(result["timeline_group_sets"], total))
    }

    /** Authoritative 100k-safe index metadata; never generate time groups
     * from sparse, already-loaded thumbnails. Require exact partition counts.
     * Missing sets are allowed for relevance searches and older Server builds. */
    private fun parseGalleryTimelineSets(raw: JsonElement?, total: Long): GalleryTimelineSets? {
        if (raw == null || raw == JsonNull) return null
        val source = raw as? JsonObject ?: invalidPayload()
        fun groups(scale: String): List<GalleryTimelineGroup> {
            val entries = source[scale] as? JsonArray ?: invalidPayload()
            if (entries.size > 40_000) invalidPayload()
            var nextIndex = 0L
            val groups = entries.map { element ->
                val entry = element as? JsonObject ?: invalidPayload()
                val key = entry.string("key")
                val validKey = key == "unknown" || when (scale) {
                    "year" -> Regex("""\d{4}""").matches(key)
                    "month" -> Regex("""\d{4}-\d{2}""").matches(key)
                    else -> Regex("""\d{4}-\d{2}-\d{2}""").matches(key)
                }
                val count = entry.long("item_count")
                val start = entry.long("start_index")
                if (!validKey || count <= 0 || start != nextIndex ||
                    start > Int.MAX_VALUE || count > total - nextIndex) invalidPayload()
                nextIndex += count
                GalleryTimelineGroup(key, count, start.toInt())
            }
            if (nextIndex != total) invalidPayload()
            return groups
        }
        return GalleryTimelineSets(groups("year"), groups("month"), groups("day"))
    }

    /** Existing versioned Owner content endpoint supports HTTP Range. */
    override fun galleryVideoPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback {
        require(node.type == "file" && node.id > 0 && node.revision > 0 && node.size > 0)
        require(validToken(accessToken)) { "Invalid access token" }
        val url = address.url.toHttpUrlOrNull()!!.newBuilder()
            .addPathSegments("api/v1/files/" + node.id + "/content").build()
        return ownerVideoPlayback(http, url, accessToken, node)
    }

    /** Go binds this short-lived ticket to Owner session, Node revision and
     * exact derived resource fingerprint; never use a guessed .MOV filename. */
    private suspend fun signedLivePhotoTicket(
        accessToken: String, node: DriveNode, role: String,
    ): HttpUrl {
        require(role in setOf("still", "motion") &&
            node.type == "file" && node.id > 0 && node.revision > 0 &&
            validToken(accessToken))
        val ticket = request(
            "media/items/${node.id}/live-photo-$role-ticket",
            accessToken, values = emptyMap(),
        )
        val expectedKind = if (role == "still") "image" else "video"
        if (ticket.string("kind") != expectedKind ||
            !ticket.string("mime_type").lowercase(Locale.ROOT)
                .startsWith("$expectedKind/")) invalidPayload()
        val path = ticket.string("url")
        val expectedPath = "/api/v1/media-live-photo-$role/${node.id}"
        if (!path.startsWith("$expectedPath?") || path.startsWith("//"))
            invalidPayload()
        val base = address.url.toHttpUrlOrNull()!!
        val url = base.resolve(path) ?: invalidPayload()
        if (url.scheme != base.scheme || url.host != base.host ||
            url.port != base.port || url.encodedPath != expectedPath ||
            url.username.isNotEmpty() || url.password.isNotEmpty() ||
            url.fragment != null || url.queryParameterNames != setOf("ticket") ||
            url.queryParameterValues("ticket").size != 1 ||
            url.queryParameter("ticket").isNullOrBlank())
            invalidPayload()
        return url
    }

    override suspend fun galleryLivePhotoMotionPlayback(
        accessToken: String, node: DriveNode,
    ): OwnerVideoPlayback {
        val url = signedLivePhotoTicket(accessToken, node, "motion")
        return ownerLivePhotoPlayback(http, url)
    }

    override suspend fun galleryLivePhotoStill(
        accessToken: String, node: DriveNode,
        onProgress: (Long, Long?) -> Unit,
    ): ByteArray {
        val url = signedLivePhotoTicket(accessToken, node, "still")
        val request = Request.Builder().url(url)
            .header("Accept-Encoding", "identity")
            .header("Cache-Control", "no-store")
            .get().build()
        return suspendCancellableCoroutine { continuation ->
            val call = http.newBuilder()
                .callTimeout(0L, TimeUnit.MILLISECONDS).build()
                .newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive)
                        continuation.resumeWithException(transportFailure(error))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val bytes = response.use { reply ->
                            if (reply.code != 200)
                                throw ApiException(reply.code, "Live Photo still unavailable")
                            val etag = reply.header("ETag").orEmpty()
                            if (!etag.matches(Regex(
                                    """^"live-photo-still-[a-f0-9]{64}-[0-9]+-[0-9]+"$"""
                                ))) invalidPayload()
                            val mime = reply.header("Content-Type").orEmpty()
                                .substringBefore(';').trim().lowercase(Locale.ROOT)
                            if (!mime.startsWith("image/")) invalidPayload()
                            val body = reply.body ?: invalidPayload()
                            val cap = 32L * 1024L * 1024L
                            val size = body.contentLength()
                            if (size > cap || size == 0L) invalidPayload()
                            val total = size.takeIf { it > 0 }
                            val buf = Buffer()
                            val stream = body.source()
                            var lastNotice = System.nanoTime()
                            while (buf.size <= cap) {
                                if (!continuation.isActive) throw IOException("Cancelled")
                                val read = stream.read(buf, minOf(64 * 1024L, cap + 1 - buf.size))
                                if (read == -1L) break
                                val now = System.nanoTime()
                                if (read > 0 && now - lastNotice >= 100_000_000L) {
                                    lastNotice = now
                                    try { onProgress(buf.size, total) } catch (_: Exception) { }
                                }
                            }
                            if (buf.size == 0L || buf.size > cap ||
                                (size > 0 && buf.size != size)) invalidPayload()
                            try { onProgress(buf.size, total) } catch (_: Exception) { }
                            buf.readByteArray()
                        }
                        if (continuation.isActive) continuation.resume(bytes)
                    } catch (error: ApiException) {
                        if (continuation.isActive)
                            continuation.resumeWithException(error)
                    } catch (error: IOException) {
                        if (continuation.isActive)
                            continuation.resumeWithException(transportFailure(error))
                    } catch (_: Exception) {
                        if (continuation.isActive)
                            continuation.resumeWithException(ApiException(
                                0, "Invalid Live Photo still", ApiFailureReason.INVALID_RESPONSE))
                    }
                }
            })
        }
    }

    /** No public media URLs, no credentials in query strings or disk cache.
     * Same pinned OkHttp route, bounded binary response and actual cancellation. */
    override suspend fun galleryThumbnail(accessToken: String, nodeId: Long, revision: Long): ByteArray {
        require(nodeId > 0 && revision > 0 && validToken(accessToken))
        val url = address.url.toHttpUrlOrNull()!!.newBuilder()
            .addPathSegments("api/v1/media/items/$nodeId/thumbnail")
            .addQueryParameter("revision", revision.toString()).build()
        val request = Request.Builder().url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("Accept", "image/jpeg")
            .build()
        return suspendCancellableCoroutine { continuation ->
            val call = http.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(transportFailure(error))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val bytes = response.use { reply ->
                            if (reply.code != 200)
                                throw ApiException(reply.code, "Gallery thumbnail unavailable")
                            val mime = reply.header("Content-Type").orEmpty().substringBefore(';').trim()
                            if (mime != "image/jpeg") invalidPayload()
                            val body = reply.body ?: invalidPayload()
                            val max = 4L * 1024 * 1024
                            if (body.contentLength() > max) invalidPayload()
                            val buffer = Buffer()
                            val source = body.source()
                            while (buffer.size <= max) {
                                val count = source.read(buffer, minOf(8192L, max + 1 - buffer.size))
                                if (count < 0) break
                            }
                            if (buffer.size == 0L || buffer.size > max) invalidPayload()
                            buffer.readByteArray()
                        }
                        if (continuation.isActive) continuation.resume(bytes)
                    } catch (error: ApiException) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    } catch (error: IOException) {
                        if (continuation.isActive) continuation.resumeWithException(transportFailure(error))
                    } catch (_: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(
                            ApiException(0, "Invalid thumbnail", ApiFailureReason.INVALID_RESPONSE))
                    }
                }
            })
        }
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
        longRunning: Boolean = false,
    ): JsonObject = requestElement(path, accessToken, values, query, emptyResponse, method,
        ifMatch, numberValues, bodyObject, longRunning)
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
        longRunning: Boolean = false,
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
            // Go CAS Finalize may legitimately spend minutes assembling a large
            // object before its first response byte. Disable only the total
            // timeout and extend its read-idle limit; retain the same pinned
            // DNS/TLS/SNI client, redirect/retry prohibitions and cancellation.
            val call = if (longRunning) http.newBuilder()
                .callTimeout(0, TimeUnit.MILLISECONDS)
                .readTimeout(10, TimeUnit.MINUTES).build().newCall(builder.build())
            else http.newCall(builder.build())
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
                            // Go returns up to 1 MiB of UTF-8 as JSON.
                            // Escaped control characters can expand to 6x
                            // before decoding; retain the strict 2 MiB bound
                            // for every other Owner JSON response.
                            val max = if (path.endsWith("/preview/text"))
                                6L * 1024 * 1024 + 1024 else 2L * 1024 * 1024
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
