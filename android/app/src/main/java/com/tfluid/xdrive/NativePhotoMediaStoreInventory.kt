package com.tfluid.xdrive

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.InputStream

/** Memory-only original candidate; do NOT persist the raw URI or local ID. */
internal data class NativePhotoOriginalCandidate(
    val localId: Long,
    val uri: Uri,
    val isVideo: Boolean,
    val mimeType: String,
    val sizeBytes: Long,
    val modifiedAtSeconds: Long,
) {
    override fun toString() = "NativePhotoOriginalCandidate([redacted])"
}

internal data class NativePhotoInventoryPage(
    val candidates: List<NativePhotoOriginalCandidate>,
    val nextAfterId: Long?,
)

/**
 * Automatic *whole library* scanning requires both photo+video read grants.
 * Android 14 selected-photo permission alone is NOT represented as full backup.
 */
internal fun hasNativeFullPhotoVideoReadGrant(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= 33) {
        context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) ==
            PackageManager.PERMISSION_GRANTED &&
            context.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) ==
            PackageManager.PERMISSION_GRANTED
    } else {
        context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
    }

/**
 * Compare a user-selected original to a fresh provider record. This is NOT a
 * hash of MediaStore metadata; the staged bytes still get their own SHA-256.
 * Deny records that were replaced, trashed, pending or lost their grant.
 */
internal fun nativePhotoSnapshotMatches(
    selectedId: Long, selectedIsVideo: Boolean, selectedMimeType: String,
    selectedSize: Long, selectedModified: Long,
    id: Long, mimeType: String?, size: Long, modified: Long,
    isPending: Boolean, isTrashed: Boolean,
): Boolean = id > 0 && selectedId == id &&
    selectedSize == size && size in 1..NativePhotoOriginalStager.MAX_ORIGINAL_BYTES &&
    selectedModified == modified && !isPending && !isTrashed &&
    mimeType == selectedMimeType && mimeType != null && mimeType.startsWith(
        if (selectedIsVideo) "video/" else "image/"
    )

