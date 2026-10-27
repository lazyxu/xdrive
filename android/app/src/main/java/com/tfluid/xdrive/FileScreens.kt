package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.DriveCollectionItem
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.validDriveNodeName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.withContext

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
    onRename: (DriveNode) -> Unit = {}, onTrash: (DriveNode) -> Unit = {},
    onCopy: (DriveNode) -> Unit = {}, onMove: (DriveNode) -> Unit = {},
    onBatchTrash: () -> Unit = {}, onDownload: ((DriveNode) -> Unit)? = null) {
    val dark = LocalXDriveDarkTheme.current
    val pageColor = Color(if (dark) SharedVisuals.darkMobilePage else SharedVisuals.lightMobilePage)
    val rowColor = Color(if (dark) SharedVisuals.darkMobileRow else SharedVisuals.lightMobileRow)
    val folderKey = state.path.map { it.id }
    val anchors = remember { FilesViewportAnchors() }
    // 48 decoded thumbnails, 64 negative hints. In-memory for this Files screen
    // only; unmount on logout/Owner switch, never store private bytes on disk.
    val thumbnailCache = remember { LruCache<String, ImageBitmap>(48) }
    val thumbnailFailures = remember { mutableStateMapOf<String, Boolean>() }
    var globalSearchText by remember { mutableStateOf("") }

    if (state.filesSection != FilesSection.BROWSE) {
        // A new Owner-scoped section or search query must not inherit the
        // old collection's virtual-list viewport or long-press menu state.
        key(state.filesSection, state.searchQuery) {
            FilesCollection(state, controller, pageColor, rowColor,
                thumbnailCache, thumbnailFailures)
        }
        FilesSectionsBar(state.filesSection, controller::changeFilesSection)
        return
    }

    // Changing list ↔ grid or switching folders must use the correct index in
    // the *first rendered frame*. A post-render scrollToItem allowed the grid
    // to show item zero while the actual item-50 assertion ran (CI #40139739454).
    // Key the Lazy state by folder and view; seed it with the last observed
    // viewport index rather than scrolling asynchronously after the new UI mounts.
    key(folderKey, viewMode, state.focusedBrowseEpoch) {
        val targetIndex = state.focusedBrowseIndex.takeIf {
            state.focusedBrowseNodeId != null &&
                state.items.getOrNull(it)?.id == state.focusedBrowseNodeId
        }
        // Select the actual Node in the first frame, not only its parent folder.
        val firstItem = targetIndex ?: anchors.position(folderKey)
        val listState = rememberLazyListState(initialFirstVisibleItemIndex = firstItem)
        val gridState = rememberLazyGridState(initialFirstVisibleItemIndex = firstItem)
        var olderEdgeArmed by remember(folderKey, viewMode, state.focusedBrowseEpoch) {
            mutableStateOf(false)
        }
        LaunchedEffect(folderKey, viewMode, state.focusedBrowseEpoch) {
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

        // A located page may begin at offset 50k. Only prepend when the user
        // scrolls away and back, avoiding a cold-load 100k fetch storm.
        LaunchedEffect(folderKey, viewMode, state.browseWindowStart,
            state.items.size, state.loading, state.error) {
            if (state.hasPrevious && !state.loading && state.error == null) {
                snapshotFlow {
                    if (viewMode == FileViewMode.LIST)
                        listState.firstVisibleItemIndex to listState.isScrollInProgress
                    else gridState.firstVisibleItemIndex to gridState.isScrollInProgress
                }.collect { (first, scrolling) ->
                    if (first > 5) olderEdgeArmed = true
                    else if (first <= 1 && (olderEdgeArmed || scrolling)) {
                        olderEdgeArmed = false
                        controller.loadPrevious()
                    }
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
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (state.browseSelectionMode)
                "${state.browseSelectedIds.size} 项已选择（最多 200）"
                else "${state.totalCount} 项",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = {
                controller.setBrowseSelectionMode(!state.browseSelectionMode)
            }, enabled = !state.loading && state.loaded &&
                !state.browseBatchWriteAttempted && state.destinationKind == null,
                modifier = Modifier.heightIn(min = 48.dp).testTag("files-select-mode")) {
                Text(if (state.browseSelectionMode) "完成" else "选择")
            }
        }
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
        if (state.fileUploadCommitted && !state.fileUploadActive) {
            Text("上传已完成", style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("files-upload-success"))
        }
        if (state.fileUploadActive) {
            Text("正在上传：${formatSize(state.fileUploadBytes)} / ${formatSize(state.fileUploadTotal)}",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("files-upload-progress"))
            LinearProgressIndicator(
                progress = { if (state.fileUploadTotal == 0L) 1f else
                    (state.fileUploadBytes.toDouble() / state.fileUploadTotal).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth())
            TextButton(onClick = controller::cancelFileUpload,
                modifier = Modifier.heightIn(min = 48.dp).testTag("files-upload-cancel")) {
                Text("取消上传")
            }
        }
        DownloadToDeviceStatus(state, controller, "files")
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
                            Row(Modifier.fillMaxWidth()
                                .background(if (!state.browseSelectionMode &&
                                    node.id == state.focusedBrowseNodeId)
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                                    else rowColor)
                                .testTag("files-item-${node.id}")
                                .semantics { selected = if (state.browseSelectionMode)
                                    node.id in state.browseSelectedIds
                                    else node.id == state.focusedBrowseNodeId }
                                .combinedClickable(onClick = {
                                    if (state.browseSelectionMode) controller.toggleBrowseSelection(node)
                                    else controller.open(node)
                                },
                                    onLongClick = {
                                    if (state.browseSelectionMode) controller.toggleBrowseSelection(node)
                                    else contextOpen = true
                                })
                                .heightIn(min = 64.dp).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                if (state.browseSelectionMode) {
                                    Checkbox(checked = node.id in state.browseSelectedIds,
                                        onCheckedChange = null,
                                        modifier = Modifier.testTag("files-select-${node.id}")
                                            .semantics { selected = node.id in state.browseSelectedIds })
                                    Spacer(Modifier.width(8.dp))
                                }
                                FileGlyph(node, controller, thumbnailCache, thumbnailFailures)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(node.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium,
                                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text(if (node.isDirectory) "文件夹" else formatSize(node.size),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            if (!state.browseSelectionMode)
                                FilesContextMenu(node, contextOpen, { contextOpen = false }, controller,
                                    onRename = onRename, onTrash = onTrash,
                                    onCopy = onCopy, onMove = onMove,
                                    onDownload = onDownload, canMutate = !state.loading,
                                 onRetryThumbnail = if (thumbnailFailures[filesThumbnailKey(node)] == true)
                                     ({ thumbnailFailures.remove(filesThumbnailKey(node)); Unit }) else null)
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
                            .background(if (!state.browseSelectionMode &&
                                node.id == state.focusedBrowseNodeId)
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                                else rowColor)
                            .testTag("files-item-${node.id}")
                            .semantics { selected = if (state.browseSelectionMode)
                                node.id in state.browseSelectedIds
                                else node.id == state.focusedBrowseNodeId }
                            .combinedClickable(onClick = {
                                    if (state.browseSelectionMode) controller.toggleBrowseSelection(node)
                                    else controller.open(node)
                                },
                                onLongClick = {
                                    if (state.browseSelectionMode) controller.toggleBrowseSelection(node)
                                    else contextOpen = true
                                })
                            .heightIn(min = 112.dp).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (state.browseSelectionMode)
                                Checkbox(checked = node.id in state.browseSelectedIds,
                                    onCheckedChange = null,
                                    modifier = Modifier.testTag("files-select-${node.id}")
                                        .semantics { selected = node.id in state.browseSelectedIds })
                            FileGlyph(node, controller, thumbnailCache, thumbnailFailures, 64)
                            Text(node.name, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium,
                                textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        if (!state.browseSelectionMode)
                            FilesContextMenu(node, contextOpen, { contextOpen = false }, controller,
                                onRename = onRename, onTrash = onTrash,
                                onCopy = onCopy, onMove = onMove,
                                onDownload = onDownload, canMutate = !state.loading,
                                 onRetryThumbnail = if (thumbnailFailures[filesThumbnailKey(node)] == true)
                                     ({ thumbnailFailures.remove(filesThumbnailKey(node)); Unit }) else null)
                    }
                }
                if ((state.hasNext && state.error == null) || (state.loading && state.items.isNotEmpty()))
                    item(key = "paging", span = { GridItemSpan(maxLineSpan) }) { PageTail(state) }
            }
        }
    }
    }
    if (state.browseSelectionMode) FilesSelectionActions(state, controller, onBatchTrash)
    else FilesSectionsBar(state.filesSection, controller::changeFilesSection)
}

@Composable
private fun ColumnScope.FilesSelectionActions(
    state: DriveState, controller: DriveController, onBatchTrash: () -> Unit,
) {
    Surface(Modifier.fillMaxWidth().navigationBarsPadding()
        .padding(horizontal = 12.dp, vertical = 6.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
            val ready = state.browseSelectedIds.isNotEmpty() &&
                !state.loading && state.error == null &&
                !state.browseBatchWriteAttempted && state.destinationKind == null
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { controller.setBrowseSelectionMode(false) },
                    enabled = !state.loading && !state.browseBatchWriteAttempted &&
                        state.destinationKind == null,
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
                // The Files header already announces selection count and 200 cap.
                // Keep this action bar concise, avoiding two identical semantic
                // text nodes that break accessibility and the Compose fixture.
                Text("${state.browseSelectedIds.size} 项",
                    style = MaterialTheme.typography.bodyMedium)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceEvenly) {
                TextButton(onClick = {
                    controller.chooseSelectedDestination(FilesTransferKind.COPY)
                }, enabled = ready,
                    modifier = Modifier.testTag("files-batch-copy-action")
                        .heightIn(min = 48.dp)) { Text("复制到…") }
                TextButton(onClick = {
                    controller.chooseSelectedDestination(FilesTransferKind.MOVE)
                }, enabled = ready,
                    modifier = Modifier.testTag("files-batch-move-action")
                        .heightIn(min = 48.dp)) { Text("移动到…") }
                TextButton(onClick = onBatchTrash, enabled = ready,
                    modifier = Modifier.testTag("files-batch-trash-action")
                        .heightIn(min = 48.dp)) { Text("移到回收站") }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ColumnScope.FilesCollection(state: DriveState, controller: DriveController,
    pageColor: Color, rowColor: Color,
    thumbnailCache: LruCache<String, ImageBitmap>,
    thumbnailFailures: MutableMap<String, Boolean>) {
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
                            FileGlyph(item.node, controller, thumbnailCache, thumbnailFailures)
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
                            item, state.filesSection,
                            onRetryThumbnail = if (thumbnailFailures[filesThumbnailKey(item.node)] == true)
                                ({ thumbnailFailures.remove(filesThumbnailKey(item.node)); Unit }) else null)
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
    onCopy: ((DriveNode) -> Unit)? = null, onMove: ((DriveNode) -> Unit)? = null,
    onDownload: ((DriveNode) -> Unit)? = null, canMutate: Boolean = true,
    onRetryThumbnail: (() -> Unit)? = null) {
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
            if (onCopy != null) DropdownMenuItem(text = { Text("复制到…") },
                onClick = { dismiss(); onCopy(node) })
            if (onMove != null) DropdownMenuItem(text = { Text("移动到…") },
                onClick = { dismiss(); onMove(node) })
            if (onRename != null) DropdownMenuItem(text = { Text("重命名") },
                onClick = { dismiss(); onRename(node) })
            if (onTrash != null) DropdownMenuItem(text = { Text("移到回收站") },
                onClick = { dismiss(); onTrash(node) })
        }
        if (!node.isDirectory) {
            if (onDownload != null && node.revision > 0 && canMutate &&
                collection == null) DropdownMenuItem(
                    text = { Text("下载到设备") },
                    modifier = Modifier.testTag("files-download-action"),
                    onClick = { dismiss(); onDownload(node) })
            if (section == FilesSection.FAVORITES) DropdownMenuItem(text = { Text("取消收藏") },
                onClick = { dismiss(); controller.unfavoriteFile(node) })
            else DropdownMenuItem(text = { Text("加入收藏") },
                onClick = { dismiss(); controller.favoriteFile(node) })
        }
        if (onRetryThumbnail != null) DropdownMenuItem(
            text = { Text("重试缩略图") },
            modifier = Modifier.testTag("files-thumbnail-retry-${node.id}"),
            onClick = { dismiss(); onRetryThumbnail() })
        DropdownMenuItem(text = { Text("属性") }, onClick = {
            dismiss()
            controller.showDetails(node)
        })
    }
}

/** Native destination picker reused by list and grid. Directory choices come
 * only from Owner-scoped Server root/children reads; no local path guessing. */
@Composable
internal fun FilesDestinationDialog(state: DriveState, controller: DriveController) {
    val kind = state.destinationKind ?: return
    val source = state.destinationSource ?: return
    val sources = state.destinationSources.ifEmpty { listOf(source) }
    val isBatch = state.destinationSources.isNotEmpty()
    val submitting = state.destinationSubmitting
    val isCopy = kind == FilesTransferKind.COPY
    val destination = state.destinationPath.lastOrNull()
    val forbidden = sources.any { node -> node.isDirectory &&
        state.destinationPath.any { it.id == node.id } }
    val sameParent = !isCopy && sources.any { it.parentId == destination?.id }
    val canCommit = !state.loading && !submitting && !state.destinationWriteAttempted &&
        state.destinationLoaded && destination != null && !forbidden && !sameParent &&
        state.error == null

    AlertDialog(
        onDismissRequest = { controller.dismissDestination() },
        title = { Text(if (isCopy) "复制到文件夹" else "移动到文件夹") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (isBatch) "批量 ${sources.size} 项" else source.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.testTag("files-destination-source-summary"))
                Text("目标：" + (if (state.destinationPath.isEmpty()) "正在读取…"
                    else state.destinationPath.joinToString(" / ") { it.name.ifBlank { "浏览" } }),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (state.destinationPath.size > 1) TextButton(
                    onClick = controller::backDestinationFolder,
                    enabled = !state.loading && !submitting,
                    modifier = Modifier.testTag("files-destination-up"),
                ) { Text("返回上一级") }
                if (state.destinationLoaded) {
                    if (state.destinationFolders.isEmpty() && !state.destinationHasNext)
                        Text("此目录没有子文件夹", style = MaterialTheme.typography.bodySmall)
                    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 300.dp)
                        .testTag("files-destination-list")) {
                        items(state.destinationFolders, key = { it.id }) { folder ->
                            val disallowed = sources.any { it.isDirectory && it.id == folder.id }
                            TextButton(onClick = { controller.enterDestinationFolder(folder) },
                                enabled = !state.loading && !submitting && !disallowed,
                                modifier = Modifier.fillMaxWidth()
                                    .testTag("files-destination-item-${folder.id}")) {
                                XDriveFileIcon(folder, size = 32.dp)
                                Spacer(Modifier.width(10.dp))
                                Text(folder.name, Modifier.weight(1f), textAlign = TextAlign.Start,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (state.destinationHasNext) item(key = "target-more") {
                            TextButton(onClick = controller::loadMoreDestination,
                                enabled = !state.loading && !submitting,
                                modifier = Modifier.fillMaxWidth().testTag("files-destination-more")) {
                                Text("继续加载文件夹")
                            }
                        }
                    }
                }
                if (sameParent) Text("文件已经在当前文件夹中。",
                    style = MaterialTheme.typography.bodySmall)
                if (forbidden) Text("不能将文件夹复制或移动到自身或子文件夹中。",
                    style = MaterialTheme.typography.bodySmall)
                if (state.error != null) {
                    Text(state.error, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                    if (state.destinationWriteAttempted) {
                        Text("本次写入结果未确认。请取消并刷新原目录确认，不要再次提交。",
                            style = MaterialTheme.typography.bodySmall)
                    } else {
                        TextButton(onClick = controller::retryDestination,
                            enabled = !state.loading && !submitting) { Text("重试读取目标文件夹") }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = controller::commitDestination, enabled = canCommit,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("files-destination-confirm")) {
                Text(if (isBatch)
                    "${if (isCopy) "复制" else "移动"} ${sources.size} 项到这里"
                    else if (isCopy) "复制到这里" else "移动到这里")
            }
        },
        dismissButton = {
            TextButton(onClick = controller::dismissDestination,
                enabled = !submitting, modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
        },
    )
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

/** Render only the 4 MiB revision-checked derived JPEG, never an original file.
 * Lazy item removal cancels the request; failures preserve existing icons and
 * only resume via the current long-press context menu. */
private fun filesThumbnailKey(node: DriveNode): String = "${node.id}:${node.revision}"

@Composable
private fun FileGlyph(node: DriveNode, controller: DriveController,
    thumbnails: LruCache<String, ImageBitmap>,
    failures: MutableMap<String, Boolean>, size: Int = 40) {
    val key = filesThumbnailKey(node)
    val eligible = nativeFileThumbnailCandidate(node)
    var bitmap by remember(key, thumbnails) { mutableStateOf(thumbnails.get(key)) }
    val failed = failures[key] == true
    LaunchedEffect(key, eligible, failed) {
        if (!eligible || failed || bitmap != null) return@LaunchedEffect
        val bytes = controller.filesThumbnail(node)
        val decoded = bytes?.let {
            withContext(Dispatchers.Default) {
                try { decodeGalleryThumbnail(it) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { null }
            }
        }
        if (decoded != null) {
            thumbnails.put(key, decoded)
            bitmap = decoded
        } else {
            failures[key] = true
            if (failures.size > 64) failures.remove(failures.keys.first())
        }
    }
    val description = when {
        bitmap != null -> "媒体缩略图"
        node.isDirectory -> "文件夹"
        fileKind(node.name, false) == "pdf" -> "PDF"
        else -> "文件类型"
    }
    Box(Modifier.size(size.dp).semantics { contentDescription = description }) {
        val image = bitmap
        if (image != null) Image(image, contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(4.dp))
                .testTag("files-thumbnail-ready-${node.id}"))
        else XDriveFileIcon(node, size = size.dp)
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

/** Same bounded native SAF transfer chrome in Files and Gallery. No duplicate runner. */
@Composable
internal fun DownloadToDeviceStatus(state: DriveState, controller: DriveController, tag: String) {
    if (state.fileDownloadSaved && !state.fileDownloadActive) {
        Text("已保存到设备", style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("${tag}-download-success"))
    }
    if (state.fileDownloadError != null) {
        Text(state.fileDownloadError, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("${tag}-download-error"))
    }
    if (state.fileDownloadActive) {
        Text("正在保存到设备：${formatSize(state.fileDownloadBytes)} / ${formatSize(state.fileDownloadTotal)}",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("${tag}-download-progress"))
        LinearProgressIndicator(
            progress = { if (state.fileDownloadTotal == 0L) 1f else
                (state.fileDownloadBytes.toDouble() / state.fileDownloadTotal).toFloat().coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth())
        TextButton(onClick = controller::cancelFileDownload,
            modifier = Modifier.heightIn(min = 48.dp).testTag("${tag}-download-cancel")) {
            Text("取消下载")
        }
    }
}
