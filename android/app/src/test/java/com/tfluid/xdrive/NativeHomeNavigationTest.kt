package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    @Test fun localAlbumHeaderBackBelongsOnlyToItsCurrentGalleryStack() {
        val album = NativeHomeNavigation().open(NativeHomeShortcut.LOCAL_ALBUMS)
        assertTrue(nativeLocalAlbumTopBackVisible(album, hasSelectedAlbum = true,
            cloudFocusOpen = false))
        assertFalse(nativeLocalAlbumTopBackVisible(album, false, false))
        assertFalse(nativeLocalAlbumTopBackVisible(album, true, true))
        assertFalse(nativeLocalAlbumTopBackVisible(album.select(NativeHomeTab.ALL),
            true, false))
        assertFalse(nativeLocalAlbumTopBackVisible(
            album.open(NativeHomeShortcut.CLOUD_GALLERY), true, false))
        assertFalse(nativeLocalAlbumTopBackVisible(
            album.open(NativeHomeShortcut.GALLERY_MAP), true, false))
    }

    @Test fun systemBackOnlyTargetsTheVisibleFeatureAndPreservesFilesViewerReturn() {
        val files = NativeHomeNavigation().select(NativeHomeTab.FILES)
        val gallery = files.select(NativeHomeTab.GALLERY)

        assertTrue(nativeFeatureBackAllowed(NativeHomeTab.FILES,
            Screen.FILES, galleryBack = false, filesBack = true))
        assertTrue(nativeFeatureBackAllowed(NativeHomeTab.FILES,
            Screen.TRASH, galleryBack = false, filesBack = false))
        assertTrue(nativeFeatureBackAllowed(NativeHomeTab.GALLERY,
            Screen.GALLERY, galleryBack = true, filesBack = false))
        assertFalse(nativeFeatureBackAllowed(NativeHomeTab.GALLERY,
            Screen.GALLERY, galleryBack = false, filesBack = true))

        // The Controller intentionally retains Files/Gallery routes while an
        // unrelated root tab is visible. They must not consume Android Back.
        for (inactive in listOf(NativeHomeTab.ALL, NativeHomeTab.DYNAMIC,
            NativeHomeTab.MINE)) {
            assertFalse(nativeFeatureBackAllowed(inactive, Screen.FILES,
                galleryBack = false, filesBack = true))
            assertFalse(nativeFeatureBackAllowed(inactive, Screen.TRASH,
                galleryBack = false, filesBack = false))
            assertFalse(nativeFeatureBackAllowed(inactive, Screen.GALLERY,
                galleryBack = true, filesBack = false))
        }
        assertFalse(nativeFeatureBackAllowed(gallery.selected, Screen.FILES,
            galleryBack = true, filesBack = true))
        assertFalse(nativeFeatureBackAllowed(files.selected, Screen.GALLERY,
            galleryBack = true, filesBack = true))

        // A Files image uses the existing Gallery Viewer transport, but the
        // current route still belongs to Files. Back must return to Files,
        // without promoting the background Gallery to an active tab.
        assertTrue(nativeFeatureBackAllowed(files.selected, Screen.GALLERY,
            galleryBack = true, filesBack = false, filesOriginViewer = true))
        assertFalse(nativeFeatureBackAllowed(gallery.selected, Screen.GALLERY,
            galleryBack = true, filesBack = false, filesOriginViewer = true))
        assertFalse(nativeFeatureBackAllowed(files.selected, Screen.GALLERY,
            galleryBack = false, filesBack = false, filesOriginViewer = true))
    }

    @Test fun unfinishedRouteCannotOverrideNewTabOrGallerySourceChoice() {
        val pending = NativeHomePendingRoutes(
            galleryTab = true, galleryMap = true, trash = true)
        assertEquals(NativeHomePendingRoutes(), pending.afterExplicitTab(NativeHomeTab.ALL))
        assertEquals(NativeHomePendingRoutes(galleryTab = true, galleryMap = true),
            pending.afterExplicitTab(NativeHomeTab.GALLERY))
        assertEquals(NativeHomePendingRoutes(trash = true),
            pending.afterExplicitTab(NativeHomeTab.FILES))
        assertEquals(NativeHomePendingRoutes(),
            pending.afterExplicitTab(NativeHomeTab.DYNAMIC))
        assertEquals(NativeHomePendingRoutes(galleryTab = true, trash = true),
            pending.afterGallerySource(NativeGallerySource.LOCAL))
        assertEquals(pending, pending.afterGallerySource(NativeGallerySource.MAP))
    }
}
