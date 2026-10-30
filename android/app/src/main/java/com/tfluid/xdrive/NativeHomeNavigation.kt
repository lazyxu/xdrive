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

internal data class NativeHomeNavigation(
    val selected: NativeHomeTab = NativeHomeTab.FILES,
    val dynamicFeature: NativeDynamicFeature? = null,
    val recentDynamic: List<NativeDynamicFeature> = emptyList(),
    val gallerySource: NativeGallerySource = NativeGallerySource.CLOUD,
) {
    val labels: List<String>
        get() = NativeHomeTab.entries.map {
            if (it == NativeHomeTab.DYNAMIC) dynamicFeature?.title ?: it.title else it.title
        }

    fun select(tab: NativeHomeTab) = copy(selected = tab)

    fun open(shortcut: NativeHomeShortcut): NativeHomeNavigation = when (shortcut) {
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