/** Android content:// URI validation is separate from the pure JVM snapshot check. */
internal fun nativePhotoCanonicalUriMatches(selected: NativePhotoOriginalCandidate): Boolean =
    selected.localId > 0 && selected.uri == ContentUris.withAppendedId(
        if (selected.isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            else MediaStore.Images.Media.EXTERNAL_CONTENT_URI, selected.localId)

/** Bounded, read-only, ID-keyset MediaStore source scan; never requests a grant. */
internal object NativePhotoMediaStoreInventory {
    const val PAGE_SIZE = 64

    suspend fun next(
        context: Context,
        afterId: Long = 0,
        limit: Int = PAGE_SIZE,
    ): NativePhotoInventoryPage = withContext(Dispatchers.IO) {
        require(afterId >= 0 && limit in 1..PAGE_SIZE)
        check(hasNativeFullPhotoVideoReadGrant(context)) {
            "Full photos-and-videos permission is required for whole-library backup"
        }
        val id = MediaStore.Files.FileColumns._ID
        val kind = MediaStore.Files.FileColumns.MEDIA_TYPE
        val size = MediaStore.MediaColumns.SIZE
        val modified = MediaStore.MediaColumns.DATE_MODIFIED
        val mime = MediaStore.MediaColumns.MIME_TYPE
        val pending = MediaStore.MediaColumns.IS_PENDING
        val trashed = MediaStore.MediaColumns.IS_TRASHED
        val constraints = mutableListOf(
            "($kind=? OR $kind=?)", "$id>?", "$pending=0",
        )
        if (Build.VERSION.SDK_INT >= 30) constraints += "$trashed=0"
        val args = Bundle().apply {
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION,
                constraints.joinToString(" AND "))
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,
                arrayOf(
                    MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
                    MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
                    afterId.toString(),
                ))
            putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "$id ASC")
            putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
        }
        val projection = arrayOf(id, kind, size, modified, mime)
        val results = ArrayList<NativePhotoOriginalCandidate>(limit)
        val resolver = context.contentResolver
        resolver.query(MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL),
            projection, args, null)?.use { cursor ->
            // A provider that ignores LIMIT cannot silently be trusted as
            // a bounded, complete or ordered inventory.
            check(cursor.count <= limit) { "MediaStore provider ignored bounded page limit" }
            val idIndex = cursor.getColumnIndexOrThrow(id)
            val kindIndex = cursor.getColumnIndexOrThrow(kind)
            val sizeIndex = cursor.getColumnIndexOrThrow(size)
            val modifiedIndex = cursor.getColumnIndexOrThrow(modified)
            val mimeIndex = cursor.getColumnIndexOrThrow(mime)
            var previousId = afterId
            while (cursor.moveToNext()) {
                currentCoroutineContext().ensureActive()
                val foundId = cursor.getLong(idIndex)
                check(foundId > previousId) { "MediaStore page was not strictly ordered" }
                previousId = foundId
                val isVideo = when (cursor.getInt(kindIndex)) {
                    MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO -> true
                    MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE -> false
                    else -> throw IllegalStateException("Unsupported MediaStore media type")
                }
                val contentType = cursor.getString(mimeIndex) ?: ""
                check(contentType.startsWith(if (isVideo) "video/" else "image/") &&
                    contentType.length <= 128 && contentType.none { it.isISOControl() }) {
                    "MediaStore media type is unavailable or mismatched"
                }
                val bytes = cursor.getLong(sizeIndex)
                // Do not claim a zero-sized/offline/unavailable item uploaded.
                check(bytes in 1..NativePhotoOriginalStager.MAX_ORIGINAL_BYTES) {
                    "MediaStore original size unavailable or too large"
                }
                val base = if (isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                results += NativePhotoOriginalCandidate(
                    localId = foundId,
                    uri = ContentUris.withAppendedId(base, foundId),
                    isVideo = isVideo,
                    mimeType = contentType,
                    sizeBytes = bytes,
                    modifiedAtSeconds = cursor.getLong(modifiedIndex),
                )
            }
        } ?: throw IllegalStateException("MediaStore inventory cannot be read")
        NativePhotoInventoryPage(
            candidates = results,
            nextAfterId = results.lastOrNull()?.localId,
        )
    }

    /**
     * Recheck the precise MediaStore item before and after staging. A provider
     * may reuse or mutate the selected ID between inventory and the user's
     * foreground confirmation; do not silently upload a different original.
     */
    private fun sourceMatches(context: Context, selected: NativePhotoOriginalCandidate): Boolean {
        if (!hasNativeFullPhotoVideoReadGrant(context) ||
            !nativePhotoCanonicalUriMatches(selected)) return false
        val id = MediaStore.MediaColumns._ID
        val mime = MediaStore.MediaColumns.MIME_TYPE
        val size = MediaStore.MediaColumns.SIZE
        val modified = MediaStore.MediaColumns.DATE_MODIFIED
        val pending = MediaStore.MediaColumns.IS_PENDING
        val fields = mutableListOf(id, mime, size, modified, pending)
        if (Build.VERSION.SDK_INT >= 30) fields += MediaStore.MediaColumns.IS_TRASHED
        val cursor = context.contentResolver.query(
            selected.uri, fields.toTypedArray(), null, null, null
        ) ?: return false
        return cursor.use {
            if (!it.moveToFirst()) return@use false
            val matches = nativePhotoSnapshotMatches(
                selectedId = selected.localId,
                selectedIsVideo = selected.isVideo,
                selectedMimeType = selected.mimeType,
                selectedSize = selected.sizeBytes,
                selectedModified = selected.modifiedAtSeconds,
                id = it.getLong(it.getColumnIndexOrThrow(id)),
                mimeType = it.getString(it.getColumnIndexOrThrow(mime)),
                size = it.getLong(it.getColumnIndexOrThrow(size)),
                modified = it.getLong(it.getColumnIndexOrThrow(modified)),
                isPending = it.getInt(it.getColumnIndexOrThrow(pending)) != 0,
                isTrashed = Build.VERSION.SDK_INT >= 30 &&
                    it.getInt(it.getColumnIndexOrThrow(MediaStore.MediaColumns.IS_TRASHED)) != 0,
            )
            matches && !it.moveToNext()
        }
    }

    /** One genuine, disposable original snapshot for the existing Go uploader. */
    suspend fun stageOriginal(
        context: Context,
        candidate: NativePhotoOriginalCandidate,
    ): NativePhotoStagedOriginal = withContext(Dispatchers.IO) {
        val app = context.applicationContext
        check(sourceMatches(app, candidate)) {
            "Selected MediaStore original changed before staging"
        }
        val staged = NativePhotoOriginalStager.stage(
            app.noBackupFilesDir, candidate.sizeBytes,
        ) { openOriginal(app, candidate) }
        try {
            check(sourceMatches(app, candidate)) {
                "Selected MediaStore original changed during staging"
            }
            staged
        } catch (failure: Throwable) {
            staged.close()
            throw failure
        }
    }

    /** No permission bypass, no conversion, and no media bytes cached in UI. */
    fun openOriginal(context: Context, candidate: NativePhotoOriginalCandidate): InputStream {
        check(hasNativeFullPhotoVideoReadGrant(context))
        check(candidate.localId > 0 &&
            candidate.sizeBytes in 1..NativePhotoOriginalStager.MAX_ORIGINAL_BYTES)
        return context.contentResolver.openInputStream(candidate.uri)
            ?: throw IllegalStateException("MediaStore original no longer readable")
    }
}
