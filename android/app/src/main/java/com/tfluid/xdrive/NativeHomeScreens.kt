package com.tfluid.xdrive

import android.content.res.Configuration
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Exactly five native destinations in both rotations; dynamic changes label only. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeHomeBottomBar(
    navigation: NativeHomeNavigation,
    onSelect: (NativeHomeTab) -> Unit,
    onShowDynamicPicker: () -> Unit = {},
) {
    val icons = listOf(
        R.drawable.xd_view_carousel, R.drawable.xd_refresh, R.drawable.xd_image,
        R.drawable.xd_folder, R.drawable.xd_settings,
    )
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    if (landscape) {
        Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(
                Modifier.fillMaxWidth().navigationBarsPadding().height(48.dp)
                    .testTag("native-five-slot-bar"),
            ) {
                NativeHomeTab.entries.forEachIndexed { index, tab ->
                    if (tab == NativeHomeTab.DYNAMIC) {
                        Row(
                            modifier = Modifier.weight(1f).fillMaxHeight()
                                .combinedClickable(
                                    onClick = { onSelect(tab) },
                                    onLongClickLabel = "选择最近动态功能",
                                    onLongClick = onShowDynamicPicker,
                                ).testTag("native-tab-dynamic"),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(painterResource(icons[index]), null, Modifier.size(18.dp))
                            Spacer(Modifier.width(3.dp))
                            Text(navigation.labels[index], fontSize = 11.sp,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    } else TextButton(
                        onClick = { onSelect(tab) },
                        modifier = Modifier.weight(1f).fillMaxHeight()
                            .testTag("native-tab-${tab.name.lowercase()}"),
                        contentPadding = PaddingValues(horizontal = 2.dp, vertical = 0.dp),
                    ) {
                        Icon(painterResource(icons[index]), null, Modifier.size(18.dp))
                        Spacer(Modifier.width(3.dp))
                        Text(navigation.labels[index], fontSize = 11.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    } else {
        NavigationBar(
            modifier = Modifier.testTag("native-five-slot-bar"),
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        ) {
            NativeHomeTab.entries.forEachIndexed { index, tab ->
                if (tab == NativeHomeTab.DYNAMIC) {
                    Column(
                        modifier = Modifier.weight(1f).fillMaxHeight()
                            .combinedClickable(
                                onClick = { onSelect(tab) },
                                onLongClickLabel = "选择最近动态功能",
                                onLongClick = onShowDynamicPicker,
                            ).testTag("native-tab-dynamic"),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Surface(
                            shape = RoundedCornerShape(18.dp),
                            color = if (navigation.selected == tab)
                                MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
                        ) {
                            Icon(painterResource(icons[index]), null,
                                Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
                                    .size(24.dp))
                        }
                        Text(navigation.labels[index], fontSize = 11.sp,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                } else NavigationBarItem(
                    selected = navigation.selected == tab,
                    onClick = { onSelect(tab) },
                    icon = { Icon(painterResource(icons[index]), null) },
                    label = { Text(navigation.labels[index], maxLines = 1) },
                    alwaysShowLabel = true,
                    modifier = Modifier.testTag("native-tab-${tab.name.lowercase()}"),
                )
            }
        }
    }
}

private data class NativeShortcutCard(
    val shortcut: NativeHomeShortcut,
    val title: String,
    val group: String,
    val icon: Int,
)

private val nativeShortcuts = listOf(
    NativeShortcutCard(NativeHomeShortcut.LOCAL_PHOTOS, "本机照片", "图库", R.drawable.xd_image),
    NativeShortcutCard(NativeHomeShortcut.LOCAL_ALBUMS, "本机相册", "图库", R.drawable.xd_view_carousel),
    NativeShortcutCard(NativeHomeShortcut.CLOUD_GALLERY, "云端照片", "图库", R.drawable.xd_image),
    NativeShortcutCard(NativeHomeShortcut.GALLERY_MAP, "地点地图", "图库", R.drawable.xd_view_carousel),
    NativeShortcutCard(NativeHomeShortcut.CLOUD_FILES, "云端文件", "文件", R.drawable.xd_folder),
    NativeShortcutCard(NativeHomeShortcut.TRASH, "回收站", "文件", R.drawable.xd_folder),
    NativeShortcutCard(NativeHomeShortcut.TRANSFERS, "传输中心", "工具", R.drawable.xd_refresh),
)

/** Launcher favorites and recent routes are memory-only for the current Owner session. */
@Composable
internal fun NativeHomeLauncher(
    navigation: NativeHomeNavigation,
    search: String,
    onSearch: (String) -> Unit,
    onShortcut: (NativeHomeShortcut) -> Unit,
    onFavorite: (NativeHomeShortcut) -> Unit,
    onChooseDynamic: () -> Unit = {},
) {
    val matched = nativeShortcuts.filter {
        search.isBlank() || it.title.contains(search.trim(), ignoreCase = true)
    }
    val groups = if (search.isNotBlank()) listOf("搜索结果" to matched) else buildList {
        val favorites = nativeShortcuts.filter { it.shortcut in navigation.favoriteShortcuts }
        if (favorites.isNotEmpty()) add("收藏" to favorites)
        val recent = navigation.recentShortcuts.mapNotNull { id ->
            nativeShortcuts.firstOrNull { it.shortcut == id }
        }
        if (recent.isNotEmpty()) add("最近打开" to recent)
        for (category in listOf("图库", "文件", "工具"))
            add(category to matched.filter { it.group == category })
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.fillMaxSize().testTag("native-launcher"),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            OutlinedTextField(
                value = search,
                onValueChange = onSearch,
                label = { Text("搜索功能") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("native-launcher-search"),
            )
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            TextButton(
                onClick = onChooseDynamic,
                modifier = Modifier.testTag("native-launcher-dynamic-picker"),
            ) { Text("选择最近动态功能") }
        }
        groups.forEach { (name, groupItems) ->
            if (groupItems.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(name, style = MaterialTheme.typography.titleMedium)
                }
                items(groupItems, key = { "$name-${it.shortcut.name}" }) { entry ->
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        modifier = Modifier.testTag("native-launcher-${entry.shortcut.name.lowercase()}"),
                    ) {
                        Column(Modifier.padding(8.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Icon(painterResource(entry.icon), null, Modifier.size(22.dp))
                                TextButton(
                                    onClick = { onFavorite(entry.shortcut) },
                                    modifier = Modifier.heightIn(min = 40.dp)
                                        .testTag("native-favorite-${entry.shortcut.name.lowercase()}"),
                                ) {
                                    Text(if (entry.shortcut in navigation.favoriteShortcuts) "★" else "☆")
                                }
                            }
                            TextButton(onClick = { onShortcut(entry.shortcut) },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Text(entry.title, maxLines = 2)
                            }
                        }
                    }
                }
            }
        }
        if (matched.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
            Text("没有匹配的功能", modifier = Modifier.testTag("native-launcher-empty"))
        }
    }
}

@Composable
internal fun NativeHomeMine(
    state: DriveState,
    onLogout: () -> Unit,
    onChangeServer: () -> Unit,
    onCheckUpdates: (() -> Unit)?,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)
            .testTag("native-mine"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("我的", style = MaterialTheme.typography.headlineSmall)
        Text("当前登录用户：${state.username.ifBlank { "未验证" }}")
        Text("服务器：${state.server.ifBlank { "未配置" }}",
            style = MaterialTheme.typography.bodyMedium)
        Text("内网地址：${state.route.lanIp.ifBlank { "自动／未设置" }}",
            style = MaterialTheme.typography.bodySmall)
        Text("设备相册权限及自动备份状态将在本机图库中独立授权；云端照片不代表本机已备份。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        val safe = !state.hasActiveNativeTransfer() && !state.loading
        Button(onClick = onChangeServer, enabled = safe,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("native-mine-server")) { Text("更换服务器") }
        OutlinedButton(onClick = onLogout, enabled = safe,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("native-mine-logout")) { Text("退出登录") }
        if (onCheckUpdates != null) TextButton(onClick = onCheckUpdates,
            modifier = Modifier.testTag("native-mine-update")) {
            Text("检查更新")
        }
    }
}

@Composable
internal fun NativeHomeDynamic(
    navigation: NativeHomeNavigation,
    state: DriveState,
    onOpenTransfers: () -> Unit,
    onChooseDynamic: () -> Unit = {},
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)
            .testTag("native-dynamic"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(navigation.dynamicFeature?.title ?: "最近",
            style = MaterialTheme.typography.headlineSmall)
        TextButton(onClick = onChooseDynamic,
            modifier = Modifier.testTag("native-dynamic-pick")) {
            Text("选择最近动态功能")
        }
        if (navigation.dynamicFeature == NativeDynamicFeature.TRANSFERS) {
            Text("当前登录的上传、下载和待核对操作；离开页面不会取消持久传输。")
            if (state.transferRecoveryIssue ||
                state.interruptedNativeTransfers.isNotEmpty()) {
                Text("有中断或结果待核对的传输", color = MaterialTheme.colorScheme.error)
            }
            for (entry in state.nativeTransfers.take(20)) {
                Text("${entry.fileName} · ${nativeTransferStatusLabel(entry)}",
                    style = MaterialTheme.typography.bodyMedium)
            }
            Button(onClick = onOpenTransfers,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("native-dynamic-transfers")) { Text("查看传输与恢复") }
        } else Text("暂无最近使用的动态功能。请从“全部”打开传输中心。")
    }
}

/** Local/cloud remain distinct sources. Map is a Gallery subroute, not a sixth tab. */
@Composable
internal fun NativeGallerySourceSelector(
    source: NativeGallerySource,
    onSelect: (NativeGallerySource) -> Unit,
) {
    val sources = listOf(
        NativeGallerySource.LOCAL to "本机照片",
        NativeGallerySource.ALBUMS to "本机相册",
        NativeGallerySource.CLOUD to "云端原件",
        NativeGallerySource.MAP to "地点",
    )
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .testTag("native-gallery-sources"),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        sources.forEach { (value, label) ->
            FilterChip(
                selected = source == value,
                onClick = { onSelect(value) },
                label = { Text(label) },
                modifier = Modifier.testTag("native-gallery-source-${value.name.lowercase()}"),
            )
        }
    }
}
