package com.tfluid.xdrive

import android.content.ContentResolver
import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Stable page anchor. Date and ID are ordered in descending MediaStore order. */
internal data class NativeLocalPageKey(val addedAtSeconds: Long, val id: Long)

/** Fail closed if an OEM provider ignores the keyset predicate or SQL order. */
internal fun nativeLocalStrictPageOrder(
    after: NativeLocalPageKey?,
    page: List<NativeLocalPageKey>,
): Boolean {
    var previous = after
    for (item in page) {
        if (item.id <= 0 || item.addedAtSeconds < 0) return false
        val prior = previous
        if (prior != null && (item.addedAtSeconds > prior.addedAtSeconds ||
                (item.addedAtSeconds == prior.addedAtSeconds && item.id >= prior.id)))
            return false
        previous = item
    }
    return true
}

/** Local read-only MediaStore asset: never an authenticated Server PhotoAsset. */
internal data class NativeLocalMedia(
    val id: Long,
    val uri: Uri,
    val isVideo: Boolean,
    val albumId: String,
    val albumName: String,
    val addedAtSeconds: Long = 0,
) {
    val pageKey: NativeLocalPageKey get() = NativeLocalPageKey(addedAtSeconds, id)
}

internal data class NativeLocalAlbum(
    val id: String,
    val title: String,
    val count: Int,
    val cover: NativeLocalMedia,
)

internal data class NativeLocalAlbumScan(
    val albums: List<NativeLocalAlbum>,
    val truncated: Boolean,
    val scanned: Int,
)

/** Exact per-query bounds; never request original bytes to render a photo wall. */
internal object NativeLocalMediaStore {
    const val PHOTO_PAGE_SIZE = 64
    const val ALBUM_PAGE_SIZE = 32
    const val SCAN_BATCH_SIZE = 512
    const val MAX_SCAN = 115_200
    const val MAX_ALBUMS = 4096
    const val MAX_WALL_ITEMS = 512

