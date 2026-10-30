package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeHomeNavigationTest {
    @Test fun fixedSlotsNeverReorderAndOnlyDynamicLabelChanges() {
        val initial = NativeHomeNavigation()
        assertEquals(listOf("全部", "最近", "图库", "文件", "我的"), initial.labels)
        val transfers = initial.openDynamic(NativeDynamicFeature.TRANSFERS)
        assertEquals(listOf("全部", "传输", "图库", "文件", "我的"), transfers.labels)
        assertEquals(NativeHomeTab.DYNAMIC, transfers.selected)
        assertEquals(listOf(NativeDynamicFeature.TRANSFERS), transfers.recentDynamic)
    }

    @Test fun galleryMapLocalAlbumsAndViewerOriginNeverConsumeDynamicSlot() {
        val recent = NativeHomeNavigation().openDynamic(NativeDynamicFeature.TRANSFERS)
        listOf(NativeHomeShortcut.CLOUD_GALLERY,
            NativeHomeShortcut.LOCAL_PHOTOS,
            NativeHomeShortcut.LOCAL_ALBUMS,
            NativeHomeShortcut.GALLERY_MAP).forEach { destination ->
            val moved = recent.open(destination)
            assertEquals(NativeHomeTab.GALLERY, moved.selected)
            assertEquals(NativeDynamicFeature.TRANSFERS, moved.dynamicFeature)
        }
        assertEquals(NativeGallerySource.MAP,
            recent.open(NativeHomeShortcut.GALLERY_MAP).gallerySource)
        assertEquals(NativeHomeTab.FILES, recent.open(NativeHomeShortcut.CLOUD_FILES).selected)
        assertEquals(NativeHomeTab.FILES, recent.open(NativeHomeShortcut.TRASH).selected)
    }

    @Test fun recentAndFavoritesAreSessionOnlyAndNeverReplaceFixedTabs() {
        val initial = NativeHomeNavigation()
        val visited = initial
            .open(NativeHomeShortcut.LOCAL_ALBUMS)
            .open(NativeHomeShortcut.CLOUD_FILES)
            .open(NativeHomeShortcut.LOCAL_ALBUMS)
            .toggleFavorite(NativeHomeShortcut.LOCAL_ALBUMS)
        assertEquals(listOf(NativeHomeShortcut.LOCAL_ALBUMS,
            NativeHomeShortcut.CLOUD_FILES), visited.recentShortcuts)
        assertEquals(setOf(NativeHomeShortcut.LOCAL_ALBUMS), visited.favoriteShortcuts)
        assertEquals(NativeHomeTab.GALLERY, visited.open(NativeHomeShortcut.GALLERY_MAP).selected)
        assertEquals(listOf("全部", "最近", "图库", "文件", "我的"),
            NativeHomeNavigation().labels)
    }

    @Test fun galleryMapExitKeepsItsActualOriginInsteadOfTheMapChip() {
        for (origin in listOf(NativeGallerySource.LOCAL,
            NativeGallerySource.ALBUMS, NativeGallerySource.CLOUD)) {
            assertEquals(origin, nativeGalleryMapReturnSource(origin))
            assertEquals(origin, nativeGalleryMapReturnSource(
                NativeGallerySource.MAP, origin))
        }
        assertEquals(NativeGallerySource.CLOUD,
            nativeGalleryMapReturnSource(NativeGallerySource.MAP,
                NativeGallerySource.MAP))
    }

    @Test fun unauthorizedDynamicRouteFallsBackWithoutLeakingHistory() {
        val recent = NativeHomeNavigation().openDynamic(NativeDynamicFeature.TRANSFERS)
        val revoked = recent.restrictTo(emptySet())
        assertEquals(NativeHomeTab.ALL, revoked.selected)
        assertEquals(null, revoked.dynamicFeature)
        assertEquals(emptyList<NativeDynamicFeature>(), revoked.recentDynamic)
        // A new Owner obtains a new in-memory instance, not a restored route.
        assertEquals("最近", NativeHomeNavigation().labels[1])
    }
}
