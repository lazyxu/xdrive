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

/** Authenticated Go /me response: server installation identity is required for durable photo sync. */
data class NativeServerOwnerIdentity(
    val id: Long,
    val username: String,
    val role: String,
    val instanceId: String,
) {
    init {
        require(id > 0 && username.isNotBlank() &&
            username == username.trim() && username.length <= 256 &&
            username.none { it.isISOControl() })
        require(role == "user" || role == "admin")
        require(instanceId.length in 1..256 && instanceId.none { it.isISOControl() })
    }

    override fun toString(): String = "NativeServerOwnerIdentity([redacted])"
}

/**
 * Go Server's one-time Android identity-only device enrollment response.
 * The credential is NEVER a Desktop Agent/Source token and must not be logged.
 * This object alone does not persist it or imply a working auto-backup runner.
 */
data class NativeAndroidDeviceEnrollment(
    val deviceId: String,
    val deviceToken: String,
    val displayName: String,
    val clientVersion: String,
) {
    init {
        require(runCatching {
            java.util.UUID.fromString(deviceId).toString() == deviceId
        }.getOrDefault(false))
        require(deviceToken.matches(Regex("[A-Za-z0-9_-]{43}")))
        require(displayName.isNotBlank() && displayName == displayName.trim() &&
            displayName.toByteArray(Charsets.UTF_8).size <= 128 &&
            displayName.none { it.isISOControl() })
        require(clientVersion.length <= 64 && clientVersion.none { it.isISOControl() })
    }
    override fun toString(): String = "NativeAndroidDeviceEnrollment([redacted])"
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

/** Exact Go Owner children/position ordering; grouping remains none in this increment. */
data class FileBrowseArrangement(
    val sort: String = "name",
    val order: String = "asc",
    val foldersFirst: Boolean = true,
    val group: String = "none",
) {
    init {
        require(sort in setOf("name", "updated", "type", "size")) { "Invalid Files sort" }
        require(order in setOf("asc", "desc")) { "Invalid Files order" }
        require(group in setOf("none", "type", "modified", "size")) { "Invalid Files grouping" }
    }
}

/** Server-indexed group spans, never client-grouped sparse directory rows. */
data class FileBrowseGroupIndex(
    val key: String, val itemCount: Long, val startIndex: Long,
)

internal fun validFilesGroupKey(group: String, key: String): Boolean {
    if (key.isEmpty() || key.toByteArray(Charsets.UTF_8).size > 256) return false
    return when (group) {
        "type" -> key == "folder" || key == "other" ||
            (key.startsWith("ext:") && key.length > 4)
        "modified" -> key == "unknown" ||
            Regex("""month:\d{4}-(0[1-9]|1[0-2])""").matches(key)
        "size" -> key in setOf("folder", "empty", "tiny", "small", "medium", "large")
        else -> false
    }
}

data class NodeRange(
    val items: List<DriveNode>, val totalCount: Long, val offset: Int,
    val limit: Int = 100, val groups: List<FileBrowseGroupIndex> = emptyList(),
)

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

/** True WGS84 viewport; the Server/Baidu owns BD-09 conversion and map projection. */
data class OwnerMapBounds(
    val west: Double, val south: Double, val east: Double, val north: Double,
) {
    fun valid(): Boolean =
        listOf(west, south, east, north).all { it.isFinite() } &&
            south >= -90.0 && north <= 90.0 && south < north &&
            west in -180.0..180.0 && east in -180.0..180.0 &&
            west != east && !(west == 180.0 && east == -180.0)

    fun contains(lat: Double, lon: Double): Boolean =
        valid() && lat.isFinite() && lon.isFinite() &&
            lat >= south && lat <= north &&
            (if (west < east) lon >= west && lon <= east
             else lon >= west || lon <= east)

    companion object {
        val WORLD = OwnerMapBounds(-180.0, -90.0, 180.0, 90.0)
    }
}

/** Real Owner source samples from Go /media/places/overview. Coordinates are
 * WGS84, NOT provider-converted BD-09 and never guessed from a grid centroid. */
data class OwnerMapSample(
    val id: String, val name: String,
    val sampleLatitude: Double, val sampleLongitude: Double,
    val latitude: Double, val longitude: Double,
    val coordinateKind: String, val itemCount: Long,
    val coverNodeId: Long? = null,
)
data class OwnerMapOverview(
    val samples: List<OwnerMapSample>, val totalPhotoCount: Long,
    val aggregated: Boolean,
)

/** BD09 map camera coordinates are intentionally a *different* type than
 * original PhotoMetadata WGS84. No client-side transformation is authorized. */
data class OwnerBd09Bounds(
    val west: Double, val south: Double, val east: Double, val north: Double,
) {
    fun valid(): Boolean {
        if (!listOf(west, south, east, north).all { it.isFinite() } ||
            west !in -180.0..180.0 || east !in -180.0..180.0 ||
            south < -90.0 || north > 90.0 || south >= north ||
            west == east || (west == 180.0 && east == -180.0)) return false
        // Keep parity with Go baiduPhotoMapCellSteps: the 8x8 SQL grid
        // rejects numerically unstable tiny viewports before running a query.
        // A wrapped antimeridian span uses the positive [0, 360] width.
        val width = (east - west).let { if (it < 0.0) it + 360.0 else it }
        val height = north - south
        return width > 1e-10 && width <= 360.0 &&
            height > 1e-10 && height <= 360.0
    }
    fun contains(lat: Double, lon: Double): Boolean =
        valid() && lat.isFinite() && lon.isFinite() &&
            lat >= south && lat <= north &&
            (if (west < east) lon >= west && lon <= east
             else lon >= west || lon <= east)
    companion object {
        val WORLD = OwnerBd09Bounds(-180.0, -90.0, 180.0, 90.0)
    }
}

data class OwnerBd09Cell(
    val cellX: Int, val cellY: Int, val photoCount: Long,
    val assetId: Long, val nodeId: Long, val nodeRevision: Long,
    val latitude: Double, val longitude: Double,
)

/** The trusted 8×8 Owner-projected spatial summary, never a WGS84 guess. */
data class OwnerBd09MapCells(
    val cells: List<OwnerBd09Cell>, val totalPhotoCount: Long,
)

/** Go /media/items?range=true: canonical Owner photo wall, not a Files filter.
 * Keep the Server's sparse absolute offset; mobile first-open starts at tail. */
data class GalleryAsset(
    val node: DriveNode,
    val mediaKind: String,
    val capturedAt: String = "",
    val durationMs: Long = 0,
    val livePhoto: Boolean = false,
    val hasThumbnail: Boolean = false,
    /** Null means older/partial media DTO did not describe favorite state. */
    val favorite: Boolean? = null,
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

/** The same Server PhotoCollection identities used by Web/PWA.
 * An album is metadata + membership, not a copied directory or media byte cache. */
data class GalleryAlbum(
    val id: String,
    val kind: String,
    val name: String,
    val itemCount: Long,
    val revision: Long,
    val albumFolderId: Long,
    val coverNodeId: Long? = null,
)

/** Current-owner versioned album cover result. Never a guessed URL or
 * unrevisioned image response; the caller owns only bounded JPEG bytes. */
data class GalleryAlbumCover(
    val nodeId: Long,
    val revision: Long,
    val jpegBytes: ByteArray,
)

/** Go owns these keys; only accepted prefixes can select a private album Range.
 * Preserve any opaque ID tail and percent-escape it as ONE URL path segment. */
internal fun validGalleryAlbumId(id: String): Boolean =
    id.length in 3..512 && id == id.trim() &&
        id.none { it.isISOControl() } &&
        listOf("folder:", "source:", "manual:", "smart:").any { prefix ->
            id.startsWith(prefix) && id.length > prefix.length
        }

/** Go-compatible manual album name preflight, with Server authoritative.
 * Reject malformed surrogate pairs rather than silently replacing characters. */
fun normalizeGalleryManualAlbumName(input: String): String? {
    val name = input.trim()
    if (name.isEmpty() || name.length > 400 ||
        name.codePointCount(0, name.length) > 200 ||
        name.any { it.isISOControl() }) return null
    var index = 0
    while (index < name.length) {
        val char = name[index]
        when {
            Character.isHighSurrogate(char) -> {
                if (index + 1 >= name.length ||
                    !Character.isLowSurrogate(name[index + 1])) return null
                index += 2
            }
            Character.isLowSurrogate(char) -> return null
            else -> index++
        }
    }
    return name
}

/** Parse the same comma-separated native tag draft as the PWA, with the Go
 * limits (1..32 tags, <=64 Unicode scalars/tag, no controls). Server remains
 * the authority for Unicode normalisation, identity and metadata ownership. */
fun parseGalleryTagInput(input: String): List<String>? {
    val raw = input.split(',', '，').map { it.trim().replace(Regex("\\s+"), " ") }
        .filter { it.isNotEmpty() }
    if (raw.isEmpty() || raw.size > 32) return null
    val unique = linkedMapOf<String, String>()
    for (tag in raw) {
        if (tag.codePointCount(0, tag.length) > 64 ||
            tag.any { it.isISOControl() }) return null
        unique.putIfAbsent(tag.lowercase(Locale.ROOT), tag)
    }
    return unique.values.sortedWith(compareBy<String> { it.lowercase(Locale.ROOT) }
        .thenBy { it })
}

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
    /** No legacy fallback: a Server without installation ID cannot authorize native backup. */
    suspend fun verifiedOwnerIdentity(accessToken: String): NativeServerOwnerIdentity =
        throw ApiException(501, "Native owner identity unavailable")
    /** Explicit Owner action only; no automatic device re-registration on lost ACK. */
    suspend fun registerNativeAndroidDevice(
        accessToken: String, displayName: String, clientVersion: String,
    ): NativeAndroidDeviceEnrollment =
        throw ApiException(501, "Android device identity enrollment unavailable")
    /** Read-only device proof; a stored token alone is never authorization. */
    suspend fun verifyNativeAndroidDevice(
        accessToken: String, enrolled: NativeAndroidDeviceEnrollment,
    ): Unit = throw ApiException(501, "Android device identity verification unavailable")
    suspend fun root(accessToken: String): DriveNode
    suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange
    /** Keep old fixtures default-only; never pretend unsupported sort succeeded. */
    suspend fun childrenArranged(
        accessToken: String, parentId: Long, offset: Int, arrangement: FileBrowseArrangement,
    ): NodeRange = if (arrangement == FileBrowseArrangement())
        children(accessToken, parentId, offset)
    else throw ApiException(501, "Owner Files arrangement unsupported")
    suspend fun childPositionArranged(
        accessToken: String, parentId: Long, nodeId: Long, arrangement: FileBrowseArrangement,
    ): DirectoryItemPosition = if (arrangement == FileBrowseArrangement())
        childPosition(accessToken, parentId, nodeId)
    else throw ApiException(501, "Owner Files position for arrangement unsupported")
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
    /** Atomic Go batch copy/move: one Owner transaction, never per-item retries. */
    suspend fun batchCopyNodes(accessToken: String, originals: List<DriveNode>,
        parentId: Long): List<DriveNode> =
        throw ApiException(501, "Atomic batch copy unavailable")
    suspend fun batchMoveNodes(accessToken: String, originals: List<DriveNode>,
        parentId: Long): List<DriveNode> =
        throw ApiException(501, "Atomic batch move unavailable")
    suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
        throw ApiException(501, "Batch Trash API unavailable")
    }
    /** Stream a single Owner file into a caller-owned Android document. Never buffer in memory. */
    suspend fun downloadFile(accessToken: String, node: DriveNode,
        openDestination: () -> OutputStream, onProgress: (Long) -> Unit = {}): Long =
        throw ApiException(501, "Native file download unavailable")
    /** Exact Owner PDF: authenticated, revision-verified temporary byte stream.
     * The caller owns its seekable destination and removal on exit. */
    suspend fun filesPdfDownload(accessToken: String, original: DriveNode,
        openDestination: () -> OutputStream, onProgress: (Long) -> Unit = {}): Long =
        throw ApiException(501, "Native PDF preview unavailable")
    /** One manual file, current verified Owner directory. No new content writer. */
    suspend fun uploadFile(accessToken: String, parent: DriveNode, name: String, size: Long,
        openSource: () -> InputStream, onProgress: (Long) -> Unit = {}): DriveNode =
        throw ApiException(501, "Native upload unavailable")
    /** Android Photo only: immutable original hash and per-intent idempotency
     * key are committed before POST /uploads. Other client/fixtures may keep
     * the old uploadFile contract; absent support still fails UNKNOWN safely. */
    suspend fun uploadNativePhotoOriginal(
        accessToken: String, parent: DriveNode, name: String, size: Long,
        originalSha256: String, resumeKey: String,
        openSource: () -> InputStream, onProgress: (Long) -> Unit = {},
    ): DriveNode = uploadFile(accessToken, parent, name, size, openSource, onProgress)

    /** Owner-JWT read-only exact lookup: null = ACTIVE / no finalized proof.
     * Missing/expired/ambiguous responses throw and NEVER authorize replay. */
    suspend fun inspectNativePhotoUpload(
        accessToken: String, parentId: Long, name: String, size: Long,
        originalSha256: String, resumeKey: String,
    ): DriveNode? = throw ApiException(501, "Android photo receipt lookup unavailable")
    /** Validate a current Files node against its authenticated Owner media DTO. */
    suspend fun filesMediaItem(accessToken: String, node: DriveNode): GalleryAsset =
        throw ApiException(501, "Native Files media detail unavailable")
    /** BD09-only 8×8 Owner Map/Cells, gated by signed Server release. */
    suspend fun baiduNativeMapCells(
        accessToken: String, bounds: OwnerBd09Bounds,
    ): OwnerBd09MapCells =
        throw ApiException(501, "Native Owner BD09 map cells unavailable")
    /** Map cell → original sparse Gallery Range, reverified by Go on each
     * page. No WGS84 bounds or client-defined media grant are permitted. */
    suspend fun galleryBd09CellPage(
        accessToken: String, bounds: OwnerBd09Bounds, cell: OwnerBd09Cell,
        offset: Int = 0, sortBy: String = "captured", sortDir: String = "desc",
    ): GalleryPage =
        throw ApiException(501, "Native Owner BD09 cell Gallery Range unavailable")
    /** Exact signed Owner BD09 camera rectangle → the SAME sparse Gallery
     * Range DTO as canonical /media/items. The Server alone verifies signed
     * release, current map epoch and each member's current Node/source GPS.
     * No WGS84 conversion, photo-consent overrides or owner parameters. */
    suspend fun galleryBd09ViewportPage(
        accessToken: String, bounds: OwnerBd09Bounds, offset: Int = 0,
        sortBy: String = "captured", sortDir: String = "desc",
    ): GalleryPage =
        throw ApiException(501, "Native Owner BD09 viewport Gallery Range unavailable")

    /** Bounded 64-point Owner map overview, only read-only GPS metadata. */
    suspend fun placesMapOverview(
        accessToken: String, bounds: OwnerMapBounds, detail: Boolean = false,
    ): OwnerMapOverview =
        throw ApiException(501, "Native Owner Places map overview unavailable")
    suspend fun galleryPage(accessToken: String, offset: Int = 0,
        initialLatest: Boolean = false): GalleryPage =
        throw ApiException(501, "Gallery Owner range unavailable")
    /** Read-only Collections: use the existing PhotoCollection and member-Range APIs. */
    suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> =
        throw ApiException(501, "Gallery albums unavailable")
    /** One Owner-authenticated manual collection creation; no retry or second writer. */
    suspend fun createGalleryManualAlbum(accessToken: String, name: String): GalleryAlbum =
        throw ApiException(501, "Manual album creation unavailable")
    /** Version-fenced manual album edit; does not copy or mutate media bytes. */
    suspend fun renameGalleryManualAlbum(
        accessToken: String, album: GalleryAlbum, name: String,
    ): GalleryAlbum = throw ApiException(501, "Manual album rename unavailable")
    /** Delete collection membership only. Explicit caller confirmation required. */
    suspend fun deleteGalleryManualAlbum(
        accessToken: String, album: GalleryAlbum,
    ) { throw ApiException(501, "Manual album deletion unavailable") }
    /** Optional: the cover Node is resolved by the same Owner Server, never
     * read from Android's local media library or guessed from album members. */
    suspend fun galleryAlbumCover(accessToken: String, album: GalleryAlbum): GalleryAlbumCover? =
        throw ApiException(501, "Gallery album covers unavailable")
    suspend fun galleryAlbumPage(
        accessToken: String, albumId: String, offset: Int = 0,
        initialLatest: Boolean = false,
    ): GalleryPage = throw ApiException(501, "Gallery album range unavailable")
    /** Search uses the same bounded Owner range; no local visible-page filtering. */
    suspend fun gallerySearchPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String): GalleryPage =
        throw ApiException(501, "Gallery Owner search unavailable")
    /** Combined media kind + optional search, authoritative Owner Server Range. */
    suspend fun galleryKindPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String, kind: String): GalleryPage =
        throw ApiException(501, "Gallery Owner kind filter unavailable")
    /** Nondefault iOS PWA sort stays on the authoritative Owner Range. */
    suspend fun gallerySortedPage(accessToken: String, offset: Int, initialLatest: Boolean,
        search: String, kind: String, albumId: String?, sortBy: String, sortDir: String): GalleryPage =
        throw ApiException(501, "Gallery Owner sort unavailable")
    /** Owner-checked, single-attempt metadata action over 1..200 *loaded* Gallery items. */
    suspend fun galleryFavoriteBatch(accessToken: String, items: List<GalleryAsset>,
        favorite: Boolean): Int =
        throw ApiException(501, "Gallery batch favorite unavailable")
    suspend fun galleryTagsBatch(accessToken: String, items: List<GalleryAsset>,
        tags: List<String>): Int =
        throw ApiException(501, "Gallery batch tags unavailable")
    /** Write only a currently loaded Owner selection into an existing manual album. */
    suspend fun galleryAddToManualAlbum(
        accessToken: String, album: GalleryAlbum, items: List<GalleryAsset>,
    ): GalleryAlbum = throw ApiException(501, "Gallery album write unavailable")
    /** One verified Owner member of a manual PhotoCollection; no file deletion. */
    suspend fun galleryRemoveFromManualAlbum(
        accessToken: String, album: GalleryAlbum, item: GalleryAsset,
    ): GalleryAlbum = throw ApiException(501, "Manual album member removal unavailable")
    /** Set an existing member as custom cover, or 0 to restore automatic cover. */
    suspend fun gallerySetManualAlbumCover(
        accessToken: String, album: GalleryAlbum, nodeId: Long,
    ): GalleryAlbum = throw ApiException(501, "Manual album cover editing unavailable")
    suspend fun galleryThumbnail(accessToken: String, nodeId: Long, revision: Long): ByteArray =
        throw ApiException(501, "Gallery thumbnail unavailable")
    /** Read-only audio: same Range/ETag/Bearer transport as native video,
     * but the current file must first be re-verified against the Owner tree. */
    suspend fun filesAudioPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback =
        throw ApiException(501, "Native Owner audio unavailable")
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

    override suspend fun verifiedOwnerIdentity(accessToken: String): NativeServerOwnerIdentity {
        val data = request("me", accessToken)
        val identity = try {
            val mustChange = data["must_change_password"]
            if (mustChange != JsonPrimitive(false)) invalidPayload()
            NativeServerOwnerIdentity(
                id = data.long("id"),
                username = data.string("username"),
                role = data.string("role"),
                instanceId = data.string("pwa_offline_instance_id"),
            )
        } catch (invalid: IllegalArgumentException) {
            invalidPayload()
        }
        return identity
    }

    override suspend fun registerNativeAndroidDevice(
        accessToken: String, displayName: String, clientVersion: String,
    ): NativeAndroidDeviceEnrollment {
        // POST /devices creates a real Owner record and returns its credential
        // exactly once; a lost ACK is ambiguous and MUST NOT be auto-replayed.
        require(displayName.isNotBlank() && displayName == displayName.trim() &&
            displayName.toByteArray(Charsets.UTF_8).size <= 128 &&
            displayName.none { it.isISOControl() } &&
            clientVersion.length <= 64 && clientVersion.none { it.isISOControl() })
        val response = request("devices", accessToken, values = mapOf(
            "name" to displayName,
            "platform" to "android",
            "client_version" to clientVersion,
        ))
        val raw = response["device"] as? JsonObject ?: invalidPayload()
        val enrollment = try {
            if (raw.string("platform") != "android" ||
                raw.string("name") != displayName ||
                (raw.optionalString("client_version") ?: "") != clientVersion ||
                raw["revoked_at"] != null) invalidPayload()
            NativeAndroidDeviceEnrollment(
                deviceId = raw.string("id"),
                deviceToken = response.string("device_token"),
                displayName = displayName,
                clientVersion = clientVersion,
            )
        } catch (_: IllegalArgumentException) {
            invalidPayload()
        }
        return enrollment
    }

    override suspend fun verifyNativeAndroidDevice(
        accessToken: String, enrolled: NativeAndroidDeviceEnrollment,
    ) {
        val result = request("devices/self", accessToken,
            deviceIdentity = enrolled)
        // Go returns only one Owner-bound, unrevoked identity proof.
        if (result.size != 1 || result.string("device_id") != enrolled.deviceId)
            invalidPayload()
    }

    override suspend fun root(accessToken: String): DriveNode = node(request("nodes/root", accessToken)).also {
        if (!it.isDirectory || it.parentId != null) invalidPayload()
    }

    override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange =
        childrenArranged(accessToken, parentId, offset, FileBrowseArrangement())

    override suspend fun childrenArranged(
        accessToken: String, parentId: Long, offset: Int, arrangement: FileBrowseArrangement,
    ): NodeRange {
        require(parentId > 0 && offset >= 0) { "Invalid directory range" }
        val query = mapOf("offset" to "$offset", "limit" to "100",
            "sort" to arrangement.sort, "order" to arrangement.order,
            "group" to arrangement.group,
            "folders_first" to arrangement.foldersFirst.toString(),
            "include_count" to "true")
        val result = request("nodes/$parentId/children", accessToken, query = query)
        // Do not silently show a different Server ordering as if sort succeeded.
        if ((result["sort"] != null || arrangement.sort != "name") &&
            result.string("sort") != arrangement.sort) invalidPayload()
        if ((result["order"] != null || arrangement.order != "asc") &&
            result.string("order") != arrangement.order) invalidPayload()
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

        val rawGroups = result["groups"]
        val groups = if (arrangement.group != "none" && offset == 0) {
            // Go omits an empty group's optional JSON field (omitempty).
            val entries = when (rawGroups) {
                null, JsonNull -> if (count == 0L) JsonArray(emptyList()) else invalidPayload()
                is JsonArray -> rawGroups
                else -> invalidPayload()
            }
            if (entries.size > 25_000 || entries.size.toLong() > count) invalidPayload()
            val keys = HashSet<String>()
            var next = 0L
            entries.map { raw ->
                val group = raw as? JsonObject ?: invalidPayload()
                val key = group.string("key")
                val start = group.long("start_index")
                val size = group.long("item_count")
                if (!validFilesGroupKey(arrangement.group, key) ||
                    !keys.add(key) || start != next || size <= 0 || size > count - next)
                    invalidPayload()
                next += size
                FileBrowseGroupIndex(key, size, start)
            }.also { if (next != count) invalidPayload() }
        } else {
            if (rawGroups != null && rawGroups != JsonNull &&
                (rawGroups !is JsonArray || rawGroups.isNotEmpty()))
                invalidPayload()
            emptyList()
        }
        return NodeRange(items, count, offset, groups = groups)
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
    ): DirectoryItemPosition =
        childPositionArranged(accessToken, parentId, nodeId, FileBrowseArrangement())

    override suspend fun childPositionArranged(
        accessToken: String, parentId: Long, nodeId: Long, arrangement: FileBrowseArrangement,
    ): DirectoryItemPosition {
        require(parentId > 0 && nodeId > 0 && validToken(accessToken))
        val result = request("nodes/$parentId/children/position", accessToken, query = mapOf(
            "node_id" to nodeId.toString(), "sort" to arrangement.sort,
            "order" to arrangement.order, "group" to arrangement.group,
            "folders_first" to arrangement.foldersFirst.toString(),
        ))
        val index = result.long("index")
        val revision = result.long("revision")
        if (result.long("node_id") != nodeId || revision <= 0 ||
            index < 0 || index > Int.MAX_VALUE ||
            result.string("sort") != arrangement.sort ||
            result.string("order") != arrangement.order ||
            result.string("group") != arrangement.group ||
            result["folders_first"] != JsonPrimitive(arrangement.foldersFirst)) invalidPayload()
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

    /** Reuse the existing authenticated JSON transport and the Server's
     * atomic 200-item transaction. Validation after ACK must fail closed:
     * Controller will freeze writes if any returned identity is inconsistent.
     * Never replay a POST after timeout or an uncertain acknowledgement. */
    override suspend fun batchCopyNodes(
        accessToken: String, originals: List<DriveNode>, parentId: Long,
    ): List<DriveNode> = batchTransfer(accessToken, originals, parentId, "copy")

    override suspend fun batchMoveNodes(
        accessToken: String, originals: List<DriveNode>, parentId: Long,
    ): List<DriveNode> = batchTransfer(accessToken, originals, parentId, "move")

    private suspend fun batchTransfer(
        token: String, originals: List<DriveNode>, parentId: Long, operation: String,
    ): List<DriveNode> {
        require(operation in setOf("copy", "move") && validToken(token) &&
            parentId > 0 && originals.size in 1..200 &&
            originals.map { it.id }.toSet().size == originals.size &&
            originals.all { it.id > 0 && it.parentId != null &&
                it.revision > 0 && it.type in setOf("file", "dir") &&
                !(it.isDirectory && it.id == parentId) }) {
            "Invalid atomic batch"
        }
        if (operation == "move") require(originals.none { it.parentId == parentId }) {
            "Source is already in target folder"
        }
        val requestItems = JsonArray(originals.map { original ->
            JsonObject(mapOf("id" to JsonPrimitive(original.id),
                "revision" to JsonPrimitive(original.revision)))
        })
        val body = JsonObject(mapOf(
            "items" to requestItems, "parent_id" to JsonPrimitive(parentId)))
        // Copying large directory trees may outlive the ordinary 30s JSON
        // timeout. Keep the original pinned Owner/TLS client, but extend the
        // bounded idle timeout for this one physical transaction, never retry.
        val answer = request("nodes/batch/$operation", token, bodyObject = body,
            longRunning = true)
        val operationID = answer.string("operation_id")
        if (operationID.isBlank() || operationID.length > 64) invalidPayload()
        val returned = answer["items"] as? JsonArray ?: invalidPayload()
        if (returned.size != originals.size) invalidPayload()
        val rows = returned.map { node(it as? JsonObject ?: invalidPayload()) }
        if (rows.map { it.id }.toSet().size != rows.size) invalidPayload()
        val originalsIds = originals.map { it.id }.toSet()
        for ((index, row) in rows.withIndex()) {
            val original = originals[index]
            if (row.parentId != parentId || row.type != original.type ||
                row.size != original.size || row.revision <= 0) invalidPayload()
            if (operation == "copy") {
                if (row.id in originalsIds) invalidPayload()
            } else if (row.id != original.id || row.name != original.name ||
                row.revision <= original.revision) invalidPayload()
        }
        return rows
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


    /** The PdfRenderer requires seekable storage. Both Node checks and the
     * existing ETag/optional SHA/length-verified download are Owner-scoped. */
    override suspend fun filesPdfDownload(
        accessToken: String, original: DriveNode,
        openDestination: () -> OutputStream, onProgress: (Long) -> Unit,
    ): Long {
        require(original.id > 0 && original.parentId != null &&
            original.type == "file" && original.revision > 0 &&
            original.name.endsWith(".pdf", ignoreCase = true) &&
            original.size in 1L..(64L * 1024 * 1024) && validToken(accessToken))
        suspend fun verify() {
            val current = node(request("nodes/${original.id}", accessToken))
            if (current != original) invalidPayload()
        }
        verify()
        val written = downloadFile(accessToken, original, openDestination, onProgress)
        if (written != original.size) invalidPayload()
        verify()
        return written
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
        NativeUploadAdmission.withWriter {
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
        } // NativeUploadAdmission.withWriter: permit after network cleanup.
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


    /** One bounded Owner-only list, including imported, manual and smart albums.
     * Reject a malformed list rather than silently displaying a false empty Collection. */
    /** The media-kind/Live/thumbnail data comes from Go, never the filename. */
    override suspend fun filesMediaItem(accessToken: String, original: DriveNode): GalleryAsset {
        require(original.id > 0 && original.parentId != null && original.revision > 0 &&
            original.type == "file" && original.size > 0 && validToken(accessToken))
        val detail = request("media/items/${original.id}", accessToken)
        val owned = node(detail["node"] as? JsonObject ?: invalidPayload())
        if (owned.id != original.id || owned.parentId != original.parentId ||
            owned.name != original.name || owned.revision != original.revision ||
            owned.size != original.size || owned.type != "file") invalidPayload()
        val metadata = detail["metadata"] as? JsonObject ?: invalidPayload()
        val kind = metadata.string("media_kind")
        if (kind !in setOf("image", "video")) invalidPayload()
        val thumbnail = when (metadata["has_thumbnail"]) {
            JsonPrimitive(true) -> true
            JsonPrimitive(false) -> false
            else -> invalidPayload()
        }
        val captured = metadata.optionalString("captured_at") ?: ""
        if (captured.length > 64) invalidPayload()
        val duration = when (metadata["duration_ms"]) {
            null, JsonNull -> 0L
            else -> metadata.long("duration_ms")
        }
        if (duration < 0) invalidPayload()
        val live = when (detail["live_photo"]) {
            null, JsonNull, JsonPrimitive(false) -> false
            JsonPrimitive(true) -> true
            else -> invalidPayload()
        }
        if (live && kind != "image") invalidPayload()
        return GalleryAsset(original, kind, captured, duration, live, thumbnail)
    }

    /** Decode both Owner lists and create ACKs through one strict contract. */
    private fun galleryAlbumDTO(entry: JsonObject): GalleryAlbum {
        val id = entry.string("id")
        val kind = entry.string("kind")
        val name = entry.string("name")
        val revision = entry.long("revision")
        val folder = entry.long("album_folder_id")
        val count = entry.long("item_count")
        val cover = when (entry["cover_node_id"]) {
            null, JsonNull -> null
            else -> entry.long("cover_node_id").also { if (it <= 0) invalidPayload() }
        }
        if (!validGalleryAlbumId(id) ||
            kind !in setOf("folder", "imported", "manual", "smart") ||
            name.isBlank() || name.length > 400 ||
            name.codePointCount(0, name.length) > 200 ||
            name.any { it.isISOControl() } ||
            count < 0 || revision < 0 || folder < 0) invalidPayload()
        return GalleryAlbum(id, kind, name, count, revision, folder, cover)
    }

    override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
        val records = requestArray("media/albums", accessToken)
        if (records.size > 4096) invalidPayload()
        val seen = HashSet<String>()
        return records.map { element ->
            val album = galleryAlbumDTO(element as? JsonObject ?: invalidPayload())
            if (!seen.add(album.id)) invalidPayload()
            album
        }
    }

    /** A single POST to Go PhotoCollection; the Owner list is not synthesized. */
    override suspend fun createGalleryManualAlbum(
        accessToken: String, name: String,
    ): GalleryAlbum {
        val normalized = normalizeGalleryManualAlbumName(name)
            ?: throw IllegalArgumentException("Invalid manual album name")
        require(validToken(accessToken))
        val result = galleryAlbumDTO(request(
            "media/albums", accessToken, values = mapOf("name" to normalized),
        ))
        if (result.kind != "manual" || !result.id.startsWith("manual:") ||
            result.name != normalized || result.revision != 1L ||
            result.itemCount != 0L || result.albumFolderId != 0L ||
            result.coverNodeId != null) invalidPayload()
        return result
    }

    private fun requireEditableManualAlbum(token: String, album: GalleryAlbum) {
        require(validToken(token) && validGalleryAlbumId(album.id) &&
            album.id.startsWith("manual:") && album.kind == "manual" &&
            album.revision > 0 && album.revision < Long.MAX_VALUE) {
            "Invalid Owner manual album identity or revision"
        }
    }

    /** One conditional PATCH, pinned to the real Owner and album revision.
     * A malformed/missing ACK never triggers an implicit replay. */
    override suspend fun renameGalleryManualAlbum(
        accessToken: String, album: GalleryAlbum, name: String,
    ): GalleryAlbum {
        requireEditableManualAlbum(accessToken, album)
        val normalized = normalizeGalleryManualAlbumName(name)
            ?: throw IllegalArgumentException("Invalid manual album name")
        require(normalized != album.name) { "Album name is unchanged" }
        val saved = galleryAlbumDTO(request("media/albums", accessToken,
            values = mapOf("name" to normalized), method = "PATCH",
            ifMatch = album.revision, pathTailSegments = listOf(album.id)))
        if (saved.id != album.id || saved.kind != "manual" ||
            saved.name != normalized || saved.revision != album.revision + 1 ||
            saved.albumFolderId != album.albumFolderId) invalidPayload()
        return saved
    }

    /** One version-fenced DELETE of a manual PhotoCollection; Go preserves the
     * original Owner media Nodes/CAS and removes only the collection relation. */
    override suspend fun deleteGalleryManualAlbum(
        accessToken: String, album: GalleryAlbum,
    ) {
        requireEditableManualAlbum(accessToken, album)
        request("media/albums", accessToken, emptyResponse = true,
            method = "DELETE", ifMatch = album.revision,
            pathTailSegments = listOf(album.id))
    }

    /** Resolve only the real Server-provided cover_node_id. The album list
     * has no cover revision; first request the authenticated current media
     * DTO, then issue an exact revision-fenced, <=4 MiB JPEG thumbnail GET.
     * When the server has no derived thumbnail, show the native placeholder. */
    override suspend fun galleryAlbumCover(
        accessToken: String, album: GalleryAlbum,
    ): GalleryAlbumCover? {
        require(validGalleryAlbumId(album.id)) { "Invalid album identity" }
        val id = album.coverNodeId ?: return null
        require(id > 0 && album.itemCount > 0 && validToken(accessToken))
        val detail = request("media/items/$id", accessToken)
        val owned = node(detail["node"] as? JsonObject ?: invalidPayload())
        val metadata = detail["metadata"] as? JsonObject ?: invalidPayload()
        val kind = metadata.string("media_kind")
        if (owned.id != id || owned.type != "file" || owned.revision <= 0 ||
            kind !in setOf("image", "video")) invalidPayload()
        val thumbnail = when (metadata["has_thumbnail"]) {
            JsonPrimitive(true) -> true
            JsonPrimitive(false) -> false
            else -> invalidPayload()
        }
        if (!thumbnail) return null
        return GalleryAlbumCover(id, owned.revision,
            galleryThumbnail(accessToken, id, owned.revision))
    }

    override suspend fun galleryAlbumPage(
        accessToken: String, albumId: String, offset: Int,
        initialLatest: Boolean,
    ): GalleryPage {
        require(validGalleryAlbumId(albumId)) { "Invalid gallery album identifier" }
        return ownerGalleryPage(accessToken, offset, initialLatest, "", albumId = albumId)
    }

    /** Same Owner Bearer/Origin and bounded JSON transport as Files, with the
     * Server's exact iOS Gallery chronological tail and sparse Range contract. */
    /** Only the existing signed-release-fenced Owner Map/Cells API can
     * attest that coordinates are official persisted BD09LL. Never apply an
     * inferred WGS84 conversion or send an SDK/browser key in this request. */
    /** One Server-authorized, version-fenced map-cell Gallery Range.
     * The Server compares the exact representative to its fresh 8x8 summary
     * before/after SQL and rejects a stale cell with 409. Do not query the
     * general /media/items endpoint, guess GPS coordinates or pass an Owner ID. */
    override suspend fun galleryBd09CellPage(
        accessToken: String, bounds: OwnerBd09Bounds, cell: OwnerBd09Cell,
        offset: Int, sortBy: String, sortDir: String,
    ): GalleryPage {
        require(validToken(accessToken) && bounds.valid() &&
            cell.cellX in 0..7 && cell.cellY in 0..7 &&
            cell.photoCount > 0 && cell.assetId > 0 && cell.nodeId > 0 &&
            cell.nodeRevision > 0 && bounds.contains(cell.latitude, cell.longitude) &&
            offset in 0..10_000_000 &&
            sortBy in setOf("captured", "added") && sortDir in setOf("asc", "desc")) {
            "Invalid Owner BD09 map cell range"
        }
        val query = mapOf(
            "west" to bounds.west.toString(),
            "south" to bounds.south.toString(),
            "east" to bounds.east.toString(),
            "north" to bounds.north.toString(),
            "cell_x" to cell.cellX.toString(),
            "cell_y" to cell.cellY.toString(),
            "asset_id" to cell.assetId.toString(),
            "node_id" to cell.nodeId.toString(),
            "node_revision" to cell.nodeRevision.toString(),
            "photo_count" to cell.photoCount.toString(),
            "range" to "true", "limit" to "60",
            "offset" to offset.toString(),
            "sort_by" to sortBy, "sort_dir" to sortDir,
        )
        val result = request("media/places/baidu-jsapi/cell-items",
            accessToken, query = query)
        return parseGalleryRange(result, offset, false, "", sortBy, sortDir,
            maxTotalCount = cell.photoCount)
    }

    /** Read a signed BD09 camera viewport using the existing original Owner
     * Gallery media range; never silently widen to the global /media/items. */
    override suspend fun galleryBd09ViewportPage(
        accessToken: String, bounds: OwnerBd09Bounds,
        offset: Int, sortBy: String, sortDir: String,
    ): GalleryPage {
        require(validToken(accessToken) && bounds.valid() &&
            offset in 0..10_000_000 &&
            sortBy in setOf("captured", "added") &&
            sortDir in setOf("asc", "desc")) { "Invalid BD09 Gallery viewport" }
        val response = request("media/places/baidu-jsapi/viewport-items",
            accessToken, query = mapOf(
                "west" to bounds.west.toString(),
                "south" to bounds.south.toString(),
                "east" to bounds.east.toString(),
                "north" to bounds.north.toString(),
                "limit" to "60", "offset" to offset.toString(),
                "range" to "true", "sort_by" to sortBy, "sort_dir" to sortDir,
            ))
        return parseGalleryRange(response, offset, false, "", sortBy, sortDir)
    }

    override suspend fun baiduNativeMapCells(
        accessToken: String, bounds: OwnerBd09Bounds,
    ): OwnerBd09MapCells {
        require(bounds.valid() && validToken(accessToken)) { "Invalid BD09 viewport" }
        val result = request("media/places/baidu-jsapi/cells", accessToken, query = mapOf(
            "west" to bounds.west.toString(), "south" to bounds.south.toString(),
            "east" to bounds.east.toString(), "north" to bounds.north.toString(),
        ))
        if (result.string("coordinate_space") != "bd09ll" ||
            result.string("index_scope") != "owner_gps_auto_index" ||
            result.long("grid_columns") != 8L || result.long("grid_rows") != 8L)
            invalidPayload()
        val total = result.long("total_count")
        if (total < 0L) invalidPayload()
        val raw = result["cells"] as? JsonArray ?: invalidPayload()
        if (raw.size > 64) invalidPayload()
        val buckets = HashSet<Pair<Int, Int>>()
        val assetIds = HashSet<Long>()
        val nodeIds = HashSet<Long>()
        var sum = 0L
        fun JsonObject.bd09Coordinate(field: String, min: Double, max: Double): Double {
            val value = this[field] as? JsonPrimitive ?: invalidPayload()
            if (value.isString) invalidPayload()
            val coordinate = value.doubleOrNull ?: invalidPayload()
            if (!coordinate.isFinite() || coordinate < min || coordinate > max)
                invalidPayload()
            return coordinate
        }
        val cells = raw.map { element ->
            val cell = element as? JsonObject ?: invalidPayload()
            // The endpoint's historical 8 fields do not export original GPS,
            // photo bytes, unverified media-kind or arbitrary derived metadata.
            if (cell.keys != setOf("cell_x", "cell_y", "photo_count", "asset_id",
                    "node_id", "node_revision", "latitude", "longitude"))
                invalidPayload()
            val cx = cell.long("cell_x")
            val cy = cell.long("cell_y")
            val count = cell.long("photo_count")
            val assetId = cell.long("asset_id")
            val nodeId = cell.long("node_id")
            val revision = cell.long("node_revision")
            val latitude = cell.bd09Coordinate("latitude", -90.0, 90.0)
            val longitude = cell.bd09Coordinate("longitude", -180.0, 180.0)
            if (cx !in 0L..7L || cy !in 0L..7L ||
                !buckets.add(cx.toInt() to cy.toInt()) ||
                assetId <= 0 || nodeId <= 0 || revision <= 0 ||
                !assetIds.add(assetId) || !nodeIds.add(nodeId) ||
                !bounds.contains(latitude, longitude) ||
                count <= 0 || sum > total - count)
                invalidPayload()
            sum += count
            OwnerBd09Cell(cx.toInt(), cy.toInt(), count, assetId,
                nodeId, revision, latitude, longitude)
        }
        if (sum != total || (total == 0L) != cells.isEmpty()) invalidPayload()
        return OwnerBd09MapCells(cells, total)
    }

    override suspend fun placesMapOverview(
        accessToken: String, bounds: OwnerMapBounds, detail: Boolean,
    ): OwnerMapOverview {
        require(bounds.valid() && validToken(accessToken)) {
            "Invalid private map overview request"
        }
        val response = request("media/places/overview", accessToken, query = mapOf(
            "west" to bounds.west.toString(), "south" to bounds.south.toString(),
            "east" to bounds.east.toString(), "north" to bounds.north.toString(),
            "detail" to if (detail) "1" else "0",
        ))
        val rawAggregate = response["aggregated"] as? JsonPrimitive ?: invalidPayload()
        if (rawAggregate.isString) invalidPayload()
        val aggregated = rawAggregate.booleanOrNull ?: invalidPayload()
        val count = response.long("total_photo_count")
        if (count < 0L) invalidPayload()
        val rawItems = response["items"] as? JsonArray ?: invalidPayload()
        if (rawItems.size > 64) invalidPayload()
        val ids = HashSet<String>()
        var sum = 0L
        fun JsonObject.finiteCoordinate(key: String, min: Double, max: Double): Double {
            val primitive = this[key] as? JsonPrimitive ?: invalidPayload()
            if (primitive.isString) invalidPayload()
            val value = primitive.doubleOrNull ?: invalidPayload()
            if (!value.isFinite() || value < min || value > max) invalidPayload()
            return value
        }
        val items = rawItems.map { entry ->
            val item = entry as? JsonObject ?: invalidPayload()
            val id = item.string("id")
            val kind = item.string("coordinate_kind")
            val name = item.string("name")
            if (id.isBlank() || id.length > 512 || id.any { it.isISOControl() } ||
                name.isBlank() || name.length > 512 || name.any { it.isISOControl() } ||
                !ids.add(id) ||
                kind != (if (aggregated) "map_region_sample" else "grid_cell_center") ||
                !id.startsWith(if (aggregated) "map-region:q:" else "place:"))
                invalidPayload()
            val sampleLat = item.finiteCoordinate("sample_latitude", -90.0, 90.0)
            val sampleLon = item.finiteCoordinate("sample_longitude", -180.0, 180.0)
            val lat = item.finiteCoordinate("latitude", -90.0, 90.0)
            val lon = item.finiteCoordinate("longitude", -180.0, 180.0)
            if (!bounds.contains(sampleLat, sampleLon) ||
                (aggregated && (lat != sampleLat || lon != sampleLon)))
                invalidPayload()
            val itemCount = item.long("item_count")
            if (itemCount <= 0L || sum > count - itemCount) invalidPayload()
            sum += itemCount
            val coverId = when (val cover = item["cover_node_id"]) {
                null, JsonNull -> null
                is JsonPrimitive -> if (!cover.isString) cover.longOrNull else null
                else -> null
            }
            if (item["cover_node_id"] != null && item["cover_node_id"] != JsonNull &&
                (coverId == null || coverId <= 0L)) invalidPayload()
            OwnerMapSample(id, name, sampleLat, sampleLon, lat, lon,
                kind, itemCount, coverId)
        }
        if (sum != count || (!aggregated && !detail) || (count == 0L) != items.isEmpty())
            invalidPayload()
        return OwnerMapOverview(items, count, aggregated)
    }

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

    /** Reuse the existing Owner-authenticated media Range, including album scopes. */
    override suspend fun gallerySortedPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String, kind: String, albumId: String?,
        sortBy: String, sortDir: String): GalleryPage {
        require(sortBy in setOf("captured", "added") && sortDir in setOf("asc", "desc"))
        require(kind in setOf("", "image", "video") && search.length <= 200 &&
            search == search.trim())
        if (albumId != null) require(validGalleryAlbumId(albumId))
        return ownerGalleryPage(accessToken, offset, initialLatest, search, kind, albumId,
            sortBy, sortDir)
    }

    private suspend fun ownerGalleryPage(accessToken: String, offset: Int,
        initialLatest: Boolean, search: String, mediaKind: String = "",
        albumId: String? = null, sortBy: String = "captured",
        sortDir: String = "asc"): GalleryPage {
        require(offset >= 0 && (!initialLatest || offset == 0))
        val query = mutableMapOf(
            "range" to "true", "limit" to "60", "offset" to offset.toString(),
            "sort_by" to sortBy, "sort_dir" to sortDir,
            "unknown_first" to "true", "fold_duplicates" to "true",
        )
        // Descending already starts with the newest item at offset zero.
        if (initialLatest && sortDir == "asc") query["initial_position"] = "latest"
        if (search.isNotEmpty()) query["q"] = search
        if (mediaKind.isNotEmpty()) query["kind"] = mediaKind
        val result = if (albumId == null) request("media/items", accessToken, query = query)
            else request("media/albums", accessToken, query = query,
                pathTailSegments = listOf(albumId, "items"))
        return parseGalleryRange(result, offset, initialLatest,
            mediaKind, sortBy, sortDir)
    }

    /** One validated original Owner Gallery DTO for normal Gallery and
     * signed map-cell Range alike. Never implement a second media parser. */
    private fun parseGalleryRange(
        result: JsonObject, offset: Int, initialLatest: Boolean,
        mediaKind: String, sortBy: String, sortDir: String,
        maxTotalCount: Long? = null,
    ): GalleryPage {
        val raw = result["items"] as? JsonArray ?: invalidPayload()
        if (raw.size > 60) invalidPayload()
        val total = result.long("total_count")
        val returnedOffset = result.long("offset")
        val limit = result.long("limit")
        if (total < 0 || (maxTotalCount != null && total > maxTotalCount) ||
            returnedOffset < 0 || returnedOffset > Int.MAX_VALUE ||
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
            // Go mediaItemDTO explicitly emits favorite on every real Owner row.
            // Absent old fixture/client fields remain unknown, not assumed false.
            val favorite = when (entry["favorite"]) {
                null, JsonNull -> null
                JsonPrimitive(true) -> true
                JsonPrimitive(false) -> false
                else -> invalidPayload()
            }
            GalleryAsset(itemNode, kind, captured, duration, live, hasThumb,
                favorite = favorite)
        }
        if (items.map { it.node.id }.toSet().size != items.size ||
            (total > returnedOffset && items.isEmpty())) invalidPayload()
        return GalleryPage(items, total, returnedOffset.toInt(), 60,
            if (sortBy == "captured" && sortDir == "asc")
                parseGalleryTimelineSets(result["timeline_group_sets"], total) else null)
    }

    /** Android Selection Mode reuses the existing Go/PWA Owner batch favorite API.
     * Only a validated current loaded Node snapshot is accepted. Metadata PATCH
     * is sent exactly once: lost ACK is never a reason to replay the mutation. */
    override suspend fun galleryFavoriteBatch(
        accessToken: String, items: List<GalleryAsset>, favorite: Boolean,
    ): Int {
        require(validToken(accessToken) && items.size in 1..200 &&
            items.map { it.node.id }.toSet().size == items.size &&
            items.all { it.node.id > 0 && it.node.revision > 0 &&
                it.node.type == "file" && it.mediaKind in setOf("image", "video") }) {
            "Invalid Owner media selection"
        }
        val body = JsonObject(mapOf(
            "node_ids" to JsonArray(items.map { JsonPrimitive(it.node.id) }),
            "favorite" to JsonPrimitive(favorite),
        ))
        val answer = request("media/batch/favorite", accessToken,
            bodyObject = body, method = "PATCH")
        val updated = answer.long("updated")
        if (updated != items.size.toLong() ||
            answer["favorite"] != JsonPrimitive(favorite)) invalidPayload()
        return items.size
    }

    /** One irreversible network attempt even though adding labels is benign.
     * Keep any uncertain POST ACK frozen until a read-only Owner refresh. */
    override suspend fun galleryTagsBatch(
        accessToken: String, items: List<GalleryAsset>, tags: List<String>,
    ): Int {
        require(validToken(accessToken) && items.size in 1..200 &&
            items.map { it.node.id }.toSet().size == items.size &&
            items.all { it.node.id > 0 && it.node.revision > 0 &&
                it.node.type == "file" && it.mediaKind in setOf("image", "video") }) {
            "Invalid Owner media selection"
        }
        val normalized = parseGalleryTagInput(tags.joinToString(","))
            ?: throw IllegalArgumentException("Invalid tags")
        val payload = JsonObject(mapOf(
            "node_ids" to JsonArray(items.map { JsonPrimitive(it.node.id) }),
            "tags" to JsonArray(normalized.map { JsonPrimitive(it) }),
        ))
        val answer = request("media/batch/tags", accessToken, bodyObject = payload)
        if (answer.long("updated") != items.size.toLong()) invalidPayload()
        val returned = answer["tags"] as? JsonArray ?: invalidPayload()
        val labels = returned.map {
            (it as? JsonPrimitive)?.takeIf { value -> value.isString }?.content
                ?: invalidPayload()
        }
        if (labels != normalized) invalidPayload()
        return items.size
    }

    /** Single POST against the current Owner, with a real collection If-Match.
     * A missing or invalid ACK must never trigger a second write. */
    override suspend fun galleryAddToManualAlbum(
        accessToken: String, album: GalleryAlbum, items: List<GalleryAsset>,
    ): GalleryAlbum {
        require(validToken(accessToken) && album.kind == "manual" &&
            album.id.startsWith("manual:") && validGalleryAlbumId(album.id) &&
            album.revision > 0 && album.revision < Long.MAX_VALUE - 1 &&
            album.itemCount >= 0 && album.itemCount <= Long.MAX_VALUE - items.size &&
            items.size in 1..200 && items.map { it.node.id }.toSet().size == items.size &&
            items.all { it.node.id > 0 && it.node.revision > 0 &&
                it.node.type == "file" && it.mediaKind in setOf("image", "video") }) {
            "Invalid Owner album selection"
        }
        val body = JsonObject(mapOf(
            "node_ids" to JsonArray(items.map { JsonPrimitive(it.node.id) }),
        ))
        val response = request(
            "media/albums", accessToken, bodyObject = body, ifMatch = album.revision,
            pathTailSegments = listOf(album.id, "items"),
        )
        val id = response.string("id")
        val kind = response.string("kind")
        val name = response.string("name")
        val revision = response.long("revision")
        val count = response.long("item_count")
        val folder = response.long("album_folder_id")
        val cover = when (response["cover_node_id"]) {
            null, JsonNull -> null
            else -> response.long("cover_node_id").also { if (it <= 0) invalidPayload() }
        }
        if (id != album.id || kind != "manual" || name != album.name ||
            revision !in album.revision..(album.revision + 1) ||
            count !in album.itemCount..(album.itemCount + items.size) ||
            folder != album.albumFolderId) invalidPayload()
        return GalleryAlbum(id, kind, name, count, revision, folder, cover)
    }

    /** Single Server DELETE of collection membership, not the original media.
     * A missing or stale ACK is never a reason to replay the mutation. */
    override suspend fun galleryRemoveFromManualAlbum(
        accessToken: String, album: GalleryAlbum, item: GalleryAsset,
    ): GalleryAlbum {
        require(validToken(accessToken) && validGalleryAlbumId(album.id) &&
            album.id.startsWith("manual:") && album.kind == "manual" &&
            album.revision > 0 && album.revision < Long.MAX_VALUE &&
            album.itemCount > 0 &&
            item.node.id > 0 && item.node.revision > 0 &&
            item.node.type == "file" && item.mediaKind in setOf("image", "video")) {
            "Invalid Owner album member"
        }
        val saved = galleryAlbumDTO(request(
            "media/albums", accessToken, method = "DELETE",
            ifMatch = album.revision,
            pathTailSegments = listOf(album.id, "items", item.node.id.toString()),
        ))
        // The selected item must have been a real loaded member. Go returns the
        // old revision on no-op: never report a verified removal in that case.
        if (saved.id != album.id || saved.kind != "manual" ||
            saved.name != album.name || saved.albumFolderId != album.albumFolderId ||
            saved.itemCount != album.itemCount - 1 ||
            saved.revision != album.revision + 1) invalidPayload()
        return saved
    }

    /** Go permits only a current manual-album member as custom cover.
     * The zero sentinel resets to automatic cover, not an absent picture.
     * No Owner reads or writes are routed through the device media store. */
    override suspend fun gallerySetManualAlbumCover(
        accessToken: String, album: GalleryAlbum, nodeId: Long,
    ): GalleryAlbum {
        require(validToken(accessToken) && validGalleryAlbumId(album.id) &&
            album.kind == "manual" && album.id.startsWith("manual:") &&
            album.revision > 0 && album.revision < Long.MAX_VALUE &&
            album.itemCount >= 0 && nodeId >= 0 &&
            (nodeId == 0L || album.itemCount > 0)) {
            "Invalid manual album cover target"
        }
        val payload = JsonObject(mapOf("node_id" to JsonPrimitive(nodeId)))
        val saved = galleryAlbumDTO(request("media/albums", accessToken,
            bodyObject = payload, method = "PUT", ifMatch = album.revision,
            pathTailSegments = listOf(album.id, "cover")))
        // Go returns the same revision for an idempotent request. The automatic
        // choice can still use a real first-media cover, so reset does not
        // demand cover_node_id=null.
        if (saved.id != album.id || saved.kind != "manual" ||
            saved.name != album.name || saved.albumFolderId != album.albumFolderId ||
            saved.itemCount != album.itemCount ||
            saved.revision !in album.revision..(album.revision + 1) ||
            (nodeId > 0 && saved.coverNodeId != nodeId)) invalidPayload()
        return saved
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

    /** A private audio session must never trust stale Files rows or redirect
     * Media3 to a second host. Reuse the existing exact-URL, Bearer, ETag
     * and bounded Range checks already exercised for native Gallery video. */
    override suspend fun filesAudioPlayback(
        accessToken: String, original: DriveNode,
    ): OwnerVideoPlayback {
        require(original.id > 0 && original.parentId != null &&
            original.type == "file" && original.size > 0 &&
            original.revision > 0 && validToken(accessToken))
        val latest = node(request("nodes/${original.id}", accessToken))
        if (latest != original) invalidPayload()
        val url = address.url.toHttpUrlOrNull()!!.newBuilder()
            .addPathSegments("api/v1/files/" + original.id + "/content").build()
        return ownerVideoPlayback(http, url, accessToken, original)
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
        pathTailSegments: List<String> = emptyList(),
        deviceIdentity: NativeAndroidDeviceEnrollment? = null,
    ): JsonObject = requestElement(path, accessToken, values, query, emptyResponse, method,
        ifMatch, numberValues, bodyObject, longRunning, pathTailSegments, deviceIdentity)
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
        pathTailSegments: List<String> = emptyList(),
        deviceIdentity: NativeAndroidDeviceEnrollment? = null,
    ): JsonElement {
        // Device headers are allowed on exactly one read-only identity route.
        // A token never appears in the query, URI, body or ordinary API calls.
        require(deviceIdentity == null ||
            (path == "devices/self" && accessToken != null && method == null &&
                values == null && query.isEmpty() && ifMatch == null &&
                numberValues.isEmpty() && bodyObject == null &&
                !longRunning && pathTailSegments.isEmpty())) {
            "Device credentials may only be used for the current Owner identity GET"
        }
        val url = address.url.toHttpUrlOrNull()!!.newBuilder().addPathSegments("api/v1/$path").apply {
            // Authenticated album IDs may be opaque (including reserved characters):
            // append each as ONE encoded path segment, never URL interpolation.
            pathTailSegments.forEach { addPathSegment(it) }
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
        if (deviceIdentity != null) {
            builder.header("X-XDrive-Device-ID", deviceIdentity.deviceId)
            builder.header("X-XDrive-Device-Token", deviceIdentity.deviceToken)
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
                "PUT" -> builder.put(payload)
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
