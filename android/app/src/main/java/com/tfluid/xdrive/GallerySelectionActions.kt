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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAlbum
import com.tfluid.xdrive.core.GalleryAsset
import com.tfluid.xdrive.core.parseGalleryTagInput

/** Same compact iOS PWA selection menu: only actual current-Owner actions.
 * Do not advertise bulk download, destructive delete or query-wide selection. */
internal fun galleryManualAlbumChoices(albums: List<GalleryAlbum>, query: String): List<GalleryAlbum> {
    val needle = query.trim()
    return albums.filter { album ->
        album.kind == "manual" && album.revision > 0 &&
            (needle.isEmpty() || album.name.contains(needle, ignoreCase = true))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GallerySelectionActions(state: DriveState, controller: DriveController) {
    val selected = state.gallerySelectedItems
    val uncertain = state.galleryMetadataWriteAttempted
    var tagsOpen by remember { mutableStateOf(false) }
    var reviewOpen by remember { mutableStateOf(false) }
    var albumsOpen by remember { mutableStateOf(false) }
    var moreOpen by remember { mutableStateOf(false) }
    var removeMember by remember { mutableStateOf<GalleryAsset?>(null) }
    var albumQuery by remember { mutableStateOf("") }
    var albumID by remember { mutableStateOf("") }
    var albumSelectionIdentity by remember { mutableStateOf<List<Pair<Long, Long>>>(emptyList()) }
    var tagsDraft by remember { mutableStateOf("") }
    val tags = remember(tagsDraft) { parseGalleryTagInput(tagsDraft) }
    val enabled = selected.isNotEmpty() && !state.loading &&
        !uncertain && state.error == null
    val allFavorite = selected.isNotEmpty() && selected.all { it.favorite == true }
    val currentAlbum = state.gallerySelectedAlbum
    val canRemoveMember = currentAlbum?.kind == "manual" &&
        currentAlbum.itemCount > 0 && currentAlbum.revision > 0 &&
        selected.size == 1 && state.galleryLoaded &&
        state.galleryItems.any { it == selected.single() }
    val selectionChanged = albumsOpen &&
        albumSelectionIdentity != selected.map { it.node.id to it.node.revision }
    val manualAlbums = galleryManualAlbumChoices(state.galleryAlbums, "")
    val filteredAlbums = galleryManualAlbumChoices(state.galleryAlbums, albumQuery)
    val selectedAlbum = manualAlbums.firstOrNull { it.id == albumID }

    Surface(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .testTag("gallery-selection-actions"),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        shape = RoundedCornerShape(22.dp),
        tonalElevation = 2.dp,
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(
                    onClick = { controller.setGallerySelectionMode(false) },
                    enabled = !state.loading && !uncertain,
                    modifier = Modifier.size(48.dp).testTag("gallery-selection-done"),
                ) { Text("×", style = MaterialTheme.typography.titleLarge) }
                Text("已选择 " + selected.size + " 项",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium)
                TextButton(
                    onClick = { reviewOpen = true },
                    enabled = enabled,
                    modifier = Modifier.testTag("gallery-selection-review-open")
                        .heightIn(min = 48.dp),
                ) { Text("查看已选项") }
            }
            if (uncertain) {
                TextButton(
                    onClick = controller::refreshGallery,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth().testTag("gallery-selection-reconcile")
                        .heightIn(min = 48.dp),
                ) { Text("刷新核对（不重复提交）") }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { controller.favoriteGallerySelected(!allFavorite) },
                        enabled = enabled,
                        modifier = Modifier.testTag("gallery-selection-favorite")
                            .heightIn(min = 48.dp),
                    ) { Text(if (allFavorite) "取消收藏" else "收藏") }
                    Box {
                        IconButton(
                            onClick = { moreOpen = true },
                            enabled = enabled,
                            modifier = Modifier.size(48.dp).testTag("gallery-selection-more"),
                        ) {
                            Icon(painterResource(R.drawable.xd_more_vert),
                                contentDescription = "更多已选项目操作")
                        }
                        DropdownMenu(expanded = moreOpen,
                            onDismissRequest = { moreOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("加入相册") },
                                onClick = {
                                    moreOpen = false
                                    albumQuery = ""
                                    albumID = ""
                                    albumSelectionIdentity =
                                        selected.map { it.node.id to it.node.revision }
                                    albumsOpen = true
                                    controller.loadGalleryAlbumsForSelection()
                                },
                                modifier = Modifier.heightIn(min = 48.dp)
                                    .testTag("gallery-selection-add-album"),
                            )
                            DropdownMenuItem(
                                text = { Text("标签") },
                                onClick = {
                                    moreOpen = false
                                    tagsDraft = ""
                                    tagsOpen = true
                                },
                                modifier = Modifier.heightIn(min = 48.dp)
                                    .testTag("gallery-selection-tags"),
                            )
                            if (canRemoveMember) DropdownMenuItem(
                                text = { Text("设为相册封面") },
                                onClick = {
                                    moreOpen = false
                                    controller.setGallerySelectedManualAlbumCover(selected.single())
                                },
                                modifier = Modifier.heightIn(min = 48.dp)
                                    .testTag("gallery-selection-set-album-cover"),
                            )
                            if (canRemoveMember) DropdownMenuItem(
                                text = { Text("从相册移除") },
                                onClick = {
                                    moreOpen = false
                                    removeMember = selected.single()
                                },
                                modifier = Modifier.heightIn(min = 48.dp)
                                    .testTag("gallery-selection-remove-album-member"),
                            )
                        }
                    }
                }
            }
        }
    }
    removeMember?.let { member ->
        if (!uncertain) {
            val canConfirm = enabled && canRemoveMember &&
                state.gallerySelectedItems == listOf(member)
            AlertDialog(
                onDismissRequest = { if (!state.loading) removeMember = null },
                modifier = Modifier.testTag("gallery-remove-album-member-dialog"),
                title = { Text("从相册移除？") },
                text = {
                    Text("仅将「${member.node.name}」从当前手动相册中移除，不会删除原始照片或视频。")
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            if (canConfirm) {
                                removeMember = null
                                controller.removeGallerySelectedAlbumMember(member)
                            }
                        },
                        enabled = canConfirm,
                        modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("gallery-remove-album-member-confirm"),
                    ) { Text("移出相册") }
                },
                dismissButton = {
                    TextButton(
                        onClick = { removeMember = null }, enabled = !state.loading,
                        modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("gallery-remove-album-member-cancel"),
                    ) { Text("取消") }
                },
            )
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
        ModalBottomSheet(
            onDismissRequest = { if (!state.loading) albumsOpen = false },
            modifier = Modifier.testTag("gallery-album-picker"),
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(Modifier.fillMaxWidth().heightIn(max = 540.dp)
                .navigationBarsPadding().padding(horizontal = 16.dp)
                .padding(bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("加入手动相册", style = MaterialTheme.typography.titleMedium)
                    Text("已选择 " + selected.size + " 项",
                        style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { albumsOpen = false },
                        enabled = !state.loading,
                        modifier = Modifier.testTag("gallery-album-picker-close")
                            .heightIn(min = 48.dp)) { Text("关闭") }
                }
                HorizontalDivider()
                OutlinedTextField(
                    value = albumQuery,
                    onValueChange = { if (it.length <= 200) albumQuery = it },
                    singleLine = true,
                    label = { Text("搜索相册") },
                    placeholder = { Text("输入手动相册名称") },
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth().testTag("gallery-album-search"),
                )
                when {
                    state.loading && !state.galleryAlbumsLoaded ->
                        CircularProgressIndicator(
                            modifier = Modifier.testTag("gallery-album-picker-loading"))
                    !state.galleryAlbumsLoaded -> {
                        Text(state.error ?: "相册列表尚未载入。",
                            color = MaterialTheme.colorScheme.error)
                        TextButton(
                            onClick = controller::loadGalleryAlbumsForSelection,
                            modifier = Modifier.heightIn(min = 48.dp)
                                .testTag("gallery-album-picker-retry"),
                        ) { Text("重试读取相册") }
                    }
                    filteredAlbums.isEmpty() -> Text(
                        if (manualAlbums.isEmpty()) "暂无手动相册，请先在相册页面创建。"
                        else "没有匹配的手动相册",
                        modifier = Modifier.testTag("gallery-album-empty"),
                        style = MaterialTheme.typography.bodyMedium)
                    else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 300.dp)
                        .testTag("gallery-album-list")) {
                        items(filteredAlbums, key = { it.id }) { album ->
                            TextButton(
                                onClick = { albumID = album.id },
                                enabled = !state.loading && !selectionChanged,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                    .testTag("gallery-add-album-" + album.id),
                            ) {
                                Row(Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text((if (albumID == album.id) "✓ " else "") + album.name)
                                    Text(album.itemCount.toString() + " 项")
                                }
                            }
                        }
                    }
                }
                if (selectionChanged) Text(
                    "选择范围已变化，请关闭后重新打开相册选择器。",
                    color = MaterialTheme.colorScheme.error)
                HorizontalDivider()
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = { albumsOpen = false },
                        enabled = !state.loading,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                            .testTag("gallery-album-cancel"),
                    ) { Text("取消") }
                    Button(
                        onClick = {
                            val album = selectedAlbum
                            if (album != null && !selectionChanged) {
                                albumsOpen = false
                                controller.addGallerySelectedToAlbum(album)
                            }
                        },
                        enabled = enabled && !selectionChanged && selectedAlbum != null &&
                            state.galleryAlbumsLoaded,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                            .testTag("gallery-album-confirm"),
                    ) { Text("添加到相册") }
                }
            }
        }
    }
}
