package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tfluid.xdrive.core.GalleryAsset

/** The native Gallery Viewer uses the same currently authorized Owner window
 * as the swipe controller. Nine tiles maximum; no new GET, token, URL or
 * persistent thumbnail cache. Absent cached tiles show an honest media glyph. */
@Composable
internal fun GalleryViewerFilmstrip(
    active: GalleryAsset,
    loaded: List<GalleryAsset>,
    busy: Boolean,
    thumbnails: LruCache<String, ImageBitmap>,
    controller: DriveController,
) {
    // Observe the actual current Owner/Viewer scope during recomposition.
    // A stale one-time StateFlow.value read fails Compose lint and can render
    // an old Owner filmstrip after screen or session transitions.
    val state by controller.state.collectAsState()
    if (state.screen != Screen.GALLERY || state.viewerReturnToFiles ||
        state.galleryViewer !== active || !state.galleryLoaded ||
        state.galleryItems !== loaded) return
    val index = loaded.indexOfFirst { it === active }
    val window = galleryViewerFilmstripWindow(loaded.size, index)
    if (window.isEmpty()) return
    val expectedEpoch = controller.galleryViewerFilmstripEpoch()

    LazyRow(
        modifier = Modifier.fillMaxWidth().background(Color.Black)
            .heightIn(min = 76.dp).navigationBarsPadding()
            .testTag("gallery-viewer-filmstrip"),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(window.toList(), key = { it }) { position ->
            val item = loaded[position]
            val current = position == index
            val permitted = item.node.id > 0 && item.node.revision > 0 &&
                item.node.type == "file" && item.mediaKind in setOf("image", "video")
            val caption = when {
                item.mediaKind == "video" -> "视频"
                item.livePhoto -> "实况"
                else -> "照片"
            }
            // A previously rendered Gallery tile is the ONLY preview source.
            // A missing bitmap is not a license to race the foreground original.
            val cached = thumbnails.get(item.node.id.toString() + ":" + item.node.revision)
            Surface(
                onClick = {
                    controller.selectGalleryViewerFilmstripItem(item, active, expectedEpoch)
                },
                enabled = !busy && !current && permitted,
                modifier = Modifier.size(width = 60.dp, height = 64.dp)
                    .testTag(if (current) "gallery-viewer-filmstrip-current"
                        else "gallery-viewer-filmstrip-tile-" + position)
                    .semantics {
                        contentDescription = caption + "：" + item.node.name
                        if (current) stateDescription = "当前媒体"
                    },
                shape = RoundedCornerShape(7.dp),
                color = Color.DarkGray,
                border = BorderStroke(if (current) 2.dp else 1.dp,
                    if (current) Color.White else Color.Gray),
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (cached != null) {
                        Image(
                            bitmap = cached,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    } else {
                        Text(caption, color = Color.White, fontSize = 11.sp)
                    }
                    if (cached != null && (item.mediaKind == "video" || item.livePhoto)) {
                        Text(
                            caption, color = Color.White, fontSize = 9.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.align(Alignment.BottomCenter)
                                .background(Color.Black.copy(alpha = 0.72f))
                                .padding(horizontal = 3.dp, vertical = 1.dp),
                        )
                    }
                }
            }
        }
    }
}
