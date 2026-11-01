package com.tfluid.xdrive

import android.provider.MediaStore
import org.junit.Assert.*
import org.junit.Test

class NativeLocalMediaKindFilterTest {
    @Test fun queryKindsAreFixedAndCanNeverCarrySql() {
        assertEquals(listOf("","image","video"),
            nativeLocalMediaKindOptions.map { it.first })
        val image = MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE
        val video = MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
        assertEquals(listOf(image,video), nativeLocalMediaTypesForKind(""))
        assertEquals(listOf(image), nativeLocalMediaTypesForKind("image"))
        assertEquals(listOf(video), nativeLocalMediaTypesForKind("video"))
        assertThrows(IllegalArgumentException::class.java) {
            nativeLocalMediaTypesForKind("video' OR 1=1 --")
        }
    }

    @Test fun changingSourceResetsOnlySelectedWallAndItsDateIndex() {
        val memory = NativeLocalGalleryMemory()
        val photos = memory.wallFor(false, null)
        val album = memory.wallFor(true, "album-1")
        album.loaded.value = true
        photos.loaded.value = true
        photos.scannedCount.intValue = 128
        photos.nextPageKey.value = NativeLocalPageKey(10, 4)
        photos.fullDateIndex.value = NativeLocalFullDateIndexBuilder()
            .snapshot(complete = true)
        photos.dateScale.value = "month"
        val oldVersion = photos.revision.intValue

        photos.selectMediaKind("video")
        assertEquals("video", photos.mediaKind.value)
        assertTrue(photos.filterEpoch.intValue > 0)
        assertFalse(photos.loaded.value)
        assertEquals(0, photos.scannedCount.intValue)
        assertNull(photos.nextPageKey.value)
        assertNull(photos.fullDateIndex.value)
        assertEquals("all", photos.dateScale.value)
        assertTrue(photos.revision.intValue > oldVersion)
        assertTrue(album.loaded.value)

        photos.selectMediaKind("image")
        assertEquals("image", photos.mediaKind.value)
        photos.selectMediaKind("")
        assertEquals("", photos.mediaKind.value)
        assertEquals(0, photos.jumpOffset.intValue)
    }

    @Test fun invalidKindAndRepeatedTapCannotInvalidateCurrentViewport() {
        val wall = NativeLocalGalleryWallMemory()
        wall.selectMediaKind("image")
        wall.loaded.value = true
        val before = wall.revision.intValue
        wall.selectMediaKind("image")
        assertEquals(before, wall.revision.intValue)
        assertTrue(wall.loaded.value)
        assertThrows(IllegalArgumentException::class.java) {
            wall.selectMediaKind("image|video")
        }
        assertEquals(before, wall.revision.intValue)
        assertEquals("image", wall.mediaKind.value)
    }

    @Test fun grantOrOwnerInvalidationResetsFilterToAll() {
        val owner = NativeLocalGalleryMemory()
        val wall = owner.wallFor(false, null)
        wall.selectMediaKind("video")
        owner.invalidate()
        assertEquals("", wall.mediaKind.value)
        assertEquals(0, wall.filterEpoch.intValue)
        val another = NativeLocalGalleryMemory().wallFor(false, null)
        assertEquals("", another.mediaKind.value)
    }
}
