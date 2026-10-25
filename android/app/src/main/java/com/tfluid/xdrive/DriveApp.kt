package com.tfluid.xdrive

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.util.Locale
import com.tfluid.xdrive.core.DriveNode

/** A root Files selection consumes Android Back before the Activity can exit. */
internal fun shouldHandleFilesBack(state: DriveState, editOpen: Boolean, batchConfirmOpen: Boolean): Boolean =
    state.destinationKind != null || batchConfirmOpen || editOpen || state.selected != null ||
        (state.screen == Screen.FILES &&
            (state.browseSelectionMode || state.filesSection != FilesSection.BROWSE || state.path.size > 1))

@Composable
fun DriveApp(controller: DriveController, updates: UpdateController? = null, openUpdate: (String) -> Boolean = { false },
    initialFilesView: FileViewMode = FileViewMode.LIST, saveFilesView: (FileViewMode) -> Unit = {},
    onDownload: ((DriveNode) -> Unit)? = null,
    onUpload: (() -> Unit)? = null) {
    val state by controller.state.collectAsStateWithLifecycle()
    // Retain only scroll UI state while the fullscreen Viewer replaces Gallery.
    // The Owner photo rows and thumbnails remain in the Controller/lifecycle.
    val gallerySaveable = rememberSaveableStateHolder()
    var filesView by rememberSaveable { mutableStateOf(initialFilesView) }
    var filesEdit by remember(state.screen, state.filesSection, state.path.map { it.id }) {
        mutableStateOf<FilesEditIntent?>(null)
    }
    var batchTrashConfirm by remember(
        state.screen, state.filesSection, state.path.map { it.id },
    ) { mutableStateOf(false) }
    val mobilePage = Color(if (LocalXDriveDarkTheme.current) SharedVisuals.darkMobilePage else SharedVisuals.lightMobilePage)
    BackHandler(state.screen == Screen.GALLERY ||
        shouldHandleFilesBack(state, filesEdit != null, batchTrashConfirm)) {
        if (state.destinationKind != null) controller.dismissDestination()
        else if (batchTrashConfirm) batchTrashConfirm = false
        else if (filesEdit != null) filesEdit = null
        else controller.back()
    }
    val photoViewerOpen = state.screen == Screen.GALLERY && state.galleryViewer != null
    Scaffold(modifier = Modifier.imePadding(),
        containerColor = if (state.screen == Screen.FILES || state.screen == Screen.GALLERY)
            mobilePage else MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onSurface, topBar = {
        if (!photoViewerOpen &&
            (state.screen == Screen.FILES || state.screen == Screen.GALLERY))
            Surface(color = mobilePage, contentColor = MaterialTheme.colorScheme.onSurface) {
            Row(Modifier.statusBarsPadding().fillMaxWidth().height(52.dp).padding(horizontal = 8.dp)
                .testTag("xdrive-mobile-app-header"),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                if (state.screen == Screen.GALLERY)
                    IconButton(onClick = controller::openFilesApp) {
                        Icon(painterResource(R.drawable.xd_arrow_back), "返回文件")
                    }
                else if (state.filesSection != FilesSection.BROWSE || state.path.size > 1)
                    IconButton(onClick = controller::back) {
                        Icon(painterResource(R.drawable.xd_arrow_back), "返回上级")
                    }
                else Spacer(Modifier.size(48.dp))
                Box(Modifier.weight(1f), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    var pathMenuOpen by remember(state.filesSection, state.path.map { it.id }) {
                        mutableStateOf(false)
                    }
                    val title = if (state.screen == Screen.GALLERY) "照片"
                        else when (state.filesSection) {
                            FilesSection.RECENT -> "最近"
                            FilesSection.FAVORITES -> "收藏"
                            FilesSection.BROWSE -> state.path.lastOrNull()?.name?.ifEmpty { "浏览" } ?: "浏览"
                            FilesSection.SEARCH -> "搜索结果"
                        }
                    if (state.screen == Screen.FILES &&
                        state.filesSection == FilesSection.BROWSE && state.path.size > 1) {
                        TextButton(onClick = { pathMenuOpen = true }, modifier = Modifier.fillMaxWidth().testTag("files-path-menu")) {
                            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                            Text("⌄", modifier = Modifier.padding(start = 3.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DropdownMenu(expanded = pathMenuOpen, onDismissRequest = { pathMenuOpen = false },
                            containerColor = MaterialTheme.colorScheme.surface) {
                            state.path.forEachIndexed { index, node ->
                                DropdownMenuItem(
                                    text = { Text(node.name.ifEmpty { "浏览" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                    enabled = index < state.path.lastIndex,
                                    modifier = Modifier.testTag("files-path-${node.id}"),
                                    onClick = { pathMenuOpen = false; controller.navigateToAncestor(index) },
                                )
                            }
                        }
                    } else Text(title, modifier = Modifier.testTag("files-nav-title"), maxLines = 1,
                        overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium,
                        textAlign = TextAlign.Center)
                }
                AccountMenu(state, controller, updates?.let { it::show },
                    fileView = if (state.screen == Screen.FILES &&
                        state.filesSection == FilesSection.BROWSE) filesView else null,
                    onFileViewChange = { filesView = it; saveFilesView(it) },
                    onCreateFolder = { filesEdit = FilesEditIntent(FilesEditKind.CREATE_FOLDER) },
                    onUpload = onUpload)
            }
        }
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.primary.copy(alpha = .12f))
            when (state.screen) {
                Screen.CONNECT -> ConnectionForm(state, controller::connect, controller::savedRoute) { if (updates != null) AccountMenu(state, controller, updates::show) }
                Screen.LOGIN -> LoginForm(state, controller::login) { AccountMenu(state, controller, updates?.let { it::show }) }
                Screen.PASSWORD -> PasswordForm(state, controller::changePassword) { AccountMenu(state, controller, updates?.let { it::show }) }
                Screen.FILES -> Files(state, controller, filesView,
                    onRename = { filesEdit = FilesEditIntent(FilesEditKind.RENAME, it) },
                    onTrash = { filesEdit = FilesEditIntent(FilesEditKind.TRASH, it) },
                    onCopy = { controller.chooseDestination(it, FilesTransferKind.COPY) },
                    onMove = { controller.chooseDestination(it, FilesTransferKind.MOVE) },
                    onBatchTrash = { batchTrashConfirm = true }, onDownload = onDownload)
                Screen.GALLERY -> {
                    val photo = state.galleryViewer
                    if (photo != null) GalleryPhotoViewer(photo, controller)
                    else gallerySaveable.SaveableStateProvider(
                        "gallery:${state.server}:${state.username}") {
                        Gallery(state, controller)
                    }
                }
            }
        }
    }
    if (state.destinationKind != null) FilesDestinationDialog(state, controller)
    if (batchTrashConfirm && state.screen == Screen.FILES &&
        state.browseSelectionMode && state.browseSelectedIds.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { batchTrashConfirm = false },
            title = { Text("移到回收站") },
            text = { Text("确定将选中的 ${state.browseSelectedIds.size} 项移到回收站？文件夹及其内容也会一并移入。") },
            confirmButton = {
                TextButton(onClick = {
                    controller.trashSelectedBrowseNodes()
                    batchTrashConfirm = false
                }, enabled = !state.loading && !state.browseBatchWriteAttempted,
                    modifier = Modifier.testTag("files-batch-trash-confirm")
                        .heightIn(min = 48.dp)) { Text("移到回收站") }
            },
            dismissButton = {
                TextButton(onClick = { batchTrashConfirm = false },
                    modifier = Modifier.testTag("files-batch-trash-cancel")
                        .heightIn(min = 48.dp)) { Text("取消") }
            },
        )
    }
    filesEdit?.let { intent ->
        FilesEditDialog(intent = intent, busy = state.loading, onDismiss = { filesEdit = null }) { name ->
            if (!state.loading && state.screen == Screen.FILES &&
                state.filesSection == FilesSection.BROWSE) {
                when (intent.kind) {
                    FilesEditKind.CREATE_FOLDER -> controller.createFolder(name)
                    FilesEditKind.RENAME -> intent.node?.let { controller.renameBrowseNode(it, name) }
                    FilesEditKind.TRASH -> intent.node?.let(controller::moveBrowseNodeToTrash)
                }
                filesEdit = null
            }
        }
    }
    state.gallerySelected?.takeIf { state.screen == Screen.GALLERY }?.let { photo ->
        AlertDialog(onDismissRequest = controller::dismissGalleryInfo,
            title = { Text(photo.node.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (photo.mediaKind == "video") "视频" else if (photo.livePhoto) "实况照片" else "照片")
                    if (photo.capturedAt.isNotBlank()) Text("拍摄时间：${photo.capturedAt}")
                    Text("大小：${formatSize(photo.node.size)}")
                }
            },
            confirmButton = { TextButton(onClick = controller::dismissGalleryInfo,
                modifier = Modifier.heightIn(min = 48.dp)) { Text("关闭") } })
    }
    state.selected?.let { node ->
        AlertDialog(onDismissRequest = controller::dismissDetails, containerColor = MaterialTheme.colorScheme.surface,
            titleContentColor = MaterialTheme.colorScheme.onSurface, textContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            title = { Text(node.name) }, text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (node.isDirectory) "文件夹" else formatSize(node.size))
                    state.collectionItems.firstOrNull { it.node == node }?.let { item ->
                        if (item.path.isNotBlank()) Text("位置：${item.path}")
                    }
                    Text("修改时间：${node.updatedAt.ifEmpty { "未知" }}")
                    Text("版本：${node.revision}"); Text("文件 ID：${node.id}")
                }
            }, confirmButton = { TextButton(onClick = controller::dismissDetails, modifier = Modifier.heightIn(min = 48.dp)) { Text("关闭") } })
    }
    if (updates != null) UpdateDialog(updates, openUpdate)
}

