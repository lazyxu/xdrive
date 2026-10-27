package com.tfluid.xdrive

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAlbum

/** Real read-only Owner PhotoCollections; never a fake album list made from
 * the currently visible Gallery tiles or a second Android media index. */
@Composable
internal fun ColumnScope.GalleryCollections(
    state: DriveState,
    controller: DriveController,
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
        else -> LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-albums-list"),
            state = rememberLazyListState(),
            contentPadding = PaddingValues(bottom = 8.dp),
        ) {
            items(state.galleryAlbums, key = { it.id }) { album ->
                Row(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = !state.loading) {
                            controller.openGalleryAlbum(album)
                        }
                        .heightIn(min = 68.dp)
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .testTag("gallery-album-item-${album.id}"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(painterResource(R.drawable.xd_folder), contentDescription = null,
                        modifier = Modifier.size(40.dp),
                        tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f)) {
                        Text(album.name, style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${galleryAlbumKindLabel(album)} · ${album.itemCount} 项",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(Modifier.padding(start = 68.dp))
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

private fun galleryAlbumKindLabel(album: GalleryAlbum): String = when (album.kind) {
    "manual" -> "个人相册"
    "smart" -> "智能相册"
    "imported" -> "导入相册"
    "folder" -> "相册文件夹"
    else -> "相册"
}
