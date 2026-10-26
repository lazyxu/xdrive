package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.TrashEntry

/** Owner-scoped recovery; permanent deletion is deliberately absent. */
@Composable
internal fun ColumnScope.Trash(state: DriveState, controller: DriveController) {
    val listState = rememberLazyListState()
    var candidate by remember { mutableStateOf<TrashEntry?>(null) }
    val lastVisible by remember {
        derivedStateOf { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
    }
    LaunchedEffect(lastVisible, state.trashItems.size, state.trashTotal,
        state.trashLoaded, state.loading, state.error) {
        if (state.trashLoaded && state.error == null && !state.loading &&
            lastVisible >= (state.trashItems.size - 4).coerceAtLeast(0)) controller.loadMoreTrash()
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("回收站", style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.weight(1f))
        if (state.trashLoaded) Text("${state.trashTotal} 项",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Text("恢复到删除前的文件夹。原文件夹不存在或名称冲突时，服务器将拒绝恢复。",
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    ErrorNotice(state.error)
    if (state.error != null) TextButton(onClick = controller::refreshTrash,
        enabled = !state.loading, modifier = Modifier.padding(horizontal = 12.dp)
            .heightIn(min = 48.dp).testTag("trash-reload")) {
        Text("重新读取回收站")
    }
    LazyColumn(state = listState,
        modifier = Modifier.weight(1f).fillMaxWidth().testTag("trash-list"),
        contentPadding = PaddingValues(bottom = 16.dp)) {
        items(state.trashItems, key = { it.node.id }) { entry ->
            Row(Modifier.fillMaxWidth().heightIn(min = 68.dp)
                .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(if (entry.node.isDirectory)
                    R.drawable.xd_folder else R.drawable.xd_insert_drive_file),
                    contentDescription = null, tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(34.dp))
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(entry.node.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("删除于 ${entry.deletedAt.replace('T', ' ').take(16)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { candidate = entry },
                    enabled = !state.loading && state.trashLoaded &&
                        !state.trashRestoreAttempted,
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("trash-restore-${entry.node.id}")) { Text("恢复") }
            }
            HorizontalDivider()
        }
        if (state.trashLoaded && state.trashItems.isEmpty()) item {
            Text("回收站为空", Modifier.padding(24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
    }
    candidate?.let { entry ->
        AlertDialog(onDismissRequest = { candidate = null },
            title = { Text("恢复文件") },
            text = { Text("将「${entry.node.name}」恢复到原文件夹？") },
            confirmButton = {
                TextButton(onClick = {
                    candidate = null
                    controller.restoreTrashItem(entry)
                }, enabled = !state.loading && state.trashLoaded &&
                    !state.trashRestoreAttempted && state.trashItems.any { it == entry },
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("trash-restore-confirm")) { Text("恢复") }
            },
            dismissButton = {
                TextButton(onClick = { candidate = null },
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
            })
    }
}
