package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import com.tfluid.xdrive.core.parseGalleryTagInput
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** iOS PWA selection surface backed by actual Owner media metadata PATCH.
 * Never advertises batch download/album deletion without a real implementation. */
@Composable
internal fun GallerySelectionActions(state: DriveState, controller: DriveController) {
    val selected = state.gallerySelectedItems
    val uncertain = state.galleryMetadataWriteAttempted
    var tagsOpen by remember { mutableStateOf(false) }
    var reviewOpen by remember { mutableStateOf(false) }
    var albumsOpen by remember { mutableStateOf(false) }
    var tagsDraft by remember { mutableStateOf("") }
    val tags = remember(tagsDraft) { parseGalleryTagInput(tagsDraft) }
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
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                TextButton(
                    onClick = { controller.setGallerySelectionMode(false) },
                    enabled = !state.loading && !uncertain,
                    modifier = Modifier.testTag("gallery-selection-done").heightIn(min = 48.dp),
                ) { Text("完成") }
                TextButton(
                    onClick = { reviewOpen = true },
                    enabled = selected.isNotEmpty() && !state.loading && !uncertain,
                    modifier = Modifier.testTag("gallery-selection-review-open")
                        .heightIn(min = 48.dp),
                ) { Text("查看已选项") }
                Text("已选 ${selected.size}/200",
                    style = MaterialTheme.typography.bodySmall)
            }
            if (uncertain) {
                TextButton(
                    onClick = controller::refreshGallery,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth().testTag("gallery-selection-reconcile")
                        .heightIn(min = 48.dp),
                ) { Text("刷新核对（不重复提交）") }
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { controller.favoriteGallerySelected(!allFavorite) },
                        enabled = enabled,
                        modifier = Modifier.weight(1f).testTag("gallery-selection-favorite")
                            .heightIn(min = 48.dp),
                    ) { Text(if (allFavorite) "取消收藏" else "收藏") }
                    Button(
                        onClick = { tagsDraft = ""; tagsOpen = true },
                        enabled = enabled,
                        modifier = Modifier.weight(1f).testTag("gallery-selection-tags")
                            .heightIn(min = 48.dp),
                    ) { Text("添加标签") }
                }
                OutlinedButton(
                    onClick = {
                        albumsOpen = true
                        controller.loadGalleryAlbumsForSelection()
                    },
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth()
                        .testTag("gallery-selection-add-album").heightIn(min = 48.dp),
                ) { Text("添加到相册") }
            }
        }
    }
    if (tagsOpen && !uncertain) AlertDialog(
        onDismissRequest = { if (!state.loading) tagsOpen = false },
        modifier = Modifier.testTag("gallery-tags-dialog"),
        title = { Text("添加标签到 ${selected.size} 项") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("用逗号分隔，每次最多 32 个标签，每个最多 64 个字符。",
                    style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = tagsDraft,
                    onValueChange = { if (it.length <= 4096) tagsDraft = it },
                    singleLine = true,
                    label = { Text("标签") },
                    modifier = Modifier.fillMaxWidth().testTag("gallery-tags-input"),
                )
                if (tagsDraft.isNotBlank() && tags == null)
                    Text("标签无效，请检查数量、字符或控制符。",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val selectedTags = tags ?: return@TextButton
                    tagsOpen = false
                    controller.tagGallerySelected(selectedTags)
                },
                enabled = enabled && tags != null,
                modifier = Modifier.testTag("gallery-tags-confirm").heightIn(min = 48.dp),
            ) { Text("添加") }
        },
        dismissButton = {
            TextButton(
                onClick = { tagsOpen = false },
                enabled = !state.loading,
                modifier = Modifier.testTag("gallery-tags-cancel").heightIn(min = 48.dp),
            ) { Text("取消") }
        },
    )
    if (reviewOpen && !uncertain)
        GallerySelectionReviewDialog(state, controller) { reviewOpen = false }
    if (albumsOpen && !uncertain) {
        val writable = state.galleryAlbums.filter {
            it.kind == "manual" && it.revision > 0
        }
        AlertDialog(
            onDismissRequest = { if (!state.loading) albumsOpen = false },
            modifier = Modifier.testTag("gallery-album-picker"),
            title = { Text("添加到相册") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("将已选 " + selected.size + " 项加入已有手动相册（不复制原文件）。",
                        style = MaterialTheme.typography.bodySmall)
                    when {
                        state.loading -> CircularProgressIndicator(
                            modifier = Modifier.testTag("gallery-album-picker-loading"))
                        !state.galleryAlbumsLoaded -> {
                            Text(state.error ?: "相册列表未载入。",
                                color = MaterialTheme.colorScheme.error)
                            TextButton(
                                onClick = controller::loadGalleryAlbumsForSelection,
                                modifier = Modifier.testTag("gallery-album-picker-retry"),
                            ) { Text("重试读取相册") }
                        }
                        writable.isEmpty() -> Text("没有可写的手动相册；请先在精选集创建。")
                        else -> LazyColumn(
                            modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp),
                        ) {
                            items(writable, key = { it.id }) { album ->
                                TextButton(
                                    onClick = {
                                        albumsOpen = false
                                        controller.addGallerySelectedToAlbum(album)
                                    },
                                    enabled = enabled,
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                        .testTag("gallery-add-album-" + album.id),
                                ) { Text(album.name + " · " + album.itemCount + " 项") }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { albumsOpen = false }, enabled = !state.loading,
                    modifier = Modifier.testTag("gallery-album-picker-close")) {
                    Text("关闭")
                }
            },
        )
    }
}
