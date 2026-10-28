package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** One genuine Owner Gallery Range limited to a signed BD09 map cell.
 * Tiles and Viewer are the shared native Gallery implementations. */
@Composable
internal fun ColumnScope.GalleryMapCellWall(
    state: DriveState, controller: DriveController,
    bitmaps: LruCache<String, ImageBitmap>,
) {
    val cell = state.galleryMapCellSelected ?: return
    val gridState = rememberLazyGridState()
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = controller::closeGalleryBd09Cell,
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-map-cell-back")) {
                Text("返回地图")
            }
            Text("BD-09 网格 ${cell.cellX + 1}-${cell.cellY + 1}",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium)
        }
        Text("当前账户已验证的照片范围 · 网格 ${cell.photoCount} 张，" +
            "当前 Gallery ${if (state.galleryLoaded) state.galleryTotal else "待确认"} 项",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag("gallery-map-cell-count"))
        if (state.error != null) {
            Text("网格照片读取失败或范围已变化。请返回地图刷新网格；" +
                "不会回退到全库照片。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.testTag("gallery-map-cell-error"))
            TextButton(onClick = controller::retryGalleryBd09Cell,
                enabled = !state.loading,
                modifier = Modifier.testTag("gallery-map-cell-retry")) {
                Text("只重试此网格读取")
            }
        }
    }
    if (!state.galleryLoaded) {
        Box(Modifier.fillMaxWidth().weight(1f)
            .testTag("gallery-map-cell-loading"), contentAlignment = Alignment.Center) {
            if (state.loading) CircularProgressIndicator()
            else Text(if (state.error != null) "当前网格未加载" else "正在读取网格照片")
        }
        return
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(3), state = gridState,
        modifier = Modifier.fillMaxWidth().weight(1f)
            .testTag("gallery-map-cell-wall"),
        contentPadding = PaddingValues(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (state.galleryItems.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
            Text("此网格中没有可显示的照片或视频。", Modifier.padding(20.dp))
        }
        items(state.galleryItems, key = { it.node.id }) { item ->
            GalleryTile(item, controller, bitmaps, containTiles = false,
                selectionMode = false, isSelected = false, allowSelection = false)
        }
        if (state.galleryOffset.toLong() + state.galleryItems.size < state.galleryTotal &&
            state.error == null) item(key = "more", span = { GridItemSpan(maxLineSpan) }) {
            TextButton(onClick = controller::galleryLoadNewer,
                enabled = !state.loading,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("gallery-map-cell-more")) {
                Text(if (state.loading) "正在加载" else "加载更多网格照片")
            }
        }
    }
}
