package com.tfluid.xdrive

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items as listItems
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAsset
import com.tfluid.xdrive.core.GalleryTimelineGroup
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Match the shared Mobile Gallery KFS column-first contract for All photos:
 * reference width 144dp, three baseline columns, preference range 2..10.
 * The preference shifts the responsive count without changing Owner rows. */
internal fun galleryVisibleColumns(widthDp: Float, preference: Int): Int {
    val available = if (widthDp.isFinite()) widthDp.coerceAtLeast(0f) else 0f
    val baseline = maxOf(3, (available / 144f).toInt())
    return (baseline + preference.coerceIn(2, 10) - 3).coerceIn(2, 10)
}

internal fun galleryTimelineGroupLabel(group: GalleryTimelineGroup): String = when {
    group.key == "unknown" -> "未记录日期"
    group.key.length == 4 -> group.key + "年"
    group.key.length == 7 -> group.key.substring(0, 4) + "年" +
        group.key.substring(5, 7) + "月"
    else -> group.key.substring(0, 4) + "年" +
        group.key.substring(5, 7) + "月" + group.key.substring(8, 10) + "日"
}

/** Native Owner Gallery with same Server range for wall and search, never a local
 * filter of the few visible thumbnails. Real Owner Collections use the
 * native GalleryCollections screen and the same Gallery member Range. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ColumnScope.Gallery(
    state: DriveState, controller: DriveController,
    bitmaps: LruCache<String, ImageBitmap>,
) {
    val gridState = rememberLazyGridState()
    var searchOpen by remember { mutableStateOf(false) }
    var searchDraft by remember(state.gallerySearchQuery) { mutableStateOf(state.gallerySearchQuery) }
    // Display preferences are only local UI state and survive Viewer returns.
    var preferredColumns by rememberSaveable { mutableIntStateOf(3) }
    var containTiles by rememberSaveable { mutableStateOf(false) }
    var displayMenuOpen by remember { mutableStateOf(false) }
    var kindMenuOpen by remember { mutableStateOf(false) }
    var timeScale by rememberSaveable(state.gallerySearchQuery, state.galleryMediaKind,
        state.gallerySortBy, state.gallerySortDir) {
        mutableStateOf("all")
    }
    var timePickerOpen by remember { mutableStateOf(false) }
    // Preserve the visible photo anchor while the Viewer is open.
    var positioned by rememberSaveable(
        state.gallerySearchQuery, state.galleryMediaKind, state.galleryJumpEpoch
    ) {
        mutableStateOf(false)
    }
    // A single entrance to the oldest visible edge permits only one fetch.
    // Re-arm after scrolling away: do not recursively traverse a 100k library
    // while Compose is still remeasuring newly prepended rows.
    var olderEdgeArmed by remember(
        state.gallerySearchQuery, state.galleryMediaKind, state.galleryJumpEpoch
    ) { mutableStateOf(state.galleryJumpIndex == null) }
    var newerEdgeArmed by remember(state.galleryJumpEpoch) { mutableStateOf(true) }
    val nearOlderEdge by remember(gridState) {
        derivedStateOf { gridState.firstVisibleItemIndex <= 3 }
    }
    val nearNewerEdge by remember(gridState, state.galleryItems.size) {
        derivedStateOf {
            val last = gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            state.galleryItems.isNotEmpty() && last >= state.galleryItems.lastIndex - 3
        }
    }

    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(state.gallerySelectedAlbum?.name ?: if (state.gallerySearchQuery.isEmpty()) "图库" else "搜索结果",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (state.galleryLoaded) Text("${state.galleryTotal} 项",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // PWA's genuine Select/Done control, without selecting unloaded results.
        TextButton(
            onClick = { controller.setGallerySelectionMode(!state.gallerySelectionMode) },
            enabled = state.galleryLoaded && !state.loading &&
                !state.galleryFavoriteWriteAttempted && !state.viewerReturnToFiles,
            modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-select-mode"),
        ) { Text(if (state.gallerySelectionMode) "完成" else "选择") }
        // Preserve the real Server query clear action without a second bottom row.
        if (!state.gallerySelectionMode && state.gallerySelectedAlbum == null &&
            state.gallerySearchQuery.isNotEmpty()) {
            TextButton(onClick = { controller.searchGallery("") },
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-search-clear")) { Text("清除") }
        }
        if (state.gallerySelectedAlbum == null) {
            TextButton(
                onClick = { kindMenuOpen = true },
                enabled = !state.gallerySelectionMode && !state.galleryFavoriteWriteAttempted,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-kind-filter")
                    .semantics {
                        stateDescription = when (state.galleryMediaKind) {
                            "image" -> "仅照片"
                            "video" -> "仅视频"
                            else -> "全部媒体"
                        }
                    },
            ) { Text("分类") }
        }
        Box {
            IconButton(
                onClick = { displayMenuOpen = true },
                enabled = !state.gallerySelectionMode && !state.galleryFavoriteWriteAttempted,
                modifier = Modifier.size(48.dp)
                    .semantics {
                        stateDescription = "缩略图密度 ${preferredColumns} 档，" +
                            if (containTiles) "完整比例" else "方形裁切"
                    }
                    .testTag("gallery-view-options"),
            ) {
                Icon(painterResource(R.drawable.xd_more_vert), "图库显示选项")
            }
            DropdownMenu(expanded = displayMenuOpen,
                onDismissRequest = { displayMenuOpen = false },
                containerColor = MaterialTheme.colorScheme.surface) {
                // Same four real sorting choices as iOS PWA, using Go Owner Range.
                for ((sort, label) in listOf(
                    ("captured" to "asc") to "拍摄时间 · 最早在前",
                    ("captured" to "desc") to "拍摄时间 · 最新在前",
                    ("added" to "asc") to "加入时间 · 最早在前",
                    ("added" to "desc") to "加入时间 · 最新在前"
                )) {
                    DropdownMenuItem(
                        text = { Text(label) },
                        trailingIcon = {
                            if (state.gallerySortBy == sort.first &&
                                state.gallerySortDir == sort.second)
                                Text("✓", color = MaterialTheme.colorScheme.primary)
                        },
                        modifier = Modifier.testTag(
                            "gallery-sort-${sort.first}-${sort.second}"),
                        onClick = {
                            displayMenuOpen = false
                            controller.changeGallerySort(sort.first, sort.second)
                        },
                    )
                }
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("放大缩略图") },
                    enabled = preferredColumns > 2,
                    modifier = Modifier.testTag("gallery-zoom-in"),
                    onClick = {
                        preferredColumns = (preferredColumns - 1).coerceAtLeast(2)
                        displayMenuOpen = false
                    },
                )
                DropdownMenuItem(
                    text = { Text("缩小缩略图") },
                    enabled = preferredColumns < 10,
                    modifier = Modifier.testTag("gallery-zoom-out"),
                    onClick = {
                        preferredColumns = (preferredColumns + 1).coerceAtMost(10)
                        displayMenuOpen = false
                    },
                )
                // Day-scale is in PWA More rather than the floating
                // Year/Month/All capsule; keep the real indexed day jump.
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("按日浏览") },
                    enabled = state.gallerySearchQuery.isEmpty() &&
                        state.galleryTimelineSets?.day?.isNotEmpty() == true,
                    modifier = Modifier.testTag("gallery-day-scale-more"),
                    onClick = {
                        displayMenuOpen = false
                        timeScale = "day"
                        timePickerOpen = true
                    },
                )
                HorizontalDivider()
                DropdownMenuItem(
                    text = { Text("方形裁切") },
                    trailingIcon = { if (!containTiles) Text("✓", color = MaterialTheme.colorScheme.primary) },
                    modifier = Modifier.testTag("gallery-aspect-crop"),
                    onClick = { containTiles = false; displayMenuOpen = false },
                )
                DropdownMenuItem(
                    text = { Text("完整比例（方形网格）") },
                    trailingIcon = { if (containTiles) Text("✓", color = MaterialTheme.colorScheme.primary) },
                    modifier = Modifier.testTag("gallery-aspect-contain"),
                    onClick = { containTiles = true; displayMenuOpen = false },
                )
            }
        }
    }
    DownloadToDeviceStatus(state, controller, "gallery")
    if (state.error != null) {
        ErrorNotice(state.error)
        TextButton(onClick = controller::retryGallery,
            modifier = Modifier.padding(horizontal = 12.dp).heightIn(min = 48.dp)
                .testTag("gallery-retry-page")) {
            Text(when {
                !state.galleryLoaded && state.galleryJumpIndex != null -> "重试日期跳转"
                state.galleryPageIntent == "newer" &&
                    state.gallerySortDir == "desc" -> "重试加载更早的照片"
                state.galleryPageIntent == "newer" -> "重试加载较新的照片"
                state.galleryLoaded -> "重试加载更早的照片"
                else -> "重新加载照片"
            })
        }
    }

    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().testTag("gallery-wall")) {
        val columns = galleryVisibleColumns(maxWidth.value, preferredColumns)
        val tileGap = 4.dp // Shared PWA Gallery grid gap.
        val cellWidth = (maxWidth - tileGap * (columns - 1)) / columns
        val rows = (state.galleryItems.size + columns - 1) / columns
        val blankTop = if (state.gallerySortDir == "asc" &&
            state.galleryLoaded && state.galleryItems.isNotEmpty()) {
            (maxHeight - (cellWidth + tileGap) * rows - 8.dp).coerceAtLeast(0.dp)
        } else 0.dp

        // Initial tail is sparse: prefetch one earlier Range before first positioning.
        // Never reposition after a prepend; stable item keys retain the photo anchor.
        LaunchedEffect(state.galleryLoaded, state.galleryOffset, state.galleryItems.size,
            state.galleryJumpEpoch, state.loading, state.error) {
            if (!state.galleryLoaded) {
                positioned = false // An explicit refresh must position latest again.
                return@LaunchedEffect
            }
            if (state.loading || state.error != null || positioned) return@LaunchedEffect
            if (state.galleryJumpIndex != null) {
                // A Server-indexed time jump starts at its actual first item.
                gridState.scrollToItem(if (blankTop > 0.dp) 1 else 0)
                positioned = true
            } else if (state.galleryOffset > 0 && state.galleryItems.size < 24) {
                controller.galleryLoadOlder()
            } else {
                val last = state.galleryItems.lastIndex
                if (last >= 0) {
                    val first = if (state.gallerySortDir == "desc") 0
                        else last + (if (blankTop > 0.dp) 1 else 0)
                    gridState.scrollToItem(first)
                }
                positioned = true
            }
        }

        // No permanent "load older" row: a stable-key grid keeps the visible
        // existing photo anchored when older rows are inserted at index zero.
        // A failed Owner Range stays visible and cannot produce a fetch storm.
        LaunchedEffect(positioned, nearOlderEdge, state.galleryOffset,
            state.galleryLoaded, state.loading, state.error) {
            if (!positioned || !state.galleryLoaded) return@LaunchedEffect
            if (!nearOlderEdge) {
                olderEdgeArmed = true
            } else if (olderEdgeArmed && state.galleryOffset > 0 &&
                !state.loading && state.error == null) {
                olderEdgeArmed = false
                controller.galleryLoadOlder()
            }
        }

        LaunchedEffect(positioned, nearNewerEdge, state.galleryItems.size,
            state.galleryTotal, state.loading, state.error) {
            if (!positioned || !state.galleryLoaded) return@LaunchedEffect
            val hasNewer = state.galleryOffset.toLong() + state.galleryItems.size <
                state.galleryTotal
            if (!nearNewerEdge) {
                newerEdgeArmed = true
            } else if (hasNewer && newerEdgeArmed && !state.loading &&
                state.error == null) {
                newerEdgeArmed = false
                controller.galleryLoadNewer()
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(columns),
            state = gridState,
            modifier = Modifier.fillMaxSize().testTag("gallery-grid"),
            contentPadding = PaddingValues(bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(tileGap),
            verticalArrangement = Arrangement.spacedBy(tileGap),
        ) {
            if (state.galleryLoaded && state.galleryItems.isEmpty() &&
                !state.loading && state.error == null) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(when {
                        state.gallerySearchQuery.isNotEmpty() -> "没有匹配的照片或视频"
                        state.galleryMediaKind == "image" -> "暂无照片"
                        state.galleryMediaKind == "video" -> "暂无视频"
                        else -> "暂无照片或视频"
                    }, Modifier.padding(24.dp))
                }
            }
            if (blankTop > 0.dp) item(key = "tail-spacer", span = { GridItemSpan(maxLineSpan) }) {
                Spacer(Modifier.fillMaxWidth().height(blankTop))
            }
            items(state.galleryItems, key = { it.node.id }) { item ->
                GalleryTile(item, controller, bitmaps, containTiles,
                    state.gallerySelectionMode,
                    state.gallerySelectedItems.any { it.node.id == item.node.id })
            }
        }
    }
    val timeSets = state.galleryTimelineSets
    // PWA source has a time capsule above a separate primary/Search dock.
    // Android has no actual Collections client yet: preserve a functional
    // native classification action rather than adding a fake Collections tab.
    if (!state.gallerySelectionMode && timeSets != null &&
        state.gallerySearchQuery.isEmpty() &&
        state.gallerySortBy == "captured" && state.gallerySortDir == "asc") {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)
                .testTag("gallery-time-dock"),
            horizontalArrangement = Arrangement.Center,
        ) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.84f),
                shape = RoundedCornerShape(50.dp),
                tonalElevation = 2.dp,
            ) {
                Row(Modifier.padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for ((scale, label) in listOf(
                        "year" to "年", "month" to "月", "all" to "全部"
                    )) {
                        val enabled = !state.loading &&
                            (scale == "all" || timeSets.forScale(scale).isNotEmpty())
                        Box(
                            modifier = Modifier.widthIn(min = 58.dp).heightIn(min = 44.dp)
                                .background(
                                    if (timeScale == scale) MaterialTheme.colorScheme.surface
                                    else Color.Transparent,
                                    RoundedCornerShape(50.dp),
                                )
                                .clickable(enabled = enabled) {
                                    timeScale = scale
                                    if (scale == "all") {
                                        timePickerOpen = false
                                        if (state.galleryJumpIndex != null)
                                            controller.refreshGallery()
                                    } else timePickerOpen = true
                                }
                                .semantics { selected = timeScale == scale }
                                .testTag("gallery-time-scale-" + scale),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(label,
                                modifier = Modifier.padding(horizontal = 10.dp),
                                style = MaterialTheme.typography.labelMedium,
                                color = if (!enabled)
                                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                                else if (timeScale == scale)
                                    MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            }
        }
    }
    // iOS PWA primary capsule: the middle action must be the real
    // Collections page, never an unrelated media kind filter.
    if (state.gallerySelectionMode) GallerySelectionActions(state, controller)
    else Surface(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .testTag("gallery-bottom-dock"),
        color = Color.Transparent,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.gallerySelectedAlbum != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.84f),
                    shape = RoundedCornerShape(50.dp), tonalElevation = 2.dp,
                ) {
                    TextButton(
                        onClick = controller::closeGalleryAlbum,
                        modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("gallery-album-back"),
                    ) { Text("返回精选集") }
                }
            } else {
                Surface(
                    modifier = Modifier.weight(1f).widthIn(max = 288.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.84f),
                    shape = RoundedCornerShape(50.dp),
                    tonalElevation = 2.dp,
                ) {
                    Row(Modifier.fillMaxWidth().padding(4.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.weight(1f).heightIn(min = 44.dp)
                                .background(MaterialTheme.colorScheme.surface,
                                    RoundedCornerShape(50.dp))
                                .testTag("gallery-library-tab"),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("图库", style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.primary)
                        }
                        TextButton(
                            onClick = controller::openGalleryCollections,
                            contentPadding = PaddingValues(horizontal = 5.dp),
                            modifier = Modifier.weight(1f).heightIn(min = 44.dp)
                                .testTag("gallery-open-collections"),
                        ) { Text("精选集", maxLines = 1) }
                    }
                }
                TextButton(
                    onClick = {
                        searchDraft = state.gallerySearchQuery
                        searchOpen = true
                    },
                    contentPadding = PaddingValues(horizontal = 8.dp),
                    modifier = Modifier.heightIn(min = 50.dp).widthIn(min = 50.dp)
                        .testTag("gallery-search-button"),
                ) { Text("搜索", maxLines = 1) }
            }
        }
    }
    if (kindMenuOpen) {
        ModalBottomSheet(
            onDismissRequest = { kindMenuOpen = false },
            modifier = Modifier.testTag("gallery-kind-sheet"),
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                Modifier.fillMaxWidth().heightIn(min = 240.dp, max = 420.dp)
                    .padding(horizontal = 16.dp).padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("分类", style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(bottom = 4.dp))
                Text("按媒体类型筛选当前账户的整个图库；精选集在底部单独打开。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                for ((value, label) in listOf(
                    "" to "全部媒体", "image" to "仅照片", "video" to "仅视频"
                )) {
                    TextButton(
                        onClick = {
                            kindMenuOpen = false
                            controller.filterGalleryKind(value)
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("gallery-kind-" +
                                if (value.isEmpty()) "all" else value),
                    ) {
                        Row(Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(label)
                            if (state.galleryMediaKind == value)
                                Text("✓", color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }
    if (timePickerOpen && timeSets != null && timeScale != "all" &&
        state.gallerySearchQuery.isEmpty()) {
        val groups = timeSets.forScale(timeScale)
        ModalBottomSheet(onDismissRequest = { timePickerOpen = false },
            containerColor = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)) {
                Text("跳转到" + when (timeScale) {
                    "year" -> "年份"
                    "month" -> "月份"
                    else -> "日期"
                }, style = MaterialTheme.typography.titleMedium)
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)
                    .testTag("gallery-time-groups")) {
                    listItems(groups, key = { it.key }) { group ->
                        TextButton(
                            onClick = {
                                timePickerOpen = false
                                controller.jumpGalleryToGroup(timeScale, group.key)
                            },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("gallery-time-group-" + group.key),
                        ) {
                            Text(galleryTimelineGroupLabel(group) + " · " +
                                group.itemCount + " 项")
                        }
                    }
                }
            }
        }
    }
    if (searchOpen) ModalBottomSheet(onDismissRequest = { searchOpen = false },
        containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("搜索全部照片与视频", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(value = searchDraft, onValueChange = { if (it.length <= 200) searchDraft = it },
                label = { Text("搜索图库") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                    .testTag("gallery-search-input"))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { searchOpen = false },
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
                Button(onClick = {
                    searchOpen = false
                    controller.searchGallery(searchDraft)
                }, modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-search-apply")) {
                    Text("搜索")
                }
            }
        }
    }
}

internal fun decodeGalleryThumbnail(bytes: ByteArray): ImageBitmap? {
    if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth !in 1..4096 || bounds.outHeight !in 1..4096) return null
    val scale = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 256)
    val options = BitmapFactory.Options().apply { inSampleSize = scale }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GalleryTile(
    item: GalleryAsset, controller: DriveController,
    cache: LruCache<String, ImageBitmap>,
    containTiles: Boolean,
    selectionMode: Boolean,
    isSelected: Boolean,
) {
    val key = "${item.node.id}:${item.node.revision}"
    // A new Owner Range/revision or thumbnail-availability change invalidates
    // the bitmap. A refreshed metadata object for the SAME version must not
    // reset failed/retry state or start a duplicate thumbnail GET. Gallery is
    // unmounted on Owner/app changes, so its in-memory cache is Owner-scoped.
    var bitmap by remember(key, item.hasThumbnail) { mutableStateOf(cache.get(key)) }
    var retryAttempt by remember(key, item.hasThumbnail) { mutableIntStateOf(0) }
    var loading by remember(key, item.hasThumbnail) {
        mutableStateOf(bitmap == null && item.hasThumbnail)
    }
    var failed by remember(key, item.hasThumbnail) { mutableStateOf(false) }

    // Never key the network effect on the entire GalleryAsset: pagination or
    // metadata refresh may replace its instance without changing image bytes.
    // Only a version/availability change or explicit long press retries.
    LaunchedEffect(key, item.hasThumbnail, retryAttempt) {
        if (bitmap != null || !item.hasThumbnail) return@LaunchedEffect
        loading = true
        failed = false
        val bytes = controller.galleryThumbnail(item)
        val decoded = bytes?.let {
            withContext(Dispatchers.Default) {
                try { decodeGalleryThumbnail(it) }
                catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                catch (_: Exception) { null }
            }
        }
        if (decoded != null) {
            cache.put(key, decoded)
            bitmap = decoded
        } else {
            // Optional derived media may be missing or invalid. Never spin or
            // retry HTTP automatically; only the current Owner can retry.
            failed = true
        }
        loading = false
    }

    Box(Modifier.fillMaxWidth().aspectRatio(1f)
        .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
        .background(MaterialTheme.colorScheme.surfaceContainerLow)
        // In selection mode the real visible media toggles; never open Viewer.
        .combinedClickable(
            onClick = {
                if (selectionMode) controller.toggleGallerySelection(item)
                else if (item.mediaKind == "image" || item.mediaKind == "video")
                    controller.openGalleryViewer(item)
                else controller.showGalleryInfo(item)
            },
            onLongClickLabel = if (failed) "重试缩略图" else if (!selectionMode) "选择照片" else null,
            onLongClick = when {
                failed -> ({ retryAttempt++ })
                !selectionMode -> ({
                    controller.setGallerySelectionMode(true)
                    controller.toggleGallerySelection(item)
                })
                else -> null
            },
        )
        .semantics { if (selectionMode) selected = isSelected }
        .testTag("gallery-item-${item.node.id}")) {
        val ready = bitmap
        if (ready != null) {
            Image(bitmap = ready, contentDescription = item.node.name,
                contentScale = if (containTiles) ContentScale.Fit else ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
                    .testTag("gallery-thumbnail-ready-${item.node.id}"))
        } else {
            Icon(painterResource(if (item.mediaKind == "video") R.drawable.xd_movie else R.drawable.xd_image),
                contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.Center).size(30.dp))
        }
        if (loading && ready == null) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp)
                    .size(20.dp).testTag("gallery-thumbnail-loading-${item.node.id}"),
                strokeWidth = 2.dp,
            )
        } else if (failed && ready == null && item.hasThumbnail) {
            // Status text, not a floating control. The tile itself exposes an
            // accessible labelled long-click retry without changing short tap.
            Text("失败·长按重试",
                modifier = Modifier.align(Alignment.BottomStart)
                    .padding(4.dp)
                    .background(Color.Black.copy(alpha = 0.55f),
                        androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                    .padding(horizontal = 4.dp, vertical = 2.dp)
                    .testTag("gallery-thumbnail-failed-${item.node.id}"),
                color = Color.White, style = MaterialTheme.typography.labelSmall)
        }
        if (isSelected) {
            Surface(modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
                .testTag("gallery-selected-mark-${item.node.id}"),
                shape = RoundedCornerShape(50.dp),
                color = MaterialTheme.colorScheme.primary) {
                Text("✓", modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    color = MaterialTheme.colorScheme.onPrimary)
            }
        }
        if (item.livePhoto || item.mediaKind == "video") {
            Text(if (item.livePhoto) "实况" else "视频",
                modifier = Modifier.align(Alignment.BottomEnd)
                    .padding(4.dp)
                    .background(Color.Black.copy(alpha = 0.55f),
                        androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                color = Color.White, style = MaterialTheme.typography.labelSmall)
        }
    }
}