@Composable
internal fun AccountMenu(state: DriveState, controller: DriveController, checkUpdates: (() -> Unit)? = null,
    fileView: FileViewMode? = null, onFileViewChange: (FileViewMode) -> Unit = {},
    onCreateFolder: (() -> Unit)? = null, onUpload: (() -> Unit)? = null) {
    var expanded by remember(state.screen) { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) { Icon(painterResource(R.drawable.xd_more_vert), "账户菜单") }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }, containerColor = MaterialTheme.colorScheme.surface) {
            if (state.server.isNotEmpty() || state.username.isNotEmpty()) Column(Modifier.widthIn(max = 280.dp).padding(16.dp)) {
                if (state.username.isNotEmpty()) Text(state.username, style = MaterialTheme.typography.titleSmall)
                Text(state.server, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (state.screen == Screen.FILES || state.screen == Screen.GALLERY) {
                DropdownMenuItem(text = { Text("刷新") },
                    leadingIcon = { Icon(painterResource(R.drawable.xd_refresh), null) },
                    enabled = !state.loading,
                    onClick = {
                        expanded = false
                        if (state.screen == Screen.GALLERY) controller.refreshGallery()
                        else controller.refresh()
                    })
                HorizontalDivider()
            }
            if (state.screen == Screen.FILES) DropdownMenuItem(
                text = { Text("照片") },
                modifier = Modifier.testTag("switch-to-gallery"),
                enabled = !state.loading && !state.fileUploadActive && !state.fileDownloadActive,
                onClick = { expanded = false; controller.openGallery() })
            if (state.screen == Screen.GALLERY) DropdownMenuItem(
                text = { Text("文件") },
                modifier = Modifier.testTag("switch-to-files"),
                onClick = { expanded = false; controller.openFilesApp() })
            if (fileView != null) {
                if (onUpload != null) DropdownMenuItem(
                    text = { Text("上传文件") },
                    enabled = !state.loading && state.loaded &&
                        !state.fileDownloadActive && !state.fileUploadActive &&
                        !state.browseSelectionMode,
                    modifier = Modifier.testTag("files-upload-action"),
                    onClick = { expanded = false; onUpload() })
                if (onCreateFolder != null) DropdownMenuItem(
                    text = { Text("新建文件夹") },
                    enabled = !state.loading && state.loaded,
                    modifier = Modifier.testTag("files-create-folder-action"),
                    onClick = { expanded = false; onCreateFolder() })
                DropdownMenuItem(text = { Text("图标") },
                    trailingIcon = { if (fileView == FileViewMode.GRID) Text("✓", color = MaterialTheme.colorScheme.primary) },
                    onClick = { expanded = false; onFileViewChange(FileViewMode.GRID) })
                DropdownMenuItem(text = { Text("列表") },
                    trailingIcon = { if (fileView == FileViewMode.LIST) Text("✓", color = MaterialTheme.colorScheme.primary) },
                    onClick = { expanded = false; onFileViewChange(FileViewMode.LIST) })
                HorizontalDivider()
            }
            if (checkUpdates != null) DropdownMenuItem(text = { Text("检查更新") },
                leadingIcon = { Icon(painterResource(R.drawable.xd_refresh), null) }, onClick = { expanded = false; checkUpdates() })
            if (state.screen == Screen.FILES || state.screen == Screen.GALLERY ||
                state.screen == Screen.PASSWORD) DropdownMenuItem(text = { Text("退出登录") },
                leadingIcon = { Icon(painterResource(R.drawable.xd_logout), null) }, onClick = { expanded = false; controller.logout() })
            if (state.screen != Screen.CONNECT) DropdownMenuItem(text = { Text("更换服务器") }, leadingIcon = { Icon(painterResource(R.drawable.xd_settings), null) },
                onClick = { expanded = false; controller.changeServer() })
        }
    }
}

internal fun formatSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.ROOT, "%.1f KiB", bytes / 1024.0)
    bytes < 1024L * 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MiB", bytes / (1024.0 * 1024))
    else -> String.format(Locale.ROOT, "%.1f GiB", bytes / (1024.0 * 1024 * 1024))
}
