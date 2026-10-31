package com.tfluid.xdrive

/**
 * Android's pure native navigation contract. Positions never change: only
 * the label of DYNAMIC is replaced by the last permitted non-fixed feature.
 *
 * This is session-memory-only. Do not persist Server/Owner routes, local
 * MediaStore IDs, cloud node IDs, thumbnails or Viewer anchors in preferences.
 */
internal enum class NativeHomeTab(val title: String) {
    ALL("全部"),
    DYNAMIC("最近"),
    GALLERY("图库"),
    FILES("文件"),
    MINE("我的"),
}

internal enum class NativeDynamicFeature(val title: String) {
    TRANSFERS("传输"),
}

/** Explicit destinations: Gallery map and both photo sources never use DYNAMIC. */
internal enum class NativeHomeShortcut {
    CLOUD_GALLERY,
    LOCAL_PHOTOS,
    LOCAL_ALBUMS,
    GALLERY_MAP,
    CLOUD_FILES,
    TRASH,
    TRANSFERS,
}

internal enum class NativeGallerySource { CLOUD, LOCAL, ALBUMS, MAP }

/** Pending Controller transitions are ephemeral and may never override a newer tab choice. */
internal data class NativeHomePendingRoutes(
    val galleryTab: Boolean = false,
    val galleryMap: Boolean = false,
    val trash: Boolean = false,
) {
    fun afterExplicitTab(tab: NativeHomeTab) = copy(
        galleryTab = galleryTab && tab == NativeHomeTab.GALLERY,
        galleryMap = galleryMap && tab == NativeHomeTab.GALLERY,
        trash = trash && tab == NativeHomeTab.FILES,
    )

    fun afterGallerySource(source: NativeGallerySource) =
        if (source == NativeGallerySource.MAP) this else copy(galleryMap = false)
}

/** Cloud map/Viewer chrome must not swallow the native local album breadcrumb. */
internal fun nativeLocalAlbumTopBackVisible(
    navigation: NativeHomeNavigation,
    hasSelectedAlbum: Boolean,
    cloudFocusOpen: Boolean,
): Boolean = navigation.selected == NativeHomeTab.GALLERY &&
    navigation.gallerySource == NativeGallerySource.ALBUMS &&
    hasSelectedAlbum && !cloudFocusOpen

/** Keep the originating Gallery wall when entering and leaving the Map child. */
internal fun nativeGalleryMapReturnSource(
    source: NativeGallerySource,
    lastNonMap: NativeGallerySource = NativeGallerySource.CLOUD,
): NativeGallerySource =
    if (source == NativeGallerySource.MAP) {
        lastNonMap.takeUnless { it == NativeGallerySource.MAP } ?: NativeGallerySource.CLOUD
    } else source

internal data class NativeHomeNavigation(
    val selected: NativeHomeTab = NativeHomeTab.FILES,
    val dynamicFeature: NativeDynamicFeature? = null,
    val recentDynamic: List<NativeDynamicFeature> = emptyList(),
    val gallerySource: NativeGallerySource = NativeGallerySource.CLOUD,
    val favoriteShortcuts: Set<NativeHomeShortcut> = emptySet(),
    val recentShortcuts: List<NativeHomeShortcut> = emptyList(),
) {
    val labels: List<String>
        get() = NativeHomeTab.entries.map {
            if (it == NativeHomeTab.DYNAMIC) dynamicFeature?.title ?: it.title else it.title
        }

    fun select(tab: NativeHomeTab) = copy(selected = tab)

    fun open(shortcut: NativeHomeShortcut): NativeHomeNavigation {
        val routed = when (shortcut) {
        NativeHomeShortcut.CLOUD_GALLERY -> copy(
            selected = NativeHomeTab.GALLERY, gallerySource = NativeGallerySource.CLOUD)
        NativeHomeShortcut.LOCAL_PHOTOS -> copy(
            selected = NativeHomeTab.GALLERY, gallerySource = NativeGallerySource.LOCAL)
        NativeHomeShortcut.LOCAL_ALBUMS -> copy(
            selected = NativeHomeTab.GALLERY, gallerySource = NativeGallerySource.ALBUMS)
        NativeHomeShortcut.GALLERY_MAP -> copy(
            selected = NativeHomeTab.GALLERY, gallerySource = NativeGallerySource.MAP)
        NativeHomeShortcut.CLOUD_FILES, NativeHomeShortcut.TRASH ->
            copy(selected = NativeHomeTab.FILES)
        NativeHomeShortcut.TRANSFERS -> openDynamic(NativeDynamicFeature.TRANSFERS)
        }
        return routed.copy(
            recentShortcuts = (listOf(shortcut) + recentShortcuts.filterNot {
                it == shortcut
            }).take(8))
    }

    fun toggleFavorite(shortcut: NativeHomeShortcut) = copy(
        favoriteShortcuts = if (shortcut in favoriteShortcuts)
            favoriteShortcuts - shortcut else favoriteShortcuts + shortcut)

    fun openDynamic(feature: NativeDynamicFeature): NativeHomeNavigation = copy(
        selected = NativeHomeTab.DYNAMIC,
        dynamicFeature = feature,
        recentDynamic = (listOf(feature) + recentDynamic.filterNot { it == feature }).take(8),
    )

    /** A route restored from an old Owner must never become an authorized route. */
    fun restrictTo(allowed: Set<NativeDynamicFeature>): NativeHomeNavigation {
        val permitted = recentDynamic.filter { it in allowed }.take(8)
        val active = dynamicFeature?.takeIf { it in allowed } ?: permitted.firstOrNull()
        return copy(
            selected = if (selected == NativeHomeTab.DYNAMIC && active == null)
                NativeHomeTab.ALL else selected,
            dynamicFeature = active,
            recentDynamic = permitted,
        )
    }
}
