package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** In-memory viewport only: no MediaStore grants, original bytes or persisted media IDs. */
class NativeLocalGalleryMemoryTest {
    @Test fun switchingToFilesOrMineDoesNotDiscardTheSameOwnersBoundedWallAndCursor() {
        val owner = NativeLocalGalleryMemory()
        val wall = owner.wallFor(albumsOnly = false, selectedAlbumId = null)
        val grid = wall.gridState.value
        wall.loaded.value = true
        wall.scannedCount.intValue = 192
        wall.firstOffset.intValue = 64
        wall.nextPageKey.value = NativeLocalPageKey(123L, 456L)
        wall.pageIntent.intValue = 3
        wall.consumedPageIntent.intValue = 3

        // The native Gallery is unmounted while Files/Mine/Launcher is active.
        val returned = owner.wallFor(albumsOnly = false, selectedAlbumId = null)
        assertSame(wall, returned)
        assertSame(grid, returned.gridState.value)
        assertTrue(returned.loaded.value)
        assertEquals(192, returned.scannedCount.intValue)
        assertEquals(64, returned.firstOffset.intValue)
        assertEquals(NativeLocalPageKey(123L, 456L), returned.nextPageKey.value)
        assertEquals(returned.consumedPageIntent.intValue, returned.pageIntent.intValue)
    }

    @Test fun changingTheActualAlbumDropsOnlyItsOldContentsNotThePhotoWall() {
        val owner = NativeLocalGalleryMemory()
        val photos = owner.wallFor(albumsOnly = false, selectedAlbumId = null)
        photos.loaded.value = true
        photos.scannedCount.intValue = 128
        val oldAlbum = owner.wallFor(albumsOnly = true, selectedAlbumId = "album-one")
        oldAlbum.loaded.value = true
        oldAlbum.scannedCount.intValue = 64
        val oldGrid = oldAlbum.gridState.value

        assertSame(oldAlbum, owner.wallFor(true, "album-one"))
        assertSame(oldGrid, owner.wallFor(true, "album-one").gridState.value)

        val newAlbum = owner.wallFor(true, "album-two")
        assertSame(oldAlbum, newAlbum) // one bounded album window, never an unbounded map
        assertNotSame(oldGrid, newAlbum.gridState.value)
        assertFalse(newAlbum.loaded.value)
        assertEquals(0, newAlbum.scannedCount.intValue)
        assertTrue(photos.loaded.value)
        assertEquals(128, photos.scannedCount.intValue)
    }

    @Test fun LibraryChangeOrBackgroundWipesAllDataAndInvalidatesBothViewportAnchors() {
        val owner = NativeLocalGalleryMemory()
        val photos = owner.wallFor(false, null)
        val albums = owner.wallFor(true, "family")
        photos.loaded.value = true
        albums.loaded.value = true
        photos.nextPageKey.value = NativeLocalPageKey(42L, 80L)
        albums.scannedCount.intValue = 64
        owner.albumVisibleCount.intValue = 192
        val photoGrid = photos.gridState.value
        val albumGrid = owner.albumGridState.value
        val epoch = owner.generation.intValue
        val pendingReadRevision = photos.revision.intValue

        owner.invalidate()
        // A provider request started before a changed grant must be rejected.
        assertTrue(photos.revision.intValue != pendingReadRevision)
        assertEquals(epoch + 1, owner.generation.intValue)
        assertFalse(photos.loaded.value)
        assertFalse(albums.loaded.value)
        assertEquals(null, photos.nextPageKey.value)
        assertEquals(0, albums.scannedCount.intValue)
        assertNotSame(photoGrid, photos.gridState.value)
        assertNotSame(albumGrid, owner.albumGridState.value)
        assertEquals(NativeLocalMediaStore.ALBUM_PAGE_SIZE, owner.albumVisibleCount.intValue)
    }

    @Test fun revokedGrantNeverLeavesCachedPagesOrCreatesAnotherEpochLoop() {
        val owner = NativeLocalGalleryMemory()
        val photos = owner.wallFor(false, null)
        photos.loaded.value = true
        photos.scannedCount.intValue = 64
        val generation = owner.generation.intValue
        owner.clearUnauthorized()
        assertEquals(generation, owner.generation.intValue)
        assertFalse(photos.loaded.value)
        assertEquals(0, photos.scannedCount.intValue)
        // Owner A->B->A is a new memory instance, not an account-keyed map.
        assertNotSame(photos, NativeLocalGalleryMemory().wallFor(false, null))
    }
}
