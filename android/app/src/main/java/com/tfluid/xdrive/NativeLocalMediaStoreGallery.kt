package com.tfluid.xdrive

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.CancellationSignal
import android.graphics.ImageDecoder
import android.provider.MediaStore
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
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
import kotlin.math.roundToInt

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

/** ImageDecoder reads the authorized original but never allocates an unbounded display bitmap. */
internal fun nativeStillDecodeSize(width: Int, height: Int): Pair<Int, Int> {
    require(width > 0 && height > 0)
    val maxEdge = maxOf(width, height)
    if (maxEdge <= 4096) return width to height
    val factor = 4096.0 / maxEdge.toDouble()
    return maxOf(1, (width * factor).roundToInt()) to
        maxOf(1, (height * factor).roundToInt())
}

/**
 * Only a user action requests MediaStore permission. Android 14 Selected Photos
 * is supported: a partial grant never gets described as the full photo library.
 * All identifiers are in Compose memory for this login epoch; no uploads occur.
 */
@Composable
internal fun NativeLocalMediaStoreGallery(
    albumsOnly: Boolean,
    sessionId: Long,
    selectedAlbum: NativeLocalAlbum? = null,
    onAlbumSelected: (NativeLocalAlbum?) -> Unit = {},
    onBackupOriginal: ((NativeLocalMedia) -> Unit)? = null,
) {
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
    // The parent native Gallery owns the album breadcrumb across tab changes.
    // It never serializes MediaStore URI/IDs into Android saved state.
    BackHandler(albumsOnly && selectedAlbum != null) { onAlbumSelected(null) }
    var selectedMedia by remember(sessionId, albumsOnly) { mutableStateOf<NativeLocalMedia?>(null) }
    // Permission/MediaStore generation invalidates the cached album index; merely
    // opening an album must not rescan the whole local library on return.
    var albums by remember(sessionId, albumsOnly, permissionEpoch, libraryEpoch) {
        mutableStateOf<NativeLocalAlbumScan?>(null)
    }
    val albumGridState = remember(sessionId, albumsOnly, permissionEpoch, libraryEpoch) {
        LazyGridState()
    }
    val photoGridState = remember(sessionId, albumsOnly, selectedAlbum?.id,
        permissionEpoch, libraryEpoch) { LazyGridState() }
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
        exhausted = false
        loadedThrough = 0
        firstOffset = 0
        pageIntent = 0
        failure = null
        if (!allowed) return@LaunchedEffect
        busy = true
        try {
            if (albumsOnly && selectedAlbum == null) {
                if (albums == null) albums = NativeLocalMediaStore.albums(resolver)
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
                TextButton(onClick = { onAlbumSelected(null) },
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
                state = albumGridState,
                columns = GridCells.Adaptive(150.dp),
                modifier = Modifier.weight(1f).testTag("native-local-albums"),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(visible, key = { it.id }) { album ->
                    OutlinedCard(onClick = { onAlbumSelected(album) },
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
            // L3 Viewer outranks thumbnail reads: unmount the wall to cancel
            // unfinished ContentResolver thumbnail requests. The bounded rows
            // and LazyGridState stay in this Owner-scoped Gallery composition.
            if (selectedMedia == null) LazyVerticalGrid(
                state = photoGridState,
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
            } else Spacer(Modifier.weight(1f))
        }
    }
    selectedMedia?.let { asset ->
        NativeLocalMediaViewer(
            asset = asset,
            onDismiss = { selectedMedia = null },
            onBackupOriginal = onBackupOriginal?.let { callback ->
                { selectedMedia = null; callback(asset) }
            },
        )
    }
}

/** Bounded, demand-driven provider thumbnail; never downloads an original for the wall. */
@Composable
private fun NativeLocalThumbnail(
    asset: NativeLocalMedia, size: Int, modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    // Signal cancellation on composition disposal, not after an interrupted IO
    // dispatcher resumes: a slow MediaStore provider must yield to the Viewer.
    val signal = remember(asset.uri, size) { CancellationSignal() }
    DisposableEffect(signal) { onDispose { signal.cancel() } }
    val thumbnail by produceState<ImageBitmap?>(null, asset.uri, size, signal) {
        value = try {
            withContext(Dispatchers.IO) {
                context.contentResolver.loadThumbnail(asset.uri, Size(size, size), signal)
                    .asImageBitmap()
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
internal fun NativeLocalMediaViewer(
    asset: NativeLocalMedia, onDismiss: () -> Unit,
    onBackupOriginal: (() -> Unit)? = null,
) {
    Dialog(onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().testTag("native-local-viewer")) {
            Column(Modifier.fillMaxSize()) {
                TextButton(onClick = onDismiss,
                    modifier = Modifier.statusBarsPadding()
                        .testTag("native-local-viewer-back")) { Text("返回本机照片") }
                if (onBackupOriginal != null) TextButton(
                    onClick = onBackupOriginal,
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("native-local-backup-request"),
                ) { Text("备份这一项原件") }
                if (asset.isVideo) NativeLocalVideoPlayer(asset)
                else NativeLocalStillViewer(asset)
                Text("本机原件只读预览（解码最长边不超过 4096 像素）；动态照片运动片段暂不支持播放，也不会自动备份。",
                    modifier = Modifier.navigationBarsPadding().padding(8.dp),
                    style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * Original-resolution ContentResolver still decode, capped for GPU/heap safety.
 * Viewer owns its bitmap. Source revocation, Owner switch and background
 * unmount the dialog so no old picture survives the next authenticated page.
 */
@Composable
private fun ColumnScope.NativeLocalStillViewer(asset: NativeLocalMedia) {
    val resolver = LocalContext.current.contentResolver
    // null result means "still decoding", not a misleading permission failure.
    val preview by produceState<Result<ImageBitmap>?>(null, asset.uri) {
        value = try {
            Result.success(withContext(Dispatchers.IO) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, asset.uri)) {
                    decoder, info, _ ->
                    val (width, height) = nativeStillDecodeSize(
                        info.size.width, info.size.height)
                    if (width != info.size.width || height != info.size.height)
                        decoder.setTargetSize(width, height)
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }.asImageBitmap()
            })
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            Result.failure(failure) // Never fabricate a successful preview.
        }
    }
    var scale by remember(asset.uri) { mutableFloatStateOf(1f) }
    var translation by remember(asset.uri) { mutableStateOf(Offset.Zero) }
    var viewport by remember(asset.uri) { mutableStateOf(IntSize.Zero) }
    val gesture = rememberTransformableState { zoom, pan, _ ->
        val nextScale = (scale * zoom).coerceIn(1f, 5f)
        val maxX = viewport.width * (nextScale - 1f) / 2f
        val maxY = viewport.height * (nextScale - 1f) / 2f
        translation = if (nextScale <= 1f) Offset.Zero else Offset(
            (translation.x + pan.x).coerceIn(-maxX, maxX),
            (translation.y + pan.y).coerceIn(-maxY, maxY))
        scale = nextScale
    }
    Box(
        Modifier.fillMaxWidth().weight(1f).clipToBounds()
            .onSizeChanged { viewport = it }
            .pointerInput(asset.uri) {
                detectTapGestures(onDoubleTap = {
                    scale = if (scale > 1f) 1f else 2f
                    translation = Offset.Zero
                })
            }
            .transformable(gesture)
            .testTag("native-local-still-zoom"),
        contentAlignment = Alignment.Center,
    ) {
        val bitmap = preview?.getOrNull()
        if (preview == null) CircularProgressIndicator()
        else if (bitmap == null)
            Text("本机原件无法读取；请确认照片权限或返回刷新。")
        else Image(
            bitmap = bitmap,
            contentDescription = "本机照片原件",
            modifier = Modifier.fillMaxSize().graphicsLayer(
                scaleX = scale, scaleY = scale,
                translationX = translation.x, translationY = translation.y),
            contentScale = ContentScale.Fit,
        )
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
