package com.tfluid.xdrive

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAsset
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

/** Native Owner Gallery with same Server range for wall and search, never a local
 * filter of the few visible thumbnails. Full Collections controls follow later. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ColumnScope.Gallery(state: DriveState, controller: DriveController) {
    val gridState = rememberLazyGridState()
    val bitmaps = remember { LruCache<String, ImageBitmap>(48) }
    var searchOpen by remember { mutableStateOf(false) }
    var searchDraft by remember(state.gallerySearchQuery) { mutableStateOf(state.gallerySearchQuery) }
    // Display preferences are only local UI state and survive Viewer returns.
    var preferredColumns by rememberSaveable { mutableIntStateOf(3) }
    var containTiles by rememberSaveable { mutableStateOf(false) }
    var displayMenuOpen by remember { mutableStateOf(false) }
    // Preserve the visible photo anchor while the Viewer is open.
    var positioned by rememberSaveable(state.gallerySearchQuery) { mutableStateOf(false) }
    // A single entrance to the oldest visible edge permits only one fetch.
    // Re-arm after scrolling away: do not recursively traverse a 100k library
    // while Compose is still remeasuring newly prepended rows.
    var olderEdgeArmed by remember(state.gallerySearchQuery) { mutableStateOf(true) }
    val nearOlderEdge by remember(gridState) {
        derivedStateOf { gridState.firstVisibleItemIndex <= 3 }
    }

    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(if (state.gallerySearchQuery.isEmpty()) "图库" else "搜索结果",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (state.galleryLoaded) Text("${state.galleryTotal} 项",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box {
            IconButton(
                onClick = { displayMenuOpen = true },
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
    if (state.error != null) {
        ErrorNotice(state.error)
        TextButton(onClick = controller::retryGallery,
            modifier = Modifier.padding(horizontal = 12.dp).heightIn(min = 48.dp)
                .testTag("gallery-retry-page")) {
            Text(if (state.galleryLoaded) "重试加载更早的照片" else "重新加载照片")
        }
    }

    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().testTag("gallery-wall")) {
        val columns = galleryVisibleColumns(maxWidth.value, preferredColumns)
        val tileGap = 4.dp // Shared PWA Gallery grid gap.
        val cellWidth = (maxWidth - tileGap * (columns - 1)) / columns
        val rows = (state.galleryItems.size + columns - 1) / columns
        val blankTop = if (state.galleryLoaded && state.galleryItems.isNotEmpty()) {
            (maxHeight - (cellWidth + tileGap) * rows - 8.dp).coerceAtLeast(0.dp)
        } else 0.dp

        // Initial tail is sparse: prefetch one earlier Range before first positioning.
        // Never reposition after a prepend; stable item keys retain the photo anchor.
        LaunchedEffect(state.galleryLoaded, state.galleryOffset, state.galleryItems.size,
            state.loading, state.error) {
            if (!state.galleryLoaded) {
                positioned = false // An explicit refresh must position latest again.
                return@LaunchedEffect
            }
            if (state.loading || state.error != null || positioned) return@LaunchedEffect
            if (state.galleryOffset > 0 && state.galleryItems.size < 24) {
                controller.galleryLoadOlder()
            } else {
                val last = state.galleryItems.lastIndex
                if (last >= 0) {
                    gridState.scrollToItem(last + if (blankTop > 0.dp) 1 else 0)
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
                    Text(if (state.gallerySearchQuery.isEmpty()) "暂无照片或视频" else "没有匹配的照片或视频", Modifier.padding(24.dp))
                }
            }
            if (blankTop > 0.dp) item(key = "tail-spacer", span = { GridItemSpan(maxLineSpan) }) {
                Spacer(Modifier.fillMaxWidth().height(blankTop))
            }
            items(state.galleryItems, key = { it.node.id }) { item ->
                GalleryTile(item, controller, bitmaps, containTiles)
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
        if (state.gallerySearchQuery.isNotEmpty()) {
            TextButton(onClick = { controller.searchGallery("") },
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-search-clear")) {
                Text("清除筛选")
            }
        }
        FilledTonalButton(onClick = {
            searchDraft = state.gallerySearchQuery
            searchOpen = true
        }, modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-search-button")) {
            Text("搜索")
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

private fun decodeThumbnail(bytes: ByteArray): ImageBitmap? {
    if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth !in 1..4096 || bounds.outHeight !in 1..4096) return null
    val scale = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 256)
    val options = BitmapFactory.Options().apply { inSampleSize = scale }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
}

@Composable
private fun GalleryTile(
    item: GalleryAsset, controller: DriveController,
    cache: LruCache<String, ImageBitmap>,
    containTiles: Boolean,
) {
    val key = "${item.node.id}:${item.node.revision}"
    val bitmap by produceState<ImageBitmap?>(initialValue = cache.get(key), key1 = key) {
        if (value != null) return@produceState
        val bytes = controller.galleryThumbnail(item) ?: return@produceState
        val decoded = withContext(Dispatchers.Default) {
            try { decodeThumbnail(bytes) } catch (_: Exception) { null }
        }
        if (decoded != null) {
            cache.put(key, decoded)
            value = decoded
        }
    }
    Box(Modifier.fillMaxWidth().aspectRatio(1f)
        .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
        .background(MaterialTheme.colorScheme.surfaceContainerLow)
        .clickable(onClick = {
            if (item.mediaKind == "image" || item.mediaKind == "video")
                controller.openGalleryViewer(item)
            else controller.showGalleryInfo(item)
        })
        .testTag("gallery-item-${item.node.id}")) {
        if (bitmap != null) {
            Image(bitmap = bitmap!!, contentDescription = item.node.name,
                contentScale = if (containTiles) ContentScale.Fit else ContentScale.Crop,
                modifier = Modifier.fillMaxSize())
        } else {
            Icon(painterResource(if (item.mediaKind == "video") R.drawable.xd_movie else R.drawable.xd_image),
                contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.Center).size(30.dp))
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
