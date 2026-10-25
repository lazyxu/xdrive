package com.tfluid.xdrive

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.util.Locale

@Composable
fun DriveApp(controller: DriveController, updates: UpdateController? = null, openUpdate: (String) -> Boolean = { false },
    initialFilesView: FileViewMode = FileViewMode.LIST, saveFilesView: (FileViewMode) -> Unit = {}) {
    val state by controller.state.collectAsStateWithLifecycle()
    var filesView by rememberSaveable { mutableStateOf(initialFilesView) }
    val mobilePage = Color(if (LocalXDriveDarkTheme.current) SharedVisuals.darkMobilePage else SharedVisuals.lightMobilePage)
    BackHandler(state.selected != null || (state.screen == Screen.FILES &&
        (state.filesSection != FilesSection.BROWSE || state.path.size > 1))) { controller.back() }
    Scaffold(modifier = Modifier.imePadding(), containerColor = if (state.screen == Screen.FILES) mobilePage else MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onSurface, topBar = {
        if (state.screen == Screen.FILES) Surface(color = mobilePage, contentColor = MaterialTheme.colorScheme.onSurface) {
            Row(Modifier.statusBarsPadding().fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 12.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                if (state.filesSection != FilesSection.BROWSE || state.path.size > 1)
                    IconButton(onClick = controller::back) { Icon(painterResource(R.drawable.xd_arrow_back), "返回上级") }
                else Spacer(Modifier.size(48.dp))
                Box(Modifier.weight(1f), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    var pathMenuOpen by remember(state.filesSection, state.path.map { it.id }) {
                        mutableStateOf(false)
                    }
                    val title = when (state.filesSection) {
                        FilesSection.RECENT -> "最近"
                        FilesSection.FAVORITES -> "收藏"
                        FilesSection.BROWSE -> state.path.lastOrNull()?.name?.ifEmpty { "浏览" } ?: "浏览"
                        FilesSection.SEARCH -> "搜索结果"
                    }
                    if (state.filesSection == FilesSection.BROWSE && state.path.size > 1) {
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
                    if (state.filesSection == FilesSection.BROWSE) filesView else null) {
                    filesView = it
                    saveFilesView(it)
                }
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
                Screen.FILES -> Files(state, controller, filesView)
            }
        }
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
    fileView: FileViewMode? = null, onFileViewChange: (FileViewMode) -> Unit = {}) {
    var expanded by remember(state.screen) { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) { Icon(painterResource(R.drawable.xd_more_vert), "账户菜单") }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }, containerColor = MaterialTheme.colorScheme.surface) {
            if (state.server.isNotEmpty() || state.username.isNotEmpty()) Column(Modifier.widthIn(max = 280.dp).padding(16.dp)) {
                if (state.username.isNotEmpty()) Text(state.username, style = MaterialTheme.typography.titleSmall)
                Text(state.server, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (state.screen == Screen.FILES) {
                DropdownMenuItem(text = { Text("刷新") },
                    leadingIcon = { Icon(painterResource(R.drawable.xd_refresh), null) },
                    enabled = !state.loading,
                    onClick = { expanded = false; controller.refresh() })
                HorizontalDivider()
            }
            if (fileView != null) {
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
            if (state.screen == Screen.FILES || state.screen == Screen.PASSWORD) DropdownMenuItem(text = { Text("退出登录") },
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
