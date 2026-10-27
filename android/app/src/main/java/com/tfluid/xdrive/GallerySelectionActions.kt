package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** iOS PWA selection surface backed by actual Owner media metadata PATCH.
 * Never advertises batch download/album deletion without a real implementation. */
@Composable
internal fun GallerySelectionActions(state: DriveState, controller: DriveController) {
    val selected = state.gallerySelectedItems
    val uncertain = state.galleryFavoriteWriteAttempted
    val enabled = selected.isNotEmpty() && !state.loading &&
        !uncertain && state.error == null
    val allFavorite = selected.isNotEmpty() && selected.all { it.favorite == true }
    Surface(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .testTag("gallery-selection-actions"),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(22.dp),
        tonalElevation = 2.dp,
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(
                    onClick = { controller.setGallerySelectionMode(false) },
                    enabled = !state.loading && !uncertain,
                    modifier = Modifier.testTag("gallery-selection-done").heightIn(min = 48.dp),
                ) { Text("完成") }
                Text("已选择 ${selected.size} 项（最多 200）",
                    modifier = Modifier.padding(top = 16.dp),
                    style = MaterialTheme.typography.bodyMedium)
            }
            if (uncertain) {
                TextButton(
                    onClick = controller::refreshGallery,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth().testTag("gallery-selection-reconcile")
                        .heightIn(min = 48.dp),
                ) { Text("刷新核对（不重复提交）") }
            } else {
                Button(
                    onClick = { controller.favoriteGallerySelected(!allFavorite) },
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth().testTag("gallery-selection-favorite")
                        .heightIn(min = 48.dp),
                ) { Text(if (allFavorite) "取消收藏" else "收藏") }
            }
        }
    }
}
