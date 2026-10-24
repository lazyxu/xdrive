package com.tfluid.xdrive

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun ColumnScope.Files(state: DriveState, controller: DriveController) {
    val dark = LocalXDriveDarkTheme.current
    val pageColor = Color(if (dark) SharedVisuals.darkMobilePage else SharedVisuals.lightMobilePage)
    val rowColor = Color(if (dark) SharedVisuals.darkMobileRow else SharedVisuals.lightMobileRow)
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("我的文件", style = MaterialTheme.typography.headlineSmall)
        if (state.path.size > 1) Text(state.path.joinToString(" / ") { it.name.ifEmpty { "我的文件" } },
            style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("${state.totalCount} 项", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ErrorNotice(state.error)
        if (state.error != null) {
            if (state.loaded) Text("保留上次成功读取的目录。", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = controller::retry, enabled = !state.loading, modifier = Modifier.heightIn(min = 48.dp)) { Text("重试") }
        }
    }
    Surface(Modifier.weight(1f).fillMaxWidth(), color = pageColor, contentColor = MaterialTheme.colorScheme.onSurface) {
        key(state.path.lastOrNull()?.id, state.offset) {
            LazyColumn(Modifier.fillMaxSize().testTag("files")) {
                if (state.loaded && state.items.isEmpty() && state.error == null && !state.loading) item {
                    Text(if (state.offset == 0) "此文件夹为空" else "此页没有项目，请返回上一页或刷新。", Modifier.padding(24.dp))
                }
                items(state.items, key = { it.id }) { node ->
                    Column {
                        Row(Modifier.fillMaxWidth().background(rowColor).clickable(enabled = !state.loading) { controller.open(node) }
                            .heightIn(min = 68.dp).padding(start = 44.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            val description = when (fileKind(node.name, node.isDirectory)) { "folder" -> "文件夹"; "pdf" -> "PDF"; else -> "文件类型" }
                            Box(Modifier.semantics { contentDescription = description }) { XDriveFileIcon(node) }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(node.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(if (node.isDirectory) "文件夹" else formatSize(node.size), style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (node.id != state.items.lastOrNull()?.id) HorizontalDivider(Modifier.padding(start = 84.dp), color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = controller::previousPage, enabled = state.offset > 0 && !state.loading, modifier = Modifier.heightIn(min = 48.dp)) { Text("上一页") }
        Text(if (state.loaded) "${if (state.items.isEmpty()) 0 else state.offset + 1}–${state.offset + state.items.size} / ${state.totalCount}" else "等待目录",
            Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
        TextButton(onClick = controller::nextPage, enabled = state.hasNext && !state.loading, modifier = Modifier.heightIn(min = 48.dp)) { Text("下一页") }
    }
}
