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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAsset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Initial native Gallery wall: real Owner chronological Range, latest at
 * bottom, native thumbnails and bounded cancellation. No faux Viewer/Albums. */
@Composable
internal fun ColumnScope.Gallery(state: DriveState, controller: DriveController) {
    val gridState = rememberLazyGridState()
    val bitmaps = remember { LruCache<String, ImageBitmap>(48) }
    // Preserve the visible photo anchor while the Viewer is open.
    var positioned by rememberSaveable { mutableStateOf(false) }
    // A single entrance to the oldest visible edge permits only one fetch.
    // Re-arm after scrolling away: do not recursively traverse a 100k library
    // while Compose is still remeasuring newly prepended rows.
    var olderEdgeArmed by remember { mutableStateOf(true) }
    val nearOlderEdge by remember(gridState) {
        derivedStateOf { gridState.firstVisibleItemIndex <= 3 }
    }

    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("图库", modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (state.galleryLoaded) Text("${state.galleryTotal} 项",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        val columns = maxOf(1, (maxWidth / 112.dp).toInt())
        val cellWidth = (maxWidth - (columns - 1).dp) / columns
        val rows = (state.galleryItems.size + columns - 1) / columns
        val blankTop = if (state.galleryLoaded && state.galleryItems.isNotEmpty()) {
            (maxHeight - (cellWidth + 1.dp) * rows - 8.dp).coerceAtLeast(0.dp)
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
            horizontalArrangement = Arrangement.spacedBy(1.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            if (state.galleryLoaded && state.galleryItems.isEmpty() &&
                !state.loading && state.error == null) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text("暂无照片或视频", Modifier.padding(24.dp))
                }
            }
            if (blankTop > 0.dp) item(key = "tail-spacer", span = { GridItemSpan(maxLineSpan) }) {
                Spacer(Modifier.fillMaxWidth().height(blankTop))
            }
            items(state.galleryItems, key = { it.node.id }) { item ->
                GalleryTile(item, controller, bitmaps)
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
                contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
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
