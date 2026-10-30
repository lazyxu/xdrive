package com.tfluid.xdrive

import android.content.ContentResolver
import android.content.ContentUris
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Local read-only MediaStore asset: never an authenticated Server PhotoAsset. */
internal data class NativeLocalMedia(
    val id: Long,
    val uri: Uri,
    val isVideo: Boolean,
    val albumId: String,
    val albumName: String,
)

internal data class NativeLocalAlbum(
    val id: String,
    val title: String,
    val count: Int,
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

    private val uri: Uri get() = MediaStore.Files.getContentUri("external")
    private val columns = arrayOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.MEDIA_TYPE,
        MediaStore.Images.ImageColumns.BUCKET_ID,
        MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME,
    )

    /**
     * Keep all arguments typed/constant except a validated albumId selection
     * argument. A provider ignoring offset is never silently taken as a new
     * page: the UI also checks for duplicate IDs across requested pages.
     */
    suspend fun page(
        resolver: ContentResolver, offset: Int, limit: Int = PHOTO_PAGE_SIZE,
        albumId: String? = null,
    ): List<NativeLocalMedia> = withContext(Dispatchers.IO) {
        require(offset >= 0 && limit in 1..SCAN_BATCH_SIZE)
        val mediaType = MediaStore.Files.FileColumns.MEDIA_TYPE
        val where = if (albumId == null) "($mediaType=? OR $mediaType=?)"
            else "($mediaType=? OR $mediaType=?) AND ${MediaStore.Images.ImageColumns.BUCKET_ID}=?"
        val values = listOf(
            MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
            MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
        ) + listOfNotNull(albumId)
        val query = Bundle().apply {
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION, where)
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, values.toTypedArray())
            putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER,
                "${MediaStore.Files.FileColumns.DATE_ADDED} DESC, ${MediaStore.Files.FileColumns._ID} DESC")
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            putInt(ContentResolver.QUERY_ARG_OFFSET, offset)
        }
        val result = ArrayList<NativeLocalMedia>(limit)
        resolver.query(uri, columns, query, null)?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val kindIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
            val bucketIndex = cursor.getColumnIndexOrThrow(MediaStore.Images.ImageColumns.BUCKET_ID)
            val bucketNameIndex = cursor.getColumnIndexOrThrow(
                MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME)
            // Some provider implementations ignore LIMIT/OFFSET. If the
            // returned cursor is larger than our requested page, seek rather
            // than allocating all rows; never trust a second repeated page.
            if (cursor.count > limit) cursor.moveToPosition(offset - 1)
            while (result.size < limit && cursor.moveToNext()) {
                currentCoroutineContext().ensureActive()
                val id = cursor.getLong(idIndex)
                if (id <= 0L) continue
                val video = cursor.getInt(kindIndex) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val source = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                val bucket = cursor.getString(bucketIndex)?.takeIf { it.isNotBlank() } ?: "unknown"
                result += NativeLocalMedia(id, ContentUris.withAppendedId(source, id), video,
                    bucket, cursor.getString(bucketNameIndex)?.takeIf { it.isNotBlank() }
                        ?: "未命名相册")
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
        var offset = 0
        var truncated = false
        while (offset < MAX_SCAN) {
            currentCoroutineContext().ensureActive()
            val batch = page(resolver, offset, minOf(SCAN_BATCH_SIZE, MAX_SCAN - offset))
            for (asset in batch) {
                val previous = buckets[asset.albumId]
                if (previous != null) buckets[asset.albumId] = previous.copy(
                    count = previous.count + 1)
                else if (buckets.size < MAX_ALBUMS)
                    buckets[asset.albumId] = NativeLocalAlbum(asset.albumId, asset.albumName, 1)
                else truncated = true
            }
            offset += batch.size
            if (truncated || batch.size < SCAN_BATCH_SIZE) break
        }
        if (offset >= MAX_SCAN) truncated = true
        NativeLocalAlbumScan(buckets.values.toList(), truncated, offset)
    }

    fun canAppend(existing: List<NativeLocalMedia>, page: List<NativeLocalMedia>): Boolean =
        page.map { it.id }.distinct().size == page.size &&
            page.none { incoming -> existing.any { it.id == incoming.id } }
}
