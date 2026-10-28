package com.tfluid.xdrive

import com.tfluid.xdrive.core.GalleryAlbum
import org.junit.Assert.*
import org.junit.Test

/** UI-only labels: never use a generic identical action across Owner albums. */
class GalleryAlbumAccessibilityLabelsTest {
    private val family = GalleryAlbum("manual:family", "manual", "家庭照片", 9L, 2L, 1L)
    private val travel = GalleryAlbum("manual:travel", "manual", "假期相册", 8L, 3L, 1L)

    @Test fun eachAlbumHasUnambiguousOpenAndOverflowAccessibilityActions() {
        assertEquals("打开相册：家庭照片", galleryAlbumOpenActionLabel(family))
        assertEquals("打开相册：假期相册", galleryAlbumOpenActionLabel(travel))
        assertEquals("更多操作：家庭照片", galleryAlbumMoreActionLabel(family))
        assertEquals("更多操作：假期相册", galleryAlbumMoreActionLabel(travel))
        assertNotEquals(galleryAlbumMoreActionLabel(family), galleryAlbumMoreActionLabel(travel))
    }

    @Test fun failedCoverRetryIdentifiesExactAlbumAndFollowsRenamedMetadata() {
        assertEquals("重试相册封面：家庭照片", galleryAlbumRetryActionLabel(family))
        val renamed = family.copy(name = "新名称", revision = family.revision + 1)
        assertEquals("更多操作：新名称", galleryAlbumMoreActionLabel(renamed))
        assertEquals("重试相册封面：新名称", galleryAlbumRetryActionLabel(renamed))
        assertNotEquals(galleryAlbumOpenActionLabel(family),
            galleryAlbumOpenActionLabel(renamed))
    }
}