    private val uri: Uri get() = MediaStore.Files.getContentUri("external")
    private val columns = arrayOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.MEDIA_TYPE,
        MediaStore.Files.FileColumns.DATE_ADDED,
        MediaStore.MediaColumns.IS_PENDING,
        MediaStore.Images.ImageColumns.BUCKET_ID,
        MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME,
    )

    /**
     * Keyset paging never reuses a shifting OFFSET when new photos arrive,
     * and never counts an OEM provider's repeated first page as new assets.
     * All filters are bound and all reads stay within an explicit row limit.
     */
    suspend fun pageAfter(
        resolver: ContentResolver,
        after: NativeLocalPageKey? = null,
        limit: Int = PHOTO_PAGE_SIZE,
        albumId: String? = null,
    ): List<NativeLocalMedia> = withContext(Dispatchers.IO) {
        require(limit in 1..SCAN_BATCH_SIZE)
        require(after == null || (after.id > 0 && after.addedAtSeconds >= 0))
        require(albumId == null || albumId.isNotBlank())

        val idColumn = MediaStore.Files.FileColumns._ID
        val mediaType = MediaStore.Files.FileColumns.MEDIA_TYPE
        val dateColumn = MediaStore.Files.FileColumns.DATE_ADDED
        val selection = mutableListOf(
            "($mediaType=? OR $mediaType=?)",
            "${MediaStore.MediaColumns.IS_PENDING}=0",
        )
        val values = mutableListOf(
            MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
            MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
        )
        if (Build.VERSION.SDK_INT >= 30) {
            selection += "${MediaStore.MediaColumns.IS_TRASHED}=0"
        }
        if (albumId != null) {
            selection += "${MediaStore.Images.ImageColumns.BUCKET_ID}=?"
            values += albumId
        }
        if (after != null) {
            selection += "($dateColumn<? OR ($dateColumn=? AND $idColumn<?))"
            values += after.addedAtSeconds.toString()
            values += after.addedAtSeconds.toString()
            values += after.id.toString()
        }
        val query = Bundle().apply {
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection.joinToString(" AND "))
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, values.toTypedArray())
            putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "$dateColumn DESC, $idColumn DESC")
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
        }
        val result = ArrayList<NativeLocalMedia>(limit)
        val projection = if (Build.VERSION.SDK_INT >= 30)
            columns + MediaStore.MediaColumns.IS_TRASHED else columns
        resolver.query(uri, projection, query, null)?.use { cursor ->
            // Unbounded OEM cursors are not treated as a complete or correct page.
            check(cursor.count <= limit) { "MediaStore ignored bounded keyset page" }
            val idIndex = cursor.getColumnIndexOrThrow(idColumn)
            val kindIndex = cursor.getColumnIndexOrThrow(mediaType)
            val dateIndex = cursor.getColumnIndexOrThrow(dateColumn)
            val pendingIndex = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_PENDING)
            val trashedIndex = if (Build.VERSION.SDK_INT >= 30)
                cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_TRASHED) else -1
            val bucketIndex = cursor.getColumnIndexOrThrow(MediaStore.Images.ImageColumns.BUCKET_ID)
            val nameIndex = cursor.getColumnIndexOrThrow(
                MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME)
            var previous = after
            while (cursor.moveToNext()) {
                currentCoroutineContext().ensureActive()
                val id = cursor.getLong(idIndex)
                val dateAdded = cursor.getLong(dateIndex)
                val key = NativeLocalPageKey(dateAdded, id)
                check(nativeLocalStrictPageOrder(previous, listOf(key))) {
                    "MediaStore returned a repeated or unordered Gallery page"
                }
                previous = key
                check(cursor.getInt(pendingIndex) == 0 &&
                    (trashedIndex < 0 || cursor.getInt(trashedIndex) == 0)) {
                    "MediaStore returned a pending or trashed Gallery asset"
                }
                val video = when (cursor.getInt(kindIndex)) {
                    MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE -> false
                    MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO -> true
                    else -> throw IllegalStateException("Unsupported Gallery media type")
                }
                val source = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                val bucket = cursor.getString(bucketIndex)?.takeIf { it.isNotBlank() } ?: "unknown"
                check(albumId == null || albumId == bucket) {
                    "MediaStore ignored selected album scope"
                }
                result += NativeLocalMedia(
                    id, ContentUris.withAppendedId(source, id), video, bucket,
                    cursor.getString(nameIndex)?.takeIf { it.isNotBlank() } ?: "未命名相册",
                    dateAdded,
                )
            }
        } ?: throw IllegalStateException("设备媒体索引不可用")
        result
    }

    /**
     * Scan bucket metadata in bounded pages. Never hold full 100k photo rows.
     * A capped/permission-limited album list is explicitly marked incomplete.
     */
    suspend fun albums(resolver: ContentResolver): NativeLocalAlbumScan = withContext(Dispatchers.IO) {
        val buckets = linkedMapOf<String, NativeLocalAlbum>()
        var scanned = 0
        var after: NativeLocalPageKey? = null
        var truncated = false
        while (scanned < MAX_SCAN) {
            currentCoroutineContext().ensureActive()
            val batch = pageAfter(resolver, after, minOf(SCAN_BATCH_SIZE, MAX_SCAN - scanned))
            for (asset in batch) {
                val previous = buckets[asset.albumId]
                if (previous != null) buckets[asset.albumId] = previous.copy(
                    count = previous.count + 1)
                else if (buckets.size < MAX_ALBUMS)
                    buckets[asset.albumId] = NativeLocalAlbum(asset.albumId, asset.albumName, 1, asset)
                else truncated = true
            }
            scanned += batch.size
            after = batch.lastOrNull()?.pageKey ?: after
            if (truncated || batch.size < SCAN_BATCH_SIZE) break
        }
        if (scanned >= MAX_SCAN) truncated = true
        NativeLocalAlbumScan(buckets.values.toList(), truncated, scanned)
    }

    fun canAppend(existing: List<NativeLocalMedia>, page: List<NativeLocalMedia>): Boolean =
        nativeLocalStrictPageOrder(existing.lastOrNull()?.pageKey, page.map { it.pageKey })
}
