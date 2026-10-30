package com.tfluid.xdrive

import android.util.LruCache
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAlbum
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Real Owner PhotoCollections. Manual creation writes to the existing Go
 * Owner API; imported/smart albums remain read-only native cards. */
@Composable
internal fun ColumnScope.GalleryCollections(
    state: DriveState,
    controller: DriveController,
    cache: LruCache<String, ImageBitmap>,
) {
    var createOpen by remember(state.server, state.username, state.nativeUiSessionId) { mutableStateOf(false) }
    var createName by remember(state.server, state.username, state.nativeUiSessionId) { mutableStateOf("") }
    // Hoisted out of LazyVerticalGrid: modal state must not be disposed with an album cell.
    var actionsTarget by remember(state.nativeUiSessionId) { mutableStateOf<GalleryAlbum?>(null) }
    var renameTarget by remember(state.server, state.username, state.nativeUiSessionId) {
        mutableStateOf<GalleryAlbum?>(null)
    }
    var deleteTarget by remember(state.server, state.username, state.nativeUiSessionId) {
        mutableStateOf<GalleryAlbum?>(null)
    }
    var resetCoverTarget by remember(state.server, state.username, state.nativeUiSessionId) {
        mutableStateOf<GalleryAlbum?>(null)
    }
    var renameDraft by remember(state.server, state.username, state.nativeUiSessionId) { mutableStateOf("") }
    val validCreateName =
        com.tfluid.xdrive.core.normalizeGalleryManualAlbumName(createName) != null
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("精选集", style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (state.galleryAlbumsLoaded) {
            Text("${state.galleryAlbums.size} 个相册",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
            TextButton(
                onClick = { createName = ""; createOpen = true },
                enabled = !state.loading && !state.galleryAlbumCreateAttempted &&
                    !state.galleryAlbumCreateCommittedNeedsRefresh &&
                    !state.galleryAlbumEditAttempted &&
                    !state.galleryAlbumEditCommittedNeedsRefresh,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-create-manual-album"),
            ) { Text("新建") }
        }
    }
    when {
        state.error != null && !state.galleryAlbumsLoaded -> Column(
            Modifier.weight(1f).fillMaxWidth().padding(20.dp)
                .testTag("gallery-albums-error"),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(state.error ?: "无法读取当前账户的相册，请重试。")
            TextButton(onClick = controller::retryGalleryAlbums,
                enabled = !state.loading, modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-albums-retry")) { Text("重试读取相册") }
        }
        !state.galleryAlbumsLoaded -> Box(
            Modifier.weight(1f).fillMaxWidth().testTag("gallery-albums-loading"),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }
        state.galleryAlbums.isEmpty() -> Box(
            Modifier.weight(1f).fillMaxWidth().testTag("gallery-albums-empty"),
            contentAlignment = Alignment.Center,
        ) {
            Text("暂无相册", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        else -> LazyVerticalGrid(
            // Match Mobile PWA Collections' 144dp image-card baseline. Lazy
            // composition prevents fetching covers for offscreen albums.
            columns = GridCells.Adaptive(minSize = 144.dp),
            modifier = Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-albums-list"),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 12.dp),
        ) {
            items(state.galleryAlbums, key = { it.id }) { album ->
                GalleryAlbumCard(album, controller, cache, state.loading,
                    onActions = { actionsTarget = it },
                )
            }
        }
    }
    // Keep the Owner-authorized action surface outside both the recyclable grid
    // and the card's open-album click target. It must survive modal recomposition.
    val actionAlbum = actionsTarget
    if (actionAlbum != null && !state.loading && state.galleryAlbumsLoaded &&
        state.galleryAlbums.any { it == actionAlbum } &&
        actionAlbum.kind == "manual" && actionAlbum.revision > 0) {
        AlertDialog(
            onDismissRequest = { actionsTarget = null },
            modifier = Modifier.testTag("gallery-manual-actions-${actionAlbum.id}"),
            title = { Text("相册操作：${actionAlbum.name}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(
                        onClick = {
                            actionsTarget = null
                            renameTarget = actionAlbum
                            renameDraft = actionAlbum.name
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("gallery-manual-rename-${actionAlbum.id}"),
                    ) { Text("重命名") }
                    TextButton(
                        onClick = {
                            actionsTarget = null
                            resetCoverTarget = actionAlbum
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("gallery-manual-auto-cover-${actionAlbum.id}"),
                    ) { Text("恢复自动封面") }
                    TextButton(
                        onClick = {
                            actionsTarget = null
                            deleteTarget = actionAlbum
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("gallery-manual-delete-${actionAlbum.id}"),
                    ) { Text("删除相册") }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { actionsTarget = null },
                    modifier = Modifier.testTag("gallery-manual-actions-close-${actionAlbum.id}"),
                ) { Text("取消") }
            },
        )
    }
    if (createOpen) AlertDialog(
        onDismissRequest = { if (!state.loading) createOpen = false },
        modifier = Modifier.testTag("gallery-create-manual-dialog"),
        title = { Text("新建相册") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("创建当前账号的空手动相册，不复制或上传任何照片。",
                    style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = createName,
                    onValueChange = { if (it.length <= 400) createName = it },
                    singleLine = true, label = { Text("相册名称") },
                    modifier = Modifier.fillMaxWidth().testTag("gallery-create-manual-name"),
                )
                if (createName.isNotEmpty() && !validCreateName) Text(
                    "名称无效：不能包含控制字符，最多 200 个字符。",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (validCreateName) {
                        createOpen = false
                        controller.createGalleryManualAlbum(createName)
                    }
                },
                enabled = validCreateName && state.galleryAlbumsLoaded &&
                    !state.loading && !state.galleryAlbumCreateAttempted &&
                    !state.galleryAlbumCreateCommittedNeedsRefresh,
                modifier = Modifier.testTag("gallery-create-manual-confirm")
                    .heightIn(min = 48.dp),
            ) { Text("创建") }
        },
        dismissButton = {
            TextButton(onClick = { createOpen = false }, enabled = !state.loading,
                modifier = Modifier.testTag("gallery-create-manual-cancel")
                    .heightIn(min = 48.dp)) { Text("取消") }
        },
    )
    renameTarget?.let { album ->
        val newName = com.tfluid.xdrive.core.normalizeGalleryManualAlbumName(renameDraft)
        val canRename = !state.loading && state.galleryAlbumsLoaded &&
            state.galleryAlbums.any { it == album } &&
            !state.galleryAlbumCreateAttempted &&
            !state.galleryAlbumCreateCommittedNeedsRefresh &&
            !state.galleryAlbumEditAttempted &&
            !state.galleryAlbumEditCommittedNeedsRefresh &&
            album.kind == "manual" && newName != null && newName != album.name
        AlertDialog(
            onDismissRequest = { if (!state.loading) renameTarget = null },
            modifier = Modifier.testTag("gallery-manual-rename-dialog"),
            title = { Text("重命名相册") },
            text = {
                OutlinedTextField(
                    value = renameDraft,
                    onValueChange = { if (it.length <= 400) renameDraft = it },
                    singleLine = true, label = { Text("相册名称") },
                    modifier = Modifier.fillMaxWidth().testTag("gallery-manual-rename-name"),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (canRename) {
                            renameTarget = null
                            controller.renameGalleryManualAlbum(album, renameDraft)
                        }
                    },
                    enabled = canRename,
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("gallery-manual-rename-confirm"),
                ) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }, enabled = !state.loading,
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
            },
        )
    }
    deleteTarget?.let { album ->
        val canDelete = !state.loading && state.galleryAlbumsLoaded &&
            state.galleryAlbums.any { it == album } && album.kind == "manual" &&
            !state.galleryAlbumCreateAttempted &&
            !state.galleryAlbumCreateCommittedNeedsRefresh &&
            !state.galleryAlbumEditAttempted &&
            !state.galleryAlbumEditCommittedNeedsRefresh
        AlertDialog(
            onDismissRequest = { if (!state.loading) deleteTarget = null },
            modifier = Modifier.testTag("gallery-manual-delete-dialog"),
            title = { Text("删除手动相册？") },
            text = {
                Text("将删除「${album.name}」的相册和成员关系，但不会删除原始照片或视频。此操作不能撤销。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (canDelete) {
                            deleteTarget = null
                            controller.deleteGalleryManualAlbum(album)
                        }
                    },
                    enabled = canDelete,
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("gallery-manual-delete-confirm"),
                ) { Text("删除相册") }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }, enabled = !state.loading,
                    modifier = Modifier.heightIn(min = 48.dp)) { Text("取消") }
            },
        )
    }
    resetCoverTarget?.let { album ->
        val canRestore = !state.loading && state.galleryAlbumsLoaded &&
            state.galleryAlbums.any { it == album } && album.kind == "manual" &&
            album.revision > 0 && !state.galleryAlbumCreateAttempted &&
            !state.galleryAlbumCreateCommittedNeedsRefresh &&
            !state.galleryAlbumEditAttempted &&
            !state.galleryAlbumEditCommittedNeedsRefresh
        AlertDialog(
            onDismissRequest = { if (!state.loading) resetCoverTarget = null },
            modifier = Modifier.testTag("gallery-manual-auto-cover-dialog"),
            title = { Text("恢复自动相册封面？") },
            text = {
                Text("相册将由服务器自动选择封面；即使取消自定义封面，仍可能显示相册中的首张照片。不会删除原始照片或视频。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (canRestore) {
                            resetCoverTarget = null
                            controller.restoreGalleryAutomaticAlbumCover(album)
                        }
                    },
                    enabled = canRestore,
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("gallery-manual-auto-cover-confirm"),
                ) { Text("恢复自动封面") }
            },
            dismissButton = {
                TextButton(
                    onClick = { resetCoverTarget = null }, enabled = !state.loading,
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("gallery-manual-auto-cover-cancel"),
                ) { Text("取消") }
            },
        )
    }
    // The same two-tab capsule and safe-area geometry as Gallery Library.
    Surface(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding()
            .testTag("gallery-collections-bottom"),
        color = Color.Transparent,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth().widthIn(max = 288.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.84f),
                shape = RoundedCornerShape(50.dp),
                tonalElevation = 2.dp,
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = controller::openGalleryLibrary,
                        modifier = Modifier.weight(1f).heightIn(min = 44.dp)
                            .testTag("gallery-collections-to-library"),
                    ) { Text("图库") }
                    Box(
                        Modifier.weight(1f).heightIn(min = 44.dp)
                            .background(MaterialTheme.colorScheme.surface,
                                RoundedCornerShape(50.dp))
                            .testTag("gallery-collections-active-tab"),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("精选集", style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

/** Explicit per-album accessibility names. Identical generic “更多操作” or
 * “重试封面” labels are unsafe when TalkBack navigates many Owner albums.
 * These are UI labels only; they confer no extra media or mutation authority. */
internal fun galleryAlbumOpenActionLabel(album: GalleryAlbum): String =
    "打开相册：${album.name}"
internal fun galleryAlbumRetryActionLabel(album: GalleryAlbum): String =
    "重试相册封面：${album.name}"
internal fun galleryAlbumMoreActionLabel(album: GalleryAlbum): String =
    "更多操作：${album.name}"

/** Owner-authenticated 144dp Collection card. Manual albums expose only
 * genuine Server actions; a failed cover keeps its own retry. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GalleryAlbumCard(
    album: GalleryAlbum,
    controller: DriveController,
    cache: LruCache<String, ImageBitmap>,
    busy: Boolean,
    onActions: (GalleryAlbum) -> Unit,
) {
    val identity = "${album.id}:${album.revision}:${album.coverNodeId}"
    var bitmap by remember(identity) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(identity) { mutableStateOf(false) }
    var loading by remember(identity) {
        mutableStateOf(album.coverNodeId != null)
    }
    var retry by remember(identity) { mutableIntStateOf(0) }
    LaunchedEffect(identity, retry) {
        if (album.coverNodeId == null || bitmap != null) return@LaunchedEffect
        loading = true
        failed = false
        try {
            val result = controller.galleryAlbumCover(album)
            if (result != null) {
                val key = "${result.nodeId}:${result.revision}"
                val decoded = cache.get(key) ?: withContext(Dispatchers.Default) {
                    decodeGalleryThumbnail(result.jpegBytes)
                }
                if (decoded != null) {
                    cache.put(key, decoded)
                    bitmap = decoded
                } else failed = true
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Derived cover is optional, so never make the real album
            // inaccessible or auto-retry an unbounded/denied response.
            failed = true
        } finally {
            loading = false
        }
    }

    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))) {
        // Only the image is the album-opening long-click target. The adjacent
        // action IconButton is a sibling, never a child of a clickable ancestor.
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f)
                .combinedClickable(
                    enabled = !busy,
                    onClick = { controller.openGalleryAlbum(album) },
                    onClickLabel = galleryAlbumOpenActionLabel(album),
                    onLongClickLabel = if (failed)
                        galleryAlbumRetryActionLabel(album) else null,
                    onLongClick = if (failed) ({ retry++ }) else null,
                )
                .testTag("gallery-album-item-${album.id}"),
        ) {
            Box(
                Modifier.fillMaxSize()
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .testTag("gallery-album-cover-${album.id}"),
            ) {
            val ready = bitmap
            if (ready != null) {
                Image(
                    bitmap = ready, contentDescription = album.name + "相册封面",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                        .testTag("gallery-album-cover-ready-${album.id}"),
                )
            } else {
                Icon(
                    painterResource(R.drawable.xd_folder), contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.Center).size(44.dp),
                )
            }
            if (loading && ready == null && album.coverNodeId != null) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.BottomStart)
                        .padding(8.dp).size(20.dp)
                        .testTag("gallery-album-cover-loading-${album.id}"),
                    strokeWidth = 2.dp,
                )
            } else if (failed && ready == null) {
                Text("封面失败·长按重试",
                    modifier = Modifier.align(Alignment.BottomStart)
                        .background(Color.Black.copy(alpha = 0.55f))
                        .padding(horizontal = 4.dp, vertical = 2.dp)
                        .testTag("gallery-album-cover-failed-${album.id}"),
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall)
            }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(
                Modifier.weight(1f).clickable(enabled = !busy) {
                    controller.openGalleryAlbum(album)
                },
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(album.name, style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${galleryAlbumKindLabel(album)} · ${album.itemCount} 项",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (album.kind == "manual" && album.revision > 0) {
                IconButton(
                    onClick = { onActions(album) },
                    enabled = !busy,
                    modifier = Modifier.size(48.dp)
                        .testTag("gallery-manual-more-${album.id}"),
                ) {
                    Icon(painterResource(R.drawable.xd_more_vert),
                        contentDescription = galleryAlbumMoreActionLabel(album))
                }
            }
        }
    }
}

private fun galleryAlbumKindLabel(album: GalleryAlbum): String = when (album.kind) {
    "manual" -> "个人相册"
    "smart" -> "智能相册"
    "imported" -> "导入相册"
    "folder" -> "相册文件夹"
    else -> "相册"
}
