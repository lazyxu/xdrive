package com.tfluid.xdrive

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.CancellationSignal
import android.provider.MediaStore
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal fun nativePhotoPermissions(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
    Build.VERSION.SDK_INT >= 33 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

internal fun nativePhotoAccess(context: Context): Boolean =
    nativePhotoPermissions().any { permission ->
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

/**
 * Only a user action requests MediaStore permission. Android 14 Selected Photos
 * is supported: a partial grant never gets described as the full photo library.
 * All identifiers are in Compose memory for this login epoch; no uploads occur.
 */
@Composable
internal fun NativeLocalMediaStoreGallery(albumsOnly: Boolean, sessionId: Long) {
    val context = LocalContext.current
    val resolver = context.contentResolver
    val lifecycle = LocalLifecycleOwner.current
    var permissionEpoch by remember(sessionId) { mutableIntStateOf(0) }
    var libraryEpoch by remember(sessionId) { mutableIntStateOf(0) }
    val allowed = remember(permissionEpoch, sessionId) { nativePhotoAccess(context) }
    val limitedAccess = Build.VERSION.SDK_INT >= 33 && (
        context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) !=
            PackageManager.PERMISSION_GRANTED ||
        context.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) !=
            PackageManager.PERMISSION_GRANTED)
    val permissionPrompt = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()) { permissionEpoch++ }
    var selectedAlbum by remember(sessionId, albumsOnly) { mutableStateOf<NativeLocalAlbum?>(null) }
    var selectedMedia by remember(sessionId, albumsOnly) { mutableStateOf<NativeLocalMedia?>(null) }
    var albums by remember(sessionId, albumsOnly) { mutableStateOf<NativeLocalAlbumScan?>(null) }
    var items by remember(sessionId, albumsOnly, selectedAlbum?.id) {
        mutableStateOf<List<NativeLocalMedia>>(emptyList())
    }
    var exhausted by remember(sessionId, albumsOnly, selectedAlbum?.id) { mutableStateOf(false) }
    var loadedThrough by remember(sessionId, albumsOnly, selectedAlbum?.id) { mutableIntStateOf(0) }
    var firstOffset by remember(sessionId, albumsOnly, selectedAlbum?.id) { mutableIntStateOf(0) }
    var albumVisibleCount by remember(sessionId, albumsOnly) {
        mutableIntStateOf(NativeLocalMediaStore.ALBUM_PAGE_SIZE)
    }
    var failure by remember(sessionId, albumsOnly, selectedAlbum?.id) {
        mutableStateOf<String?>(null)
    }
    var busy by remember(sessionId, albumsOnly, selectedAlbum?.id) { mutableStateOf(false) }
    var pageIntent by remember(sessionId, albumsOnly, selectedAlbum?.id) { mutableIntStateOf(0) }

    DisposableEffect(resolver, lifecycle, sessionId) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { libraryEpoch++ }
        }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) permissionEpoch++
            if (event == Lifecycle.Event.ON_STOP) selectedMedia = null
        }
        runCatching {
            resolver.registerContentObserver(
                MediaStore.Files.getContentUri("external"), true, observer)
        }
        lifecycle.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            runCatching { resolver.unregisterContentObserver(observer) }
            lifecycle.lifecycle.removeObserver(lifecycleObserver)
            selectedMedia = null
        }
    }

    LaunchedEffect(sessionId, albumsOnly, selectedAlbum?.id,
        permissionEpoch, libraryEpoch, allowed) {
        selectedMedia = null
        items = emptyList()
        albums = null
        exhausted = false
        loadedThrough = 0
        firstOffset = 0
        pageIntent = 0
        failure = null
        if (!allowed) return@LaunchedEffect
        busy = true
        try {
            if (albumsOnly && selectedAlbum == null) {
                albums = NativeLocalMediaStore.albums(resolver)
            } else {
                val page = NativeLocalMediaStore.page(resolver, 0,
                    NativeLocalMediaStore.PHOTO_PAGE_SIZE, selectedAlbum?.id)
                items = page
                loadedThrough = page.size
                exhausted = page.size < NativeLocalMediaStore.PHOTO_PAGE_SIZE
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: SecurityException) {
            failure = "相册权限已变化，请重新授权或重试。"
        } catch (_: Exception) {
            failure = "本机媒体索引读取失败，请重试。"
        } finally {
            busy = false
        }
    }
    LaunchedEffect(pageIntent, sessionId, albumsOnly, selectedAlbum?.id,
        permissionEpoch, libraryEpoch) {
        if (pageIntent == 0 || !allowed || exhausted || busy || failure != null) return@LaunchedEffect
        busy = true
        try {
            val current = items
            val next = NativeLocalMediaStore.page(resolver, loadedThrough,
                NativeLocalMediaStore.PHOTO_PAGE_SIZE, selectedAlbum?.id)
            if (!NativeLocalMediaStore.canAppend(current, next)) {
                failure = "媒体提供程序返回了重复页面；已停止加载以避免错乱。"
            } else {
                val merged = current + next
                val dropped = (merged.size - NativeLocalMediaStore.MAX_WALL_ITEMS).coerceAtLeast(0)
                items = if (dropped > 0) merged.drop(dropped) else merged
                firstOffset += dropped
                loadedThrough += next.size
                exhausted = next.size < NativeLocalMediaStore.PHOTO_PAGE_SIZE ||
                    loadedThrough >= NativeLocalMediaStore.MAX_SCAN
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failure = "下一页读取失败；现有照片保持不变。"
        } finally {
            busy = false
        }
    }
    if (!allowed) {
        Column(
            Modifier.fillMaxSize().padding(20.dp).testTag("native-local-permission"),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (albumsOnly) "本机相册" else "本机照片",
                style = MaterialTheme.typography.titleLarge)
            Text("仅在明确授权后读取设备的照片与视频；不会上传到服务器。Android 14 可只授权选中的照片。")
            Button(onClick = { permissionPrompt.launch(nativePhotoPermissions()) },
                modifier = Modifier.testTag("native-local-request-permission")) {
                Text("允许查看本机照片")
            }
        }
        return
    }
    Column(Modifier.fillMaxSize().testTag("native-local-gallery")) {
        Row(Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text(selectedAlbum?.title ?: if (albumsOnly) "本机相册" else "本机照片",
                    style = MaterialTheme.typography.titleMedium)
                Text(if (limitedAccess) "仅显示当前授权范围内的媒体"
                    else "本机媒体 · 与云端原件分开",
                    style = MaterialTheme.typography.bodySmall)
            }
            if (selectedAlbum != null)
                TextButton(onClick = { selectedAlbum = null },
                    modifier = Modifier.testTag("native-local-album-back")) {
                    Text("返回相册")
                }
            else TextButton(onClick = { libraryEpoch++ },
                modifier = Modifier.testTag("native-local-refresh")) { Text("刷新") }
        }
        if (failure != null) {
            Text(failure.orEmpty(), color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 12.dp)
                    .testTag("native-local-error"))
            TextButton(onClick = { libraryEpoch++ }) { Text("重试读取") }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (albumsOnly && selectedAlbum == null) {
            val scan = albums
            if (scan?.truncated == true) Text(
                "已扫描 ${scan.scanned} 项；相册数量超过安全上限，结果不完整。",
                modifier = Modifier.padding(12.dp),
                color = MaterialTheme.colorScheme.error)
            val visible = scan?.albums?.take(albumVisibleCount).orEmpty()
            LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp),
                modifier = Modifier.weight(1f).testTag("native-local-albums"),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(visible, key = { it.id }) { album ->
                    OutlinedCard(onClick = { selectedAlbum = album },
                        modifier = Modifier.testTag("native-local-album-${album.id}")) {
                        Column(Modifier.fillMaxWidth().padding(8.dp)) {
                            NativeLocalThumbnail(album.cover, 260,
                                Modifier.fillMaxWidth().height(112.dp))
                            Text(album.title, maxLines = 2,
                                overflow = TextOverflow.Ellipsis)
                            Text("${album.count} 项", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                if (scan != null && albumVisibleCount < scan.albums.size)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        TextButton(onClick = {
                            albumVisibleCount += NativeLocalMediaStore.ALBUM_PAGE_SIZE
                        }, modifier = Modifier.testTag("native-local-next-albums")) {
                            Text("显示更多相册")
                        }
                    }
            }
        } else {
            if (firstOffset > 0) TextButton(
                onClick = { libraryEpoch++ },
                modifier = Modifier.testTag("native-local-back-to-start")) {
                Text("返回最近照片 · 当前仅保留最近加载的 512 项")
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(112.dp),
                modifier = Modifier.weight(1f).testTag("native-local-photo-wall"),
                contentPadding = PaddingValues(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(items, key = { it.id }) { asset ->
                    OutlinedCard(onClick = { selectedMedia = asset },
                        modifier = Modifier.height(142.dp)
                            .testTag("native-local-media-${asset.id}")) {
                        Column {
                            NativeLocalThumbnail(asset, 260, Modifier.fillMaxWidth().weight(1f))
                            Text(if (asset.isVideo) "视频" else "照片",
                                modifier = Modifier.padding(4.dp),
                                style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                if (!exhausted && items.isNotEmpty())
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        TextButton(
                            onClick = { if (!busy) pageIntent++ },
                            enabled = !busy && failure == null,
                            modifier = Modifier.testTag("native-local-next-page"),
                        ) { Text("加载下一页 · 每页最多 64 项") }
                    }
            }
        }
    }
    selectedMedia?.let { asset ->
        NativeLocalMediaViewer(asset) { selectedMedia = null }
    }
}

/** Bounded, demand-driven provider thumbnail; never downloads an original for the wall. */
@Composable
private fun NativeLocalThumbnail(
    asset: NativeLocalMedia, size: Int, modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val thumbnail by produceState<ImageBitmap?>(null, asset.uri, size) {
        value = try {
            withContext(Dispatchers.IO) {
                val signal = CancellationSignal()
                try {
                    context.contentResolver.loadThumbnail(asset.uri, Size(size, size), signal)
                        .asImageBitmap()
                } finally { signal.cancel() }
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: Exception) { null }
    }
    if (thumbnail == null) Box(modifier) {
        Text("预览不可用", style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(8.dp))
    } else Image(requireNotNull(thumbnail), contentDescription =
        if (asset.isVideo) "本机视频预览" else "本机照片预览",
        modifier = modifier, contentScale = ContentScale.Crop)
}

/** L3 local Viewer: content:// only, no server bearer, no generated upload ACK. */
@Composable
private fun NativeLocalMediaViewer(
    asset: NativeLocalMedia, onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().testTag("native-local-viewer")) {
            Column(Modifier.fillMaxSize()) {
                TextButton(onClick = onDismiss,
                    modifier = Modifier.statusBarsPadding()
                        .testTag("native-local-viewer-back")) { Text("返回本机照片") }
                if (asset.isVideo) NativeLocalVideoPlayer(asset)
                else NativeLocalThumbnail(asset, 1800, Modifier.fillMaxWidth().weight(1f))
                Text("本机只读预览；动态照片的嵌入运动片段暂不支持播放，也不会自动备份。",
                    modifier = Modifier.navigationBarsPadding().padding(8.dp),
                    style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ColumnScope.NativeLocalVideoPlayer(asset: NativeLocalMedia) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val player = remember(asset.uri) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(asset.uri))
            prepare()
        }
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        lifecycle.lifecycle.addObserver(observer)
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            player.release()
        }
    }
    AndroidView(
        factory = { ctx -> PlayerView(ctx).apply { this.player = player } },
        update = { view -> view.player = player },
        modifier = Modifier.fillMaxWidth().weight(1f)
            .testTag("native-local-video-player"),
    )
}
