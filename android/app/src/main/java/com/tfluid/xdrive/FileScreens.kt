package com.tfluid.xdrive

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.DriveNode
import kotlinx.coroutines.flow.collect

enum class FileViewMode {
    LIST, GRID;
    companion object {
        fun fromPreference(value: String?): FileViewMode =
            if (value == GRID.name) GRID else LIST
    }
}

/**
 * Session-only viewport anchors. A new Files composition after logout cannot
 * retain paths from a previous owner. Do not persist folder IDs to preferences.
 * A bounded map avoids accumulating every folder opened in a long session.
 */
internal class FilesViewportAnchors(private val capacity: Int = 64) {
    private val positions = LinkedHashMap<List<Long>, Int>(16, .75f, true)

    fun position(path: List<Long>): Int = positions[path] ?: 0

    fun record(path: List<Long>, index: Int) {
        if (path.isEmpty() || index < 0) return
        positions[path.toList()] = index
        while (positions.size > capacity) positions.remove(positions.keys.first())
    }

    fun count(): Int = positions.size
}

/**
 * Continuous-scroll Files uses the original authenticated Server ordering and
 * 100-item pages. Owner/path fencing, cancellation and refresh stay in the
 * existing DriveController, not a second Android paging implementation.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun ColumnScope.Files(state: DriveState, controller: DriveController, viewMode: FileViewMode) {
    val dark = LocalXDriveDarkTheme.current
    val pageColor = Color(if (dark) SharedVisuals.darkMobilePage else SharedVisuals.lightMobilePage)
    val rowColor = Color(if (dark) SharedVisuals.darkMobileRow else SharedVisuals.lightMobileRow)
    val folderKey = state.path.map { it.id }
    val anchors = remember { FilesViewportAnchors() }

    // Changing list ↔ grid or switching folders must use the correct index in
    // the *first rendered frame*. A post-render scrollToItem allowed the grid
    // to show item zero while the actual item-50 assertion ran (CI #40139739454).
    // Key the Lazy state by folder and view; seed it with the last observed
    // viewport index rather than scrolling asynchronously after the new UI mounts.
    key(folderKey, viewMode) {
        val firstItem = anchors.position(folderKey)
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = firstItem)
        val gridState = rememberLazyGridState(initialFirstVisibleItemIndex = firstItem)
        LaunchedEffect(folderKey, viewMode) {
            snapshotFlow {
                if (viewMode == FileViewMode.LIST) listState.firstVisibleItemIndex
                else gridState.firstVisibleItemIndex
            }.collect { index -> anchors.record(folderKey, index) }
        }
        LaunchedEffect(folderKey, viewMode, state.offset, state.items.size, state.hasNext, state.loading, state.error) {
        if (state.hasNext && !state.loading && state.error == null) {
            snapshotFlow {
                if (viewMode == FileViewMode.LIST) listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
                else gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            }.collect { lastVisible ->
                if (lastVisible >= (state.items.size - 3).coerceAtLeast(0)) controller.loadMore()
            }
        }
    }

    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(state.path.lastOrNull()?.name?.ifEmpty { "浏览" } ?: "浏览",
            style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (state.path.size > 1) Text(state.path.joinToString(" / ") { it.name.ifEmpty { "浏览" } },
            style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(state.totalCount.toString() + " 项", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        ErrorNotice(state.error)
        if (state.error != null) {
            if (state.loaded) Text("保留上次成功读取的目录。", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = controller::retry, enabled = !state.loading,
                modifier = Modifier.heightIn(min = 48.dp)) { Text("重试") }
        }
    }

    Surface(Modifier.weight(1f).fillMaxWidth(), color = pageColor,
        contentColor = MaterialTheme.colorScheme.onSurface) {
        if (viewMode == FileViewMode.LIST) {
            LazyColumn(Modifier.fillMaxSize().testTag("files"), state = listState) {
                if (state.loaded && state.items.isEmpty() && state.error == null && !state.loading) item {
                    Text("此文件夹为空", Modifier.padding(24.dp))
                }
                items(state.items, key = { it.id }) { node ->
                    var contextOpen by remember(node.id) { mutableStateOf(false) }
                    Column {
                        Box {
                            Row(Modifier.fillMaxWidth().background(rowColor)
                                .testTag("files-item-${node.id}")
                                .combinedClickable(onClick = { controller.open(node) },
                                    onLongClick = { contextOpen = true })
                                .heightIn(min = 64.dp).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                FileGlyph(node)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(node.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium,
                                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(if (node.isDirectory) "文件夹" else formatSize(node.size),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            FilesContextMenu(node, contextOpen, { contextOpen = false }, controller)
                        }
                        if (node.id != state.items.lastOrNull()?.id)
                            HorizontalDivider(Modifier.padding(start = 68.dp), color = MaterialTheme.colorScheme.outline)
                    }
                }
                if ((state.hasNext && state.error == null) || (state.loading && state.items.isNotEmpty())) item(key = "paging") {
                    PageTail(state)
                }
            }
        } else {
            LazyVerticalGrid(columns = GridCells.Adaptive(minSize = 112.dp),
                modifier = Modifier.fillMaxSize().testTag("files-grid"), state = gridState,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
                if (state.loaded && state.items.isEmpty() && state.error == null && !state.loading)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Text("此文件夹为空", Modifier.padding(24.dp))
                    }
                gridItems(state.items, key = { it.id }) { node ->
                    var contextOpen by remember(node.id) { mutableStateOf(false) }
                    Box {
                        Column(Modifier.fillMaxWidth()
                            .testTag("files-item-${node.id}")
                            .combinedClickable(onClick = { controller.open(node) },
                                onLongClick = { contextOpen = true })
                            .heightIn(min = 112.dp).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            FileGlyph(node, 64)
                            Text(node.name, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium,
                                textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        FilesContextMenu(node, contextOpen, { contextOpen = false }, controller)
                    }
                }
                if ((state.hasNext && state.error == null) || (state.loading && state.items.isNotEmpty()))
                    item(key = "paging", span = { GridItemSpan(maxLineSpan) }) { PageTail(state) }
            }
        }
    }
    }
}

@Composable
private fun FilesContextMenu(node: DriveNode, expanded: Boolean, dismiss: () -> Unit,
    controller: DriveController) {
    DropdownMenu(expanded = expanded, onDismissRequest = dismiss,
        containerColor = MaterialTheme.colorScheme.surface) {
        if (node.isDirectory) DropdownMenuItem(text = { Text("打开文件夹") },
            onClick = { dismiss(); controller.open(node) })
        DropdownMenuItem(text = { Text("属性") }, onClick = {
            dismiss()
            controller.showDetails(node)
        })
    }
}

@Composable
private fun FileGlyph(node: DriveNode, size: Int = 40) {
    val description = when (fileKind(node.name, node.isDirectory)) {
        "folder" -> "文件夹"
        "pdf" -> "PDF"
        else -> "文件类型"
    }
    Box(Modifier.semantics { contentDescription = description }) {
        XDriveFileIcon(node, size = size.dp)
    }
}

@Composable
private fun PageTail(state: DriveState) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(12.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        if (state.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        else Text("继续滚动加载", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
