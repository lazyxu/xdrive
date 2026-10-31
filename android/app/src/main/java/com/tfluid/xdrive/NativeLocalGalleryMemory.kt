package com.tfluid.xdrive

import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf

/**
 * Foreground, Owner-session-only UI cache. Never save it to Bundle, disk,
 * preferences or across an Owner/server switch: MediaStore IDs and URIs must
 * not outlive their current authorization. Only 512 wall tiles per source
 * and the existing bounded album index can be retained in memory.
 */
internal class NativeLocalGalleryWallMemory {
    val items: MutableState<List<NativeLocalMedia>> = mutableStateOf(emptyList())
    val exhausted: MutableState<Boolean> = mutableStateOf(false)
    val scannedCount: MutableIntState = mutableIntStateOf(0)
    val nextPageKey: MutableState<NativeLocalPageKey?> = mutableStateOf(null)
    val firstOffset: MutableIntState = mutableIntStateOf(0)
    val failure: MutableState<String?> = mutableStateOf(null)
    val busy: MutableState<Boolean> = mutableStateOf(false)
    val pageIntent: MutableIntState = mutableIntStateOf(0)
    val consumedPageIntent: MutableIntState = mutableIntStateOf(0)
    val loaded: MutableState<Boolean> = mutableStateOf(false)
    val gridState: MutableState<LazyGridState> = mutableStateOf(LazyGridState())

    private var albumId: String? = null

    fun selectAlbum(id: String?) {
        if (albumId != id) {
            albumId = id
            clear()
        }
    }

    fun clear() {
        items.value = emptyList()
        exhausted.value = false
        scannedCount.intValue = 0
        nextPageKey.value = null
        firstOffset.intValue = 0
        failure.value = null
        busy.value = false
        pageIntent.intValue = 0
        consumedPageIntent.intValue = 0
        loaded.value = false
        gridState.value = LazyGridState()
    }
}

internal class NativeLocalGalleryMemory {
    private val photos = NativeLocalGalleryWallMemory()
    private val albumContents = NativeLocalGalleryWallMemory()
    val albumIndex: MutableState<NativeLocalAlbumScan?> = mutableStateOf(null)
    val albumGridState: MutableState<LazyGridState> = mutableStateOf(LazyGridState())
    val albumVisibleCount: MutableIntState =
        mutableIntStateOf(NativeLocalMediaStore.ALBUM_PAGE_SIZE)
    val generation: MutableIntState = mutableIntStateOf(0)
    val watcherRegistered: MutableState<Boolean> = mutableStateOf(false)

    /** A selected album may retain one bounded wall, never all 4,096 albums. */
    fun wallFor(albumsOnly: Boolean, selectedAlbumId: String?): NativeLocalGalleryWallMemory {
        val wall = if (albumsOnly) albumContents else photos
        wall.selectAlbum(if (albumsOnly) selectedAlbumId else null)
        return wall
    }

    /** Called on MediaStore change, permission/foreground epoch or Owner disposal. */
    fun invalidate() {
        photos.clear()
        albumContents.clear()
        albumIndex.value = null
        albumGridState.value = LazyGridState()
        albumVisibleCount.intValue = NativeLocalMediaStore.ALBUM_PAGE_SIZE
        generation.intValue++
    }

    /** Clear a rejected grant without recursively changing an effect key. */
    fun clearUnauthorized() {
        photos.clear()
        albumContents.clear()
        albumIndex.value = null
        albumGridState.value = LazyGridState()
        albumVisibleCount.intValue = NativeLocalMediaStore.ALBUM_PAGE_SIZE
    }
}
