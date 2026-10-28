package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.tfluid.xdrive.core.GalleryAsset

private const val reviewPageSize = 100

/** Pure current-Owner selection filter, not a query-wide server search. */
internal fun gallerySelectedReviewFilter(
    selected: List<GalleryAsset>, query: String,
): List<GalleryAsset> {
    val needle = query.trim()
    return if (needle.isEmpty()) selected
        else selected.filter { it.node.name.contains(needle, ignoreCase = true) }
}

/** iOS PWA selected-items review: search, local remove/clear, bounded 100/page.
 * Not an implicit 100k Gallery snapshot and never an independent media writer. */
@Composable
internal fun GallerySelectionReviewDialog(
    state: DriveState, controller: DriveController, onClose: () -> Unit,
) {
    val selected = state.gallerySelectedItems
    val busy = state.loading || state.galleryMetadataWriteAttempted
    var query by remember { mutableStateOf("") }
    var page by remember { mutableIntStateOf(0) }
    val matching = remember(selected, query) { gallerySelectedReviewFilter(selected, query) }
    val pageCount = ((matching.size + reviewPageSize - 1) / reviewPageSize).coerceAtLeast(1)
    val effectivePage = page.coerceIn(0, pageCount - 1)
    val visible = matching.drop(effectivePage * reviewPageSize).take(reviewPageSize)

    Dialog(
        onDismissRequest = { if (!busy) onClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().fillMaxHeight(0.90f)
                .padding(horizontal = 8.dp).testTag("gallery-selection-review"),
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(20.dp),
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp)
                    .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("已选择 ${selected.size} 项",
                        style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = onClose, enabled = !busy,
                        modifier = Modifier.testTag("gallery-selection-review-close")
                            .heightIn(min = 48.dp)) { Text("关闭") }
                }
                HorizontalDivider()
                OutlinedTextField(
                    value = query,
                    onValueChange = { if (it.length <= 200) { query = it; page = 0 } },
                    singleLine = true, label = { Text("搜索已选文件") },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)
                        .testTag("gallery-selection-review-search"),
                )
                Text("已选列表匹配 ${matching.size} 项 · 每页最多 100 项",
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (visible.isEmpty()) {
                    Box(Modifier.weight(1f).fillMaxWidth().testTag("gallery-review-empty"),
                        contentAlignment = Alignment.Center) {
                        Text(if (selected.isEmpty()) "当前没有已选项" else "没有匹配的已选文件")
                    }
                } else {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth()
                        .testTag("gallery-selection-review-list")) {
                        items(visible, key = { it.node.id }) { item ->
                            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
                                .padding(horizontal = 12.dp)
                                .testTag("gallery-selected-review-item-${item.node.id}"),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.node.name, maxLines = 1,
                                        overflow = TextOverflow.Ellipsis)
                                    Text("文件 #${item.node.id} · " +
                                        if (item.mediaKind == "video") "视频" else "照片",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                TextButton(
                                    onClick = { controller.removeGallerySelected(item.node.id) },
                                    enabled = !busy,
                                    modifier = Modifier.heightIn(min = 48.dp)
                                        .testTag("gallery-selection-remove-${item.node.id}"),
                                ) { Text("移除") }
                            }
                            HorizontalDivider()
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { page = (effectivePage - 1).coerceAtLeast(0) },
                        enabled = effectivePage > 0 && !busy,
                        modifier = Modifier.testTag("gallery-review-prev")
                            .heightIn(min = 48.dp)) { Text("上一页") }
                    Text("${effectivePage + 1} / $pageCount",
                        style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { page = (effectivePage + 1).coerceAtMost(pageCount - 1) },
                        enabled = effectivePage < pageCount - 1 && !busy,
                        modifier = Modifier.testTag("gallery-review-next")
                            .heightIn(min = 48.dp)) { Text("下一页") }
                }
                HorizontalDivider()
                Row(Modifier.fillMaxWidth().navigationBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = controller::clearGallerySelection,
                        enabled = selected.isNotEmpty() && !busy,
                        modifier = Modifier.testTag("gallery-review-clear")
                            .heightIn(min = 48.dp)) { Text("清空选择") }
                    Button(onClick = onClose, enabled = !busy,
                        modifier = Modifier.testTag("gallery-review-return")
                            .heightIn(min = 48.dp)) { Text("返回图库") }
                }
            }
        }
    }
}
