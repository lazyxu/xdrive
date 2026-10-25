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
import com.tfluid.xdrive.core.DriveCollectionItem
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.validDriveNodeName
import kotlinx.coroutines.flow.collect

internal enum class FilesEditKind { CREATE_FOLDER, RENAME, TRASH }
internal data class FilesEditIntent(val kind: FilesEditKind, val node: DriveNode? = null)

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
internal fun ColumnScope.Files(state: DriveState, controller: DriveController, viewMode: FileViewMode,
    onRename: (DriveNode) -> Unit = {}, onTrash: (DriveNode) -> Unit = {}) {
    val dark = LocalXDriveDarkTheme.current
    val pageColor = Color(if (dark) SharedVisuals.darkMobilePage else SharedVisuals.lightMobilePage)
    val rowColor = Color(if (dark) SharedVisuals.darkMobileRow else SharedVisuals.lightMobileRow)
    val folderKey = state.path.map { it.id }
    val anchors = remember { FilesViewportAnchors() }
    var globalSearchText by remember { mutableStateOf("") }

    if (state.filesSection != FilesSection.BROWSE) {
        // A new Owner-scoped section or search query must not inherit the
        // old collection's virtual-list viewport or long-press menu state.
        key(state.filesSection, state.searchQuery) {
            FilesCollection(state, controller, pageColor, rowColor)
        }
        FilesSectionsBar(state.filesSection, controller::changeFilesSection)
        return
    }

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
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = globalSearchText,
                onValueChange = { globalSearchText = it.take(256) },
                modifier = Modifier.weight(1f).testTag("files-global-search-input"),
                singleLine = true, label = { Text("搜索全部文件") },
            )
            TextButton(
                onClick = { controller.submitGlobalSearch(globalSearchText) },
                enabled = !state.loading &&
                    globalSearchText.trim().codePointCount(0, globalSearchText.trim().length) >= 2,
                modifier = Modifier.heightIn(min = 48.dp).testTag("files-global-search-submit"),
            ) { Text("搜索") }
        }
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
                            FilesContextMenu(node, contextOpen, { contextOpen = false }, controller,
                                onRename = onRename, onTrash = onTrash,
                                canMutate = !state.loading)
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
                        FilesContextMenu(node, contextOpen, { contextOpen = false }, controller,
                            onRename = onRename, onTrash = onTrash,
                            canMutate = !state.loading)
                    }
                }
                if ((state.hasNext && state.error == null) || (state.loading && state.items.isNotEmpty()))
                    item(key = "paging", span = { GridItemSpan(maxLineSpan) }) { PageTail(state) }
            }
        }
    }
    }
    FilesSectionsBar(state.filesSection, controller::changeFilesSection)
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ColumnScope.FilesCollection(state: DriveState, controller: DriveController,
    pageColor: Color, rowColor: Color) {
    val title = when (state.filesSection) {
        FilesSection.RECENT -> "最近"
        FilesSection.FAVORITES -> "收藏"
        FilesSection.SEARCH -> "搜索结果"
        FilesSection.BROWSE -> "浏览"
    }
    var searchDraft by remember(state.searchQuery) { mutableStateOf(state.searchQuery) }
    val listState = rememberLazyListState()
    LaunchedEffect(state.filesSection, state.searchQuery, state.searchNextCursor,
        state.collectionItems.size, state.loading, state.error) {
        if (state.filesSection == FilesSection.SEARCH &&
            state.searchNextCursor.isNotBlank() && !state.loading && state.error == null) {
            snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
                .collect { index ->
                    if (index >= (state.collectionItems.size - 3).coerceAtLeast(0))
                        controller.loadMoreSearch()
                }
        }
    }
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        // Same global Owner search is reachable from Browse, Recent and
        // Favorites; never filter the currently loaded collection in memory.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = searchDraft, onValueChange = { searchDraft = it.take(256) },
                    modifier = Modifier.weight(1f).testTag("files-search-results-input"),
                    singleLine = true, label = { Text("搜索全部文件") },
                )
                TextButton(onClick = { controller.submitGlobalSearch(searchDraft) },
                    enabled = !state.loading &&
                        searchDraft.trim().codePointCount(0, searchDraft.trim().length) >= 2,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("files-search-results-submit")) {
                    Text("搜索")
                }
            }
        if (state.collectionLoaded) Text(
            (if (state.filesSection == FilesSection.SEARCH) "已加载 " else "") +
                "${state.collectionItems.size} 项",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        ErrorNotice(state.error)
        if (state.error != null) TextButton(onClick = controller::retry, enabled = !state.loading,
            modifier = Modifier.heightIn(min = 48.dp)) { Text("重试") }
    }
    Surface(Modifier.weight(1f).fillMaxWidth(), color = pageColor) {
        LazyColumn(Modifier.fillMaxSize().testTag("files-collection"), state = listState) {
            if (state.collectionLoaded && state.collectionItems.isEmpty() &&
                state.error == null && !state.loading) item {
                val empty = when (state.filesSection) {
                    FilesSection.RECENT -> "暂无最近项目"
                    FilesSection.FAVORITES -> "暂无收藏的文件"
                    FilesSection.SEARCH -> "没有匹配的文件"
                    FilesSection.BROWSE -> "此文件夹为空"
                }
                Text(empty, Modifier.padding(24.dp))
            }
            items(state.collectionItems, key = { it.node.id }) { item ->
                var contextOpen by remember(item.node.id) { mutableStateOf(false) }
                Column {
                    Box {
                        Row(Modifier.fillMaxWidth().background(rowColor)
                            .testTag("files-collection-item-${item.node.id}")
                            .combinedClickable(onClick = { controller.openCollectionItem(item) },
                                onLongClick = { contextOpen = true })
                            .heightIn(min = 68.dp).padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            FileGlyph(item.node)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(item.node.name, style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(item.path.ifEmpty {
                                    if (item.node.isDirectory) "文件夹" else formatSize(item.node.size)
                                }, style = MaterialTheme.typography.bodySmall, maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        FilesContextMenu(item.node, contextOpen, { contextOpen = false }, controller,
                            item, state.filesSection)
                    }
                    if (item.node.id != state.collectionItems.lastOrNull()?.node?.id)
                        HorizontalDivider(Modifier.padding(start = 68.dp),
                            color = MaterialTheme.colorScheme.outline)
                }
            }
            if (state.filesSection == FilesSection.SEARCH &&
                ((state.searchNextCursor.isNotBlank() && state.error == null) ||
                    (state.loading && state.collectionItems.isNotEmpty())))
                item(key = "search-paging") { PageTail(state) }
        }
    }
}

@Composable
private fun ColumnScope.FilesSectionsBar(section: FilesSection, select: (FilesSection) -> Unit) {
    Surface(Modifier.fillMaxWidth().navigationBarsPadding()
        .padding(horizontal = 12.dp, vertical = 6.dp),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(50.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow, shadowElevation = 3.dp) {
        Row(Modifier.fillMaxWidth().padding(4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            listOf(FilesSection.RECENT to "最近", FilesSection.FAVORITES to "收藏",
                FilesSection.BROWSE to "浏览").forEach { (value, label) ->
                TextButton(onClick = { select(value) },
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp)
                        .testTag("files-section-${value.name.lowercase()}"),
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(50.dp),
                    colors = ButtonDefaults.textButtonColors(
                        containerColor = if (section == value)
                            MaterialTheme.colorScheme.primary.copy(alpha = .12f) else Color.Transparent,
                        contentColor = if (section == value)
                            MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )) { Text(label) }
            }
        }
    }
}

@Composable
private fun FilesContextMenu(node: DriveNode, expanded: Boolean, dismiss: () -> Unit,
    controller: DriveController, collection: DriveCollectionItem? = null,
    section: FilesSection = FilesSection.BROWSE,
    onRename: ((DriveNode) -> Unit)? = null, onTrash: ((DriveNode) -> Unit)? = null,
    canMutate: Boolean = true) {
    DropdownMenu(expanded = expanded, onDismissRequest = dismiss,
        containerColor = MaterialTheme.colorScheme.surface) {
        if (node.isDirectory) DropdownMenuItem(text = { Text("打开文件夹") },
            onClick = {
                dismiss()
                if (collection != null) controller.locateCollectionItem(collection) else controller.open(node)
            })
        if (collection != null) DropdownMenuItem(text = { Text("显示所在位置") },
            onClick = { dismiss(); controller.locateCollectionItem(collection) })
        if (collection == null && node.revision > 0 && canMutate) {
            if (onRename != null) DropdownMenuItem(text = { Text("重命名") },
                onClick = { dismiss(); onRename(node) })
            if (onTrash != null) DropdownMenuItem(text = { Text("移到回收站") },
                onClick = { dismiss(); onTrash(node) })
        }
        if (!node.isDirectory) {
            if (section == FilesSection.FAVORITES) DropdownMenuItem(text = { Text("取消收藏") },
                onClick = { dismiss(); controller.unfavoriteFile(node) })
            else DropdownMenuItem(text = { Text("加入收藏") },
                onClick = { dismiss(); controller.favoriteFile(node) })
        }
        DropdownMenuItem(text = { Text("属性") }, onClick = {
            dismiss()
            controller.showDetails(node)
        })
    }
}

/** The same editable operation surface is used for list and grid. No
 * destructive request is sent until the user explicitly confirms it. */
@Composable
internal fun FilesEditDialog(
    intent: FilesEditIntent, busy: Boolean, onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val deleting = intent.kind == FilesEditKind.TRASH
    val original = intent.node?.name.orEmpty()
    var draft by remember(intent) { mutableStateOf(if (intent.kind == FilesEditKind.RENAME) original else "") }
    val allowed = when (intent.kind) {
        FilesEditKind.CREATE_FOLDER -> validDriveNodeName(draft)
        FilesEditKind.RENAME -> validDriveNodeName(draft) && draft != original
        FilesEditKind.TRASH -> intent.node != null
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(when (intent.kind) {
            FilesEditKind.CREATE_FOLDER -> "新建文件夹"
            FilesEditKind.RENAME -> "重命名"
            FilesEditKind.TRASH -> "移到回收站"
        }) },
        text = {
            if (deleting) Text(if (intent.node?.isDirectory == true)
                "确定将「$original」及其子项移到回收站？"
                else "确定将「$original」移到回收站？")
            else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft, onValueChange = { draft = it.take(255) },
                    modifier = Modifier.fillMaxWidth().testTag("files-edit-name"),
                    label = { Text("名称") }, singleLine = true,
                    isError = draft.isNotEmpty() && !validDriveNodeName(draft),
                )
                Text("不允许保留名称、特殊字符、末尾空格或超过 255 字节。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(draft) },
                enabled = allowed && !busy,
                modifier = Modifier.heightIn(min = 48.dp).testTag("files-edit-confirm"),
            ) { Text(if (deleting) "移到回收站" else "保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
        },
    )
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
