package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAlbum
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Real read-only Owner PhotoCollections; never a fake album list made from
 * the currently visible Gallery tiles or a second Android media index. */
@Composable
internal fun ColumnScope.GalleryCollections(
    state: DriveState,
    controller: DriveController,
    cache: LruCache<String, ImageBitmap>,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("精选集", style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (state.galleryAlbumsLoaded) {
            Text("${state.galleryAlbums.size} 个相册",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
        }
    }
    when {
        state.error != null && !state.galleryAlbumsLoaded -> Column(
            Modifier.weight(1f).fillMaxWidth().padding(20.dp)
                .testTag("gallery-albums-error"),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("无法读取当前账户的相册，请重试。")
            TextButton(onClick = controller::retryGalleryAlbums,
                enabled = !state.loading, modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-albums-retry")) { Text("重试读取相册") }
        }
        !state.galleryAlbumsLoaded -> Box(
            Modifier.weight(1f).fillMaxWidth().testTag("gallery-albums-loading"),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }
        state.galleryAlbums.isEmpty() -> Box(
            Modifier.weight(1f).fillMaxWidth().testTag("gallery-albums-empty"),
            contentAlignment = Alignment.Center,
        ) {
            Text("暂无相册", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        else -> LazyVerticalGrid(
            // Match Mobile PWA Collections' 144dp image-card baseline. Lazy
            // composition prevents fetching covers for offscreen albums.
            columns = GridCells.Adaptive(minSize = 144.dp),
            modifier = Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-albums-list"),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
        ) {
            items(state.galleryAlbums, key = { it.id }) { album ->
                GalleryAlbumCard(album, controller, cache, state.loading)
            }
        }
    }
    // The same two-tab capsule and safe-area geometry as Gallery Library.
    Surface(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .testTag("gallery-collections-bottom"),
        color = Color.Transparent,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth().widthIn(max = 288.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.84f),
                shape = RoundedCornerShape(50.dp),
                tonalElevation = 2.dp,
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = controller::openGalleryLibrary,
                        modifier = Modifier.weight(1f).heightIn(min = 44.dp)
                            .testTag("gallery-collections-to-library"),
                    ) { Text("图库") }
                    Box(
                        Modifier.weight(1f).heightIn(min = 44.dp)
                            .background(MaterialTheme.colorScheme.surface,
                                RoundedCornerShape(50.dp))
                            .testTag("gallery-collections-active-tab"),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("精选集", style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

/** Read-only 144dp card. Fetch the Server-designated cover only after it
 * resolves to a current Owner media revision; never guess a cover from the
 * already-visible Library rows or persist credentials/private image data. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GalleryAlbumCard(
    album: GalleryAlbum,
    controller: DriveController,
    cache: LruCache<String, ImageBitmap>,
    busy: Boolean,
) {
    val identity = "${album.id}:${album.revision}:${album.coverNodeId}"
    var bitmap by remember(identity) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(identity) { mutableStateOf(false) }
    var loading by remember(identity) {
        mutableStateOf(album.coverNodeId != null)
    }
    var retry by remember(identity) { mutableIntStateOf(0) }
    LaunchedEffect(identity, retry) {
        if (album.coverNodeId == null || bitmap != null) return@LaunchedEffect
        loading = true
        failed = false
        try {
            val result = controller.galleryAlbumCover(album)
            if (result != null) {
                val key = "${result.nodeId}:${result.revision}"
                val decoded = cache.get(key) ?: withContext(Dispatchers.Default) {
                    decodeGalleryThumbnail(result.jpegBytes)
                }
                if (decoded != null) {
                    cache.put(key, decoded)
                    bitmap = decoded
                } else failed = true
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Derived cover is optional, so never make the real album
            // inaccessible or auto-retry an unbounded/denied response.
            failed = true
        } finally {
            loading = false
        }
    }

    Column(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .combinedClickable(
                enabled = !busy,
                onClick = { controller.openGalleryAlbum(album) },
                onLongClickLabel = if (failed) "重试相册封面" else null,
                onLongClick = if (failed) ({ retry++ }) else null,
            )
            .testTag("gallery-album-item-${album.id}"),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f)
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .testTag("gallery-album-cover-${album.id}"),
        ) {
            val ready = bitmap
            if (ready != null) {
                Image(
                    bitmap = ready, contentDescription = album.name + "相册封面",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                        .testTag("gallery-album-cover-ready-${album.id}"),
                )
            } else {
                Icon(
                    painterResource(R.drawable.xd_folder), contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.Center).size(44.dp),
                )
            }
            if (loading && ready == null && album.coverNodeId != null) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.BottomStart)
                        .padding(8.dp).size(20.dp)
                        .testTag("gallery-album-cover-loading-${album.id}"),
                    strokeWidth = 2.dp,
                )
            } else if (failed && ready == null) {
                Text("封面失败·长按重试",
                    modifier = Modifier.align(Alignment.BottomStart)
                        .background(Color.Black.copy(alpha = 0.55f))
                        .padding(horizontal = 4.dp, vertical = 2.dp)
                        .testTag("gallery-album-cover-failed-${album.id}"),
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall)
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(album.name, style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${galleryAlbumKindLabel(album)} · ${album.itemCount} 项",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun galleryAlbumKindLabel(album: GalleryAlbum): String = when (album.kind) {
    "manual" -> "个人相册"
    "smart" -> "智能相册"
    "imported" -> "导入相册"
    "folder" -> "相册文件夹"
    else -> "相册"
}
