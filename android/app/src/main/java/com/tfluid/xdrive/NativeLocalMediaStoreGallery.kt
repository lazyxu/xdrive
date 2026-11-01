package com.tfluid.xdrive

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.graphics.ImageDecoder
import android.provider.MediaStore
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import kotlinx.coroutines.android.awaitFrame
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
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
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
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

/**
 * Android 14+ explicitly supports re-selecting photos from within an app.
 * Do not offer re-selection for denied grants (the initial permission CTA
 * handles those), older Android releases, or already-full photo+video grants.
 * The selected-photo permission counts as readable even when neither broad
 * media grant is present.
 */
internal fun nativeLocalCanReselectMedia(
    sdkInt: Int,
    canReadAny: Boolean,
    fullImages: Boolean,
    fullVideos: Boolean,
): Boolean = sdkInt >= 34 && canReadAny && !(fullImages && fullVideos)

@Composable
internal fun NativeLocalMediaReselectAction(
    sdkInt: Int,
    canReadAny: Boolean,
    fullImages: Boolean,
    fullVideos: Boolean,
    onRequest: () -> Unit,
) {
    if (!nativeLocalCanReselectMedia(sdkInt, canReadAny, fullImages, fullVideos)) return
    // Only this explicit user gesture may launch the OS authorization flow.
    TextButton(
        onClick = onRequest,
        modifier = Modifier.heightIn(min = 48.dp)
            .testTag("native-local-reselect-media"),
    ) { Text("调整可查看的照片与视频") }
}


/**
 * A single provider-query cancellation lease per Owner/source/grant generation.
 * Compose disposes the previous signal as soon as a tab, selected album,
 * library revision or permission epoch changes, including while an OEM
 * provider is still blocked inside ContentResolver.query().
 *
 * Never save a CancellationSignal in Bundle, preferences or background tasks.
 */
@Composable
internal fun rememberNativeLocalGalleryQuerySignal(
    memory: NativeLocalGalleryMemory,
    sessionId: Long,
    albumsOnly: Boolean,
    albumId: String?,
    permissionEpoch: Int,
    libraryEpoch: Int,
    allowed: Boolean,
    mediaKind: String = "",
): CancellationSignal {
    val signal = remember(memory, sessionId, albumsOnly, albumId,
        permissionEpoch, libraryEpoch, allowed, mediaKind) { CancellationSignal() }
    DisposableEffect(signal) { onDispose { signal.cancel() } }
    return signal
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
 * The currently authorized MediaStore wall prefetches only after a real drag
 * reaches the visible tail. Programmatic restore and an initially short grid
 * never trigger an unbounded walk across the local photo library.
 */
internal data class NativeLocalWallPageViewport(
    val userGestureSeen: Boolean,
    val lastVisibleIndex: Int,
    val loadedCount: Int,
    val cursor: NativeLocalPageKey?,
    val canFetch: Boolean,
)

internal class NativeLocalWallAutoPager(private val prefetchDistance: Int = 12) {
    private var lastRequestedCursor: NativeLocalPageKey? = null

    fun shouldRequest(viewport: NativeLocalWallPageViewport): Boolean {
        if (!viewport.userGestureSeen || !viewport.canFetch ||
            viewport.loadedCount == 0 || viewport.cursor == null ||
            viewport.lastVisibleIndex < 0 ||
            viewport.lastVisibleIndex < (viewport.loadedCount - prefetchDistance).coerceAtLeast(0) ||
            lastRequestedCursor == viewport.cursor) return false
        lastRequestedCursor = viewport.cursor
        return true
    }
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
    memory: NativeLocalGalleryMemory? = null,
) {
    val context = LocalContext.current
    val resolver = context.contentResolver
    val lifecycle = LocalLifecycleOwner.current
    // The host owns this cache for exactly one authenticated Owner epoch.
    // The stand-alone fallback remains per-composition and does not persist.
    val cache = remember(sessionId, memory) { memory ?: NativeLocalGalleryMemory() }
    val wall = remember(cache, albumsOnly, selectedAlbum?.id) {
        cache.wallFor(albumsOnly, selectedAlbum?.id)
    }
    var permissionEpoch by remember(sessionId, cache) { mutableIntStateOf(0) }
    val libraryEpoch = cache.generation.intValue
    val jumpEpoch = wall.jumpEpoch.intValue
    val filterEpoch = wall.filterEpoch.intValue
    var mediaKind by wall.mediaKind
    var fullDateIndex by wall.fullDateIndex
    var fullDateBusy by wall.fullDateBusy
    var fullDateScanned by wall.fullDateScanned
    var fullDateError by wall.fullDateError
    var fullDateRequest by wall.fullDateRequest
    var dateScale by wall.dateScale
    var requestedDateScale by remember(sessionId, cache, albumsOnly,
        selectedAlbum?.id, libraryEpoch, mediaKind) {
        mutableStateOf<String?>(null)
    }
    val dateJumpScope = rememberCoroutineScope()
    val allowed = remember(sessionId, permissionEpoch, libraryEpoch) {
        nativePhotoAccess(context)
    }
    val querySignal = rememberNativeLocalGalleryQuerySignal(
        cache, sessionId, albumsOnly, selectedAlbum?.id, permissionEpoch,
        libraryEpoch, allowed, mediaKind)
    val fullImages = Build.VERSION.SDK_INT >= 33 &&
        context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) ==
            PackageManager.PERMISSION_GRANTED
    val fullVideos = Build.VERSION.SDK_INT >= 33 &&
        context.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) ==
            PackageManager.PERMISSION_GRANTED
    val limitedAccess = Build.VERSION.SDK_INT >= 33 && !(fullImages && fullVideos)
    val permissionPrompt = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()) {
        permissionEpoch++
        cache.invalidate()
    }
    // Album navigation is a Gallery-local child; it does not alter bottom tabs.
    BackHandler(albumsOnly && selectedAlbum != null) { onAlbumSelected(null) }
    var selectedMedia by remember(sessionId, albumsOnly) {
        mutableStateOf<NativeLocalMedia?>(null)
    }
    // Viewer return is a transient input-focus request, never persisted.
    // It can only resolve against an unchanged, authorized MediaStore window.
    var viewerReturn by remember(sessionId, albumsOnly) {
        mutableStateOf<NativeLocalViewerReturnAnchor?>(null)
    }
    var albums by cache.albumIndex
    val albumGridState by cache.albumGridState
    val photoGridState by wall.gridState
    var items by wall.items
    var exhausted by wall.exhausted
    var scannedCount by wall.scannedCount
    var nextPageKey by wall.nextPageKey
    var firstOffset by wall.firstOffset
    var albumVisibleCount by cache.albumVisibleCount
    var failure by wall.failure
    var busy by wall.busy
    var pageIntent by wall.pageIntent
    var consumedPageIntent by wall.consumedPageIntent

    // When no Owner-host observer was provided, retain the previous in-screen
    // ContentObserver/lifecycle contract. The host observer covers inactive tabs,
    // so it is not registered twice for an Owner-bound memory instance.
    DisposableEffect(resolver, lifecycle, sessionId, cache, memory) {
        val observer = if (memory == null) object : ContentObserver(
            Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { cache.invalidate() }
        } else null
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && memory == null) {
                permissionEpoch++
                cache.invalidate()
            }
            if (event == Lifecycle.Event.ON_STOP) {
                selectedMedia = null
                if (memory == null) cache.invalidate()
            }
        }
        if (observer != null) runCatching {
            resolver.registerContentObserver(
                MediaStore.Files.getContentUri("external"), true, observer)
        }
        lifecycle.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            if (observer != null) runCatching { resolver.unregisterContentObserver(observer) }
            lifecycle.lifecycle.removeObserver(lifecycleObserver)
            selectedMedia = null
            viewerReturn = null
        }
    }

    LaunchedEffect(querySignal, sessionId, albumsOnly, selectedAlbum?.id,
        permissionEpoch, libraryEpoch, allowed, jumpEpoch, filterEpoch) {
        selectedMedia = null
        val sameOrigin = viewerReturn?.let { anchor ->
            anchor.generation == libraryEpoch && anchor.albumsOnly == albumsOnly &&
                anchor.albumId == (if (albumsOnly) selectedAlbum?.id else null)
        } ?: true
        if (!allowed || !sameOrigin) viewerReturn = null
        if (!allowed) {
            cache.clearUnauthorized()
            return@LaunchedEffect
        }
        // A tab/source switch need not requery all earlier pages. The
        // foreground Owner observer invalidates them on library/grant change,
        // app background, or logout before any stale tile can be reused.
        if (albumsOnly && selectedAlbum == null && albums != null) return@LaunchedEffect
        if ((!albumsOnly || selectedAlbum != null) && wall.loaded.value) return@LaunchedEffect
        // A date jump already reset only the wall; clearing here would erase
        // the verified full-prefix group index and its per-group anchors.
        if (jumpEpoch == 0 && filterEpoch == 0) wall.clear()
        val pageStartAfter = wall.jumpAfter.value
        val pageStartOffset = wall.jumpOffset.intValue
        val readRevision = wall.revision.intValue
        busy = true
        try {
            if (albumsOnly && selectedAlbum == null) {
                val page = NativeLocalMediaStore.albums(resolver, querySignal)
                if (wall.revision.intValue != readRevision) return@LaunchedEffect
                albums = page
            } else {
                val page = NativeLocalMediaStore.pageAfter(resolver,
                    after = pageStartAfter, limit = NativeLocalMediaStore.PHOTO_PAGE_SIZE,
                    albumId = selectedAlbum?.id, cancellationSignal = querySignal,
                    mediaKind = mediaKind)
                if (wall.revision.intValue != readRevision) return@LaunchedEffect
                items = page
                firstOffset = pageStartOffset
                nextPageKey = page.lastOrNull()?.pageKey ?: pageStartAfter
                scannedCount = pageStartOffset + page.size
                exhausted = page.size < NativeLocalMediaStore.PHOTO_PAGE_SIZE ||
                    scannedCount >= NativeLocalMediaStore.MAX_SCAN
            }
            if (wall.revision.intValue == readRevision) wall.loaded.value = true
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: OperationCanceledException) {
            if (!querySignal.isCanceled && wall.revision.intValue == readRevision)
                failure = "本机媒体查询已中断，请重试。"
        } catch (_: SecurityException) {
            if (wall.revision.intValue == readRevision)
                failure = "相册权限已变化，请重新授权或重试。"
        } catch (_: Exception) {
            if (wall.revision.intValue == readRevision)
                failure = "本机媒体索引读取失败，请重试。"
        } finally {
            if (wall.revision.intValue == readRevision) busy = false
        }
    }
    // Full date metadata is built only after the user explicitly taps the
    // index action. No startup/Viewer/album navigation triggers 115k scanning.
    LaunchedEffect(querySignal, fullDateRequest, sessionId, albumsOnly,
        selectedAlbum?.id, permissionEpoch, libraryEpoch, allowed) {
        if (fullDateRequest == 0 || !allowed || !wall.loaded.value ||
            fullDateBusy || busy || failure != null || selectedMedia != null)
            return@LaunchedEffect
        val readRevision = wall.revision.intValue
        fullDateBusy = true
        fullDateError = null
        fullDateScanned = 0
        try {
            val index = scanNativeLocalFullDateIndex(
                resolver, selectedAlbum?.id, querySignal, mediaKind) { count ->
                withContext(Dispatchers.Main.immediate) {
                    if (wall.revision.intValue == readRevision &&
                        !querySignal.isCanceled) fullDateScanned = count
                }
            }
            if (wall.revision.intValue == readRevision && !querySignal.isCanceled) {
                fullDateIndex = index
                fullDateScanned = index.scanned
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: OperationCanceledException) {
            if (!querySignal.isCanceled && wall.revision.intValue == readRevision)
                fullDateError = "本机日期索引扫描已中断；现有照片不受影响。"
        } catch (_: SecurityException) {
            if (wall.revision.intValue == readRevision)
                fullDateError = "照片或视频读取权限已变化，请返回重新授权。"
        } catch (_: Exception) {
            if (wall.revision.intValue == readRevision)
                fullDateError = "无法读取当前授权范围的日期索引，请手动重试。"
        } finally {
            if (wall.revision.intValue == readRevision) fullDateBusy = false
        }
    }
    LaunchedEffect(querySignal, pageIntent, sessionId, albumsOnly, selectedAlbum?.id,
        permissionEpoch, libraryEpoch, allowed) {
        // Re-entering an inactive tab must not accidentally request another
        // page merely because its old pageIntent was already consumed.
        if (pageIntent == 0 || pageIntent == consumedPageIntent || !wall.loaded.value ||
            !allowed || exhausted || busy || fullDateBusy ||
            failure != null) return@LaunchedEffect
        consumedPageIntent = pageIntent
        val readRevision = wall.revision.intValue
        busy = true
        try {
            val current = items
            val next = NativeLocalMediaStore.pageAfter(resolver,
                after = nextPageKey,
                limit = NativeLocalMediaStore.PHOTO_PAGE_SIZE,
                albumId = selectedAlbum?.id, cancellationSignal = querySignal,
                mediaKind = mediaKind)
            if (wall.revision.intValue != readRevision) return@LaunchedEffect
            if (!NativeLocalMediaStore.canAppend(current, next)) {
                failure = "媒体提供程序返回了重复页面；已停止加载以避免错乱。"
            } else {
                val merged = current + next
                val dropped = (merged.size - NativeLocalMediaStore.MAX_WALL_ITEMS).coerceAtLeast(0)
                items = if (dropped > 0) merged.drop(dropped) else merged
                firstOffset += dropped
                nextPageKey = next.lastOrNull()?.pageKey ?: nextPageKey
                scannedCount += next.size
                exhausted = next.size < NativeLocalMediaStore.PHOTO_PAGE_SIZE ||
                    scannedCount >= NativeLocalMediaStore.MAX_SCAN
            }
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: OperationCanceledException) {
            if (!querySignal.isCanceled && wall.revision.intValue == readRevision)
                failure = "下一页查询已中断；现有照片保持不变。"
        } catch (_: Exception) {
            if (wall.revision.intValue == readRevision)
                failure = "下一页读取失败；现有照片保持不变。"
        } finally {
            if (wall.revision.intValue == readRevision) busy = false
        }
    }
    // Follow a *real* wall drag instead of restoring a saved LazyGrid viewport.
    // No initial 100k traversal, and no second page while an existing query or
    // manual next-page intent is outstanding. The existing 64-row keyset query,
    // 512-tile retention and explicit retry button remain authoritative.
    var localWallDragged by remember(querySignal, photoGridState) {
        mutableStateOf(false)
    }
    LaunchedEffect(querySignal, photoGridState) {
        photoGridState.interactionSource.interactions.collect { interaction ->
            if (interaction is DragInteraction.Start) localWallDragged = true
        }
    }
    LaunchedEffect(querySignal, photoGridState) {
        val pager = NativeLocalWallAutoPager()
        snapshotFlow {
            NativeLocalWallPageViewport(
                userGestureSeen = localWallDragged,
                lastVisibleIndex = photoGridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1,
                loadedCount = items.size,
                cursor = nextPageKey,
                canFetch = allowed && wall.loaded.value && selectedMedia == null &&
                    !busy && !fullDateBusy && failure == null && !exhausted &&
                    pageIntent == consumedPageIntent,
            )
        }.collect { viewport ->
            if (pager.shouldRequest(viewport)) pageIntent++
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
            else TextButton(onClick = { cache.invalidate() },
                modifier = Modifier.testTag("native-local-refresh")) { Text("刷新") }
        }
        NativeLocalMediaReselectAction(
            sdkInt = Build.VERSION.SDK_INT,
            canReadAny = allowed,
            fullImages = fullImages,
            fullVideos = fullVideos,
            onRequest = { permissionPrompt.launch(nativePhotoPermissions()) },
        )
        if (!albumsOnly || selectedAlbum != null) {
            NativeLocalMediaKindDock(
                selectedKind = mediaKind,
                enabled = allowed && !busy && !fullDateBusy &&
                    selectedMedia == null,
                onChoose = { kind ->
                    if (mediaKind != kind) {
                        requestedDateScale = null
                        viewerReturn = null
                        wall.selectMediaKind(kind)
                    }
                },
            )
            NativeLocalDateWindowDock(
                selectedScale = dateScale,
                enabled = items.isNotEmpty() && !busy && !fullDateBusy && failure == null,
                onPick = { scale ->
                    if (scale == "all") {
                        requestedDateScale = null
                        dateScale = "all"
                        if (nativeLocalMustRestartNewest(
                                firstOffset, wall.jumpOffset.intValue,
                                wall.jumpAfter.value)) {
                            viewerReturn = null
                            wall.jumpTo(null, 0)
                        } else dateJumpScope.launch { photoGridState.scrollToItem(0) }
                    } else requestedDateScale = scale
                },
            )
            if (items.isNotEmpty()) Text(
                "按加入时间定位 · 当前显示 ${items.size} 项",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 12.dp)
                    .testTag("native-local-date-window-scope"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(
                onClick = {
                    fullDateIndex = null
                    fullDateError = null
                    fullDateRequest++
                },
                enabled = wall.loaded.value && !busy && !fullDateBusy &&
                    selectedMedia == null && failure == null,
                modifier = Modifier.padding(horizontal = 12.dp).heightIn(min = 48.dp)
                    .testTag("native-local-full-date-scan"),
            ) { Text(if (fullDateIndex == null) "扫描当前授权范围的全部日期"
                else "重新扫描当前授权范围的日期") }
            if (fullDateBusy) {
                LinearProgressIndicator(Modifier.fillMaxWidth()
                    .testTag("native-local-full-date-progress"))
                Text("已扫描 ${fullDateScanned} 项；不读取照片原件",
                    style = MaterialTheme.typography.bodySmall)
            }
            if (fullDateIndex != null) Text(
                if (fullDateIndex!!.complete)
                    "日期索引已覆盖当前授权范围 ${fullDateIndex!!.scanned} 项（按加入时间）"
                else "仅覆盖前 ${fullDateIndex!!.scanned} 项；上限之外的日期未索引",
                modifier = Modifier.padding(horizontal = 12.dp)
                    .testTag("native-local-full-date-status"),
                style = MaterialTheme.typography.bodySmall,
            )
            if (fullDateError != null) Text(fullDateError.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 12.dp)
                    .testTag("native-local-full-date-error"))
        }
        if (failure != null) {
            Text(failure.orEmpty(), color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 12.dp)
                    .testTag("native-local-error"))
            TextButton(onClick = { cache.invalidate() }) { Text("重试读取") }
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
                onClick = { cache.invalidate() },
                modifier = Modifier.testTag("native-local-back-to-start")) {
                Text("返回最近照片 · 当前仅保留最近加载的 512 项")
            }
            // The Viewer unmounts the wall to cancel disposable thumbnail
            // reads, while the bounded Owner-local rows and viewport remain.
            val returnIndex = remember(viewerReturn, items, albumsOnly,
                selectedAlbum?.id, libraryEpoch, allowed) {
                nativeLocalViewerReturnIndex(viewerReturn, items.map { it.viewerReturnKey() },
                    albumsOnly, selectedAlbum?.id, libraryEpoch, allowed)
            }
            // Never retain a Viewer anchor after a grant, source or page
            // invalidation (including a media ID reused for a different item).
            LaunchedEffect(viewerReturn, returnIndex, allowed, libraryEpoch,
                selectedAlbum?.id, wall.loaded.value) {
                val anchor = viewerReturn ?: return@LaunchedEffect
                if (!allowed || anchor.generation != libraryEpoch ||
                    anchor.albumsOnly != albumsOnly ||
                    anchor.albumId != (if (albumsOnly) selectedAlbum?.id else null) ||
                    (wall.loaded.value && returnIndex == null)) {
                    viewerReturn = null
                }
            }
            LaunchedEffect(returnIndex, selectedMedia, photoGridState) {
                if (selectedMedia == null && returnIndex != null &&
                    returnIndex in items.indices) {
                    val key = items[returnIndex].id
                    // Keep the exact pre-Viewer pixel viewport if the tile is
                    // still visible; scroll only when paging/rotation hid it.
                    if (photoGridState.layoutInfo.visibleItemsInfo.none { it.key == key })
                        photoGridState.scrollToItem(returnIndex)
                }
            }
            if (selectedMedia == null) LazyVerticalGrid(
                state = photoGridState,
                columns = GridCells.Adaptive(112.dp),
                modifier = Modifier.weight(1f).testTag("native-local-photo-wall"),
                contentPadding = PaddingValues(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(items, key = { it.id }) { asset ->
                    NativeLocalPhotoWallTile(
                        asset = asset,
                        restoreFocus = returnIndex != null &&
                            items.getOrNull(returnIndex) == asset,
                        onOpen = {
                            viewerReturn = null
                            selectedMedia = asset
                        },
                        onFocusRestored = {
                            if (viewerReturn?.item == asset.viewerReturnKey())
                                viewerReturn = null
                        },
                    )
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
    val datePicker = requestedDateScale
    if (datePicker != null && selectedMedia == null &&
        (!albumsOnly || selectedAlbum != null)) {
        val indexed = fullDateIndex
        if (indexed != null && !fullDateBusy) {
            NativeLocalFullDatePicker(
                scale = datePicker, index = indexed,
                onDismiss = { requestedDateScale = null },
                onChoose = { group ->
                    // Keyset anchors originate only from the same current
                    // authorized snapshot; a stale sheet cannot jump sources.
                    if (wall.fullDateIndex.value === indexed &&
                        group.firstIndex in 0 until indexed.scanned && !busy) {
                        dateScale = datePicker
                        requestedDateScale = null
                        viewerReturn = null
                        wall.jumpTo(group.before, group.firstIndex)
                    }
                },
            )
        } else {
            val groups = remember(items, datePicker) {
                nativeLocalDateWindowGroups(items.map { it.addedAtSeconds }, datePicker)
            }
            NativeLocalDateWindowPicker(
                scale = datePicker, groups = groups, loadedCount = items.size,
                onDismiss = { requestedDateScale = null },
                onChoose = { group ->
                    if (group.firstIndex in items.indices) {
                        dateScale = datePicker
                        requestedDateScale = null
                        dateJumpScope.launch { photoGridState.scrollToItem(group.firstIndex) }
                    }
                },
            )
        }
    }
    selectedMedia?.let { asset ->
        val sourceKey = asset.viewerReturnKey()
        val loadedKeys = remember(items) { items.map { it.viewerReturnKey() } }
        val loadedIndex = if (allowed && wall.loaded.value)
            nativeLocalViewerLoadedIndex(loadedKeys, sourceKey) else null
        // Do not skip more than one item on a double tap against the old
        // composition. Also reject stale, revoked or switched album windows.
        val shiftLoaded: (Int) -> Unit = { direction ->
            val current = selectedMedia
            if (current != null && current.viewerReturnKey() == sourceKey &&
                allowed && wall.loaded.value &&
                cache.generation.intValue == libraryEpoch) {
                val next = nativeLocalViewerNeighborIndex(
                    items.map { it.viewerReturnKey() }, sourceKey, direction)
                if (next != null) selectedMedia = items[next]
            }
        }
        NativeLocalMediaViewer(
            asset = asset,
            loadedPosition = loadedIndex,
            loadedCount = loadedKeys.size,
            onPrevious = if (loadedIndex != null && loadedIndex > 0)
                ({ shiftLoaded(-1) }) else null,
            onNext = if (loadedIndex != null && loadedIndex < loadedKeys.lastIndex)
                ({ shiftLoaded(1) }) else null,
            onDismiss = {
                viewerReturn = NativeLocalViewerReturnAnchor(
                    asset.viewerReturnKey(), albumsOnly,
                    if (albumsOnly) selectedAlbum?.id else null, libraryEpoch)
                selectedMedia = null
            },
            onBackupOriginal = onBackupOriginal?.let { callback ->
                {
                    viewerReturn = null // consent overlay must own input focus
                    selectedMedia = null
                    callback(asset)
                }
            },
        )
    }
}

/**
 * One real, focusable native source tile. Recreated after the L3 Dialog
 * unmounts the thumbnail wall; the focus request targets this tile only.
 * Keyboard/DPAD focus is verified in Compose tests. TalkBack's separate
 * accessibility-focus restoration still requires physical-device acceptance.
 */
@Composable
internal fun NativeLocalPhotoWallTile(
    asset: NativeLocalMedia,
    restoreFocus: Boolean,
    onOpen: () -> Unit,
    onFocusRestored: () -> Unit,
    tileContent: @Composable ColumnScope.() -> Unit = {
        NativeLocalThumbnail(asset, 260, Modifier.fillMaxWidth().weight(1f))
        Text(if (asset.isVideo) "视频" else "照片",
            modifier = Modifier.padding(4.dp),
            style = MaterialTheme.typography.labelSmall)
    },
) {
    val requester = remember(asset.id, asset.uri) { FocusRequester() }
    var tileActuallyFocused by remember(asset.id, asset.uri) { mutableStateOf(false) }
    // A Dialog is a separate Android window. RequestFocus may report success
    // before the activity window owns *actual* input focus again; clearing the
    // source anchor on that result leaves Focused=false indefinitely.
    OutlinedCard(
        modifier = Modifier.height(142.dp)
            .focusRequester(requester)
            .onFocusChanged {
                tileActuallyFocused = it.isFocused
                if (it.isFocused && restoreFocus) onFocusRestored()
            }
            // Android Compose clickable is not keyboard-focusable in touch
            // input mode by default. Override only this exact source tile;
            // do not add a second independent focusable() node.
            .focusProperties { canFocus = true }
            .clickable(onClick = onOpen)
            .testTag("native-local-media-${asset.id}"),
    ) {
        Column { tileContent() }
    }
    LaunchedEffect(restoreFocus, asset.id, asset.uri) {
        if (restoreFocus) {
            // The Dialog is a distinct window. A one-shot request can be
            // accepted during its teardown without the source tile becoming
            // focused. Retry for at most 120 frames; the exact source anchor
            // remains scoped to this MediaStore item and permission epoch.
            repeat(120) {
                awaitFrame()
                if (tileActuallyFocused) return@LaunchedEffect
                requester.requestFocus()
            }
            // Never report success or clear the anchor without the tile's
            // actual onFocusChanged(isFocused) event.
        }
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
    loadedPosition: Int? = null,
    loadedCount: Int = 0,
    onPrevious: (() -> Unit)? = null,
    onNext: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val mediaKey = asset.viewerReturnKey()
    // Metadata is a candidate only; actual motion must be rendered by Media3.
    // Never scan the whole library or persist private media IDs.
    var motionCandidate by remember(mediaKey) { mutableStateOf(false) }
    var motionPlaying by remember(mediaKey) { mutableStateOf(false) }
    LaunchedEffect(mediaKey, asset.uri) {
        motionCandidate = false
        if (!asset.isVideo) motionCandidate = nativeLocalHasMotionPhotoCandidate(context, asset)
    }
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
                NativeLocalPhotoShareAction(asset)
                NativeLocalViewerLoadedNavigation(
                    loadedPosition, loadedCount, onPrevious, onNext)
                NativeLocalMotionControl(
                    candidate = motionCandidate,
                    playing = motionPlaying,
                    onToggle = { motionPlaying = !motionPlaying },
                )
                if (asset.isVideo || (motionCandidate && motionPlaying)) {
                    NativeLocalVideoPlayer(asset, autoPlay = !asset.isVideo)
                } else {
                    NativeLocalStillViewer(asset, onPrevious, onNext,
                        onMotionRequested = if (motionCandidate) {
                            { motionPlaying = true }
                        } else null)
                }
                Text("本机媒体只读预览：可用时读取原件，图片解码最长边不超过 4096 像素；" +
                    "原件失败时如可用则仅显示缩略图；动态片段需明确操作，不会自动上传或备份。",
                    modifier = Modifier.navigationBarsPadding().padding(8.dp),
                    style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}


/**
 * Viewer-only native navigation. Adjacent controls operate exclusively on
 * already-loaded local rows; they cannot query MediaStore, trigger backup,
 * or claim that a bounded page is the complete device photo library.
 */
@Composable
internal fun NativeLocalViewerLoadedNavigation(
    loadedPosition: Int?,
    loadedCount: Int,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        TextButton(
            onClick = { onPrevious?.invoke() },
            enabled = onPrevious != null,
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("native-local-viewer-previous"),
        ) { Text("上一项") }
        Text(
            text = if (loadedPosition != null && loadedPosition in 0 until loadedCount)
                "${loadedPosition + 1}/${loadedCount}（已加载）"
            else "当前媒体已变化",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("native-local-viewer-position"),
        )
        TextButton(
            onClick = { onNext?.invoke() },
            enabled = onNext != null,
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("native-local-viewer-next"),
        ) { Text("下一项") }
    }
}


/**
 * Only a single horizontal drag on an unzoomed still photo can navigate.
 * The existing real photo card and Owner-scoped loaded-neighbor callbacks
 * decide what is eligible; this gesture never performs a MediaStore read.
 * Video retains the explicit buttons so Media3 seek controls are not stolen.
 */
@Composable
internal fun NativeLocalPhotoSwipeSurface(
    mediaKey: NativeLocalViewerItemKey,
    zoomed: Boolean,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit,
) {
    // Pointer input must be restarted on a new photo or zoom state, but a
    // normal host recomposition must not leave an old callback in its scope.
    val currentPrevious by rememberUpdatedState(onPrevious)
    val currentNext by rememberUpdatedState(onNext)
    val canSwipe = !zoomed && (onPrevious != null || onNext != null)
    Box(
        modifier = modifier.pointerInput(mediaKey, canSwipe) {
            if (!canSwipe) return@pointerInput
            var horizontalDistance = 0f
            val threshold = 64.dp.toPx()
            detectHorizontalDragGestures(
                onDragStart = { horizontalDistance = 0f },
                onDragCancel = { horizontalDistance = 0f },
                onDragEnd = {
                    when (nativeLocalViewerSwipeDirection(
                        horizontalDistance, threshold, zoomed = false)) {
                        -1 -> currentPrevious?.invoke()
                        1 -> currentNext?.invoke()
                    }
                    horizontalDistance = 0f
                },
                onHorizontalDrag = { change, drag ->
                    horizontalDistance += drag
                    change.consume()
                },
            )
        },
        content = content,
    )
}

/**
 * Native local Viewer terminal state, intentionally not a generic HTTP retry.
 * Only the currently open content:// asset can be requested by the caller.
 */
@Composable
internal fun NativeLocalViewerRetryNotice(isVideo: Boolean, onRetry: () -> Unit) {
    val type = if (isVideo) "video" else "still"
    Column(
        Modifier.fillMaxWidth().padding(12.dp)
            .testTag("native-local-${type}-failure"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(if (isVideo) "本机视频无法播放，请确认权限或文件格式。"
            else "本机原件无法读取，请确认照片权限或文件状态。")
        TextButton(
            onClick = onRetry,
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("native-local-${type}-retry"),
        ) { Text(if (isVideo) "重试播放" else "重试读取") }
    }
}

/**
 * Only the currently selected content:// URI can yield local preview bytes.
 * A failed original may degrade to MediaStore's bounded thumbnail; that image
 * must NEVER be presented as original pixels. On manual retry, retain the
 * thumbnail until a real original succeeds, with no speculative gallery read.
 */
private sealed interface NativeLocalStillStage {
    data object Loading : NativeLocalStillStage
    data class Original(val bitmap: ImageBitmap) : NativeLocalStillStage
    data class Thumbnail(val bitmap: ImageBitmap) : NativeLocalStillStage
    data object Failed : NativeLocalStillStage
}

@Composable
internal fun NativeLocalStillFallbackNotice(
    retrying: Boolean,
    onRetryOriginal: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f))
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag("native-local-still-fallback"),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("仅显示本机缩略图 · 原件暂不可读取",
            style = MaterialTheme.typography.labelMedium)
        if (retrying) Text("正在重试读取原件…",
            style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onRetryOriginal, enabled = !retrying,
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("native-local-still-original-retry")) {
            Text("重试原件")
        }
    }
}

/**
 * Bounded ContentResolver original decode with an honest MediaStore fallback.
 * Viewer owns only its current bitmap and immediately cancels a stale thumbnail
 * request on a source, URI, retry or dialog change.
 */
@Composable
private fun ColumnScope.NativeLocalStillViewer(
    asset: NativeLocalMedia,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    onMotionRequested: (() -> Unit)? = null,
) {
    val resolver = LocalContext.current.contentResolver
    val mediaKey = asset.viewerReturnKey()
    var retryNonce by remember(mediaKey, asset.uri) { mutableIntStateOf(0) }
    var preview by remember(mediaKey, asset.uri) {
        mutableStateOf<NativeLocalStillStage>(NativeLocalStillStage.Loading)
    }
    var retryingOriginal by remember(mediaKey, asset.uri) { mutableStateOf(false) }
    val thumbnailSignal = remember(mediaKey, asset.uri, retryNonce) { CancellationSignal() }
    DisposableEffect(thumbnailSignal) { onDispose { thumbnailSignal.cancel() } }
    LaunchedEffect(mediaKey, asset.uri, retryNonce) {
        val previousThumbnail = preview as? NativeLocalStillStage.Thumbnail
        // A manual retry does not discard an already decoded fallback.
        if (previousThumbnail == null) preview = NativeLocalStillStage.Loading
        retryingOriginal = previousThumbnail != null
        try {
            val result = readLocalStillWithFallback(
                previousThumbnail = previousThumbnail?.bitmap,
                original = {
                    withContext(Dispatchers.IO) {
                        ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, asset.uri)) {
                            decoder, info, _ ->
                            val (width, height) = nativeStillDecodeSize(
                                info.size.width, info.size.height)
                            if (width != info.size.width || height != info.size.height)
                                decoder.setTargetSize(width, height)
                            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                        }.asImageBitmap()
                    }
                },
                thumbnail = {
                    // Exactly this current MediaStore URI: no whole-library
                    // scan, no upload and no speculative alternate permission.
                    withContext(Dispatchers.IO) {
                        resolver.loadThumbnail(
                            asset.uri, Size(512, 512), thumbnailSignal).asImageBitmap()
                    }
                },
            )
            currentCoroutineContext().ensureActive()
            preview = when (result) {
                is NativeLocalStillRead.Original -> NativeLocalStillStage.Original(result.value)
                is NativeLocalStillRead.Thumbnail -> NativeLocalStillStage.Thumbnail(result.value)
                NativeLocalStillRead.Failed -> NativeLocalStillStage.Failed
            }
        } finally {
            retryingOriginal = false
        }
    }
    var scale by remember(mediaKey, asset.uri) { mutableFloatStateOf(1f) }
    var translation by remember(mediaKey, asset.uri) { mutableStateOf(Offset.Zero) }
    var viewport by remember(mediaKey, asset.uri) { mutableStateOf(IntSize.Zero) }
    val gesture = rememberTransformableState { zoom, pan, _ ->
        val nextScale = (scale * zoom).coerceIn(1f, 5f)
        val maxX = viewport.width * (nextScale - 1f) / 2f
        val maxY = viewport.height * (nextScale - 1f) / 2f
        translation = if (nextScale <= 1f) Offset.Zero else Offset(
            (translation.x + pan.x).coerceIn(-maxX, maxX),
            (translation.y + pan.y).coerceIn(-maxY, maxY))
        scale = nextScale
    }
    NativeLocalPhotoSwipeSurface(
        mediaKey = asset.viewerReturnKey(),
        zoomed = scale > 1f,
        onPrevious = onPrevious,
        onNext = onNext,
        modifier = Modifier.fillMaxWidth().weight(1f).clipToBounds()
            .onSizeChanged { viewport = it }
            .pointerInput(mediaKey, onMotionRequested != null) {
                detectTapGestures(
                    onDoubleTap = {
                        scale = if (scale > 1f) 1f else 2f
                        translation = Offset.Zero
                    },
                    onLongPress = { if (scale <= 1f) onMotionRequested?.invoke() },
                )
            }
            // At 1× the one-finger horizontal gesture belongs to navigation.
            // Keep pinch zoom; only allow one-finger pan after magnification.
            .transformable(gesture, canPan = { scale > 1f })
            .testTag("native-local-still-zoom"),
    ) {
        val current = preview
        val bitmap = when (current) {
            is NativeLocalStillStage.Original -> current.bitmap
            is NativeLocalStillStage.Thumbnail -> current.bitmap
            else -> null
        }
        if (current == NativeLocalStillStage.Loading) CircularProgressIndicator()
        else if (current == NativeLocalStillStage.Failed) {
            NativeLocalViewerRetryNotice(isVideo = false, onRetry = { retryNonce++ })
        } else if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = if (current is NativeLocalStillStage.Thumbnail)
                    "本机照片缩略图，原件不可用" else "本机照片原件适屏预览",
                modifier = Modifier.fillMaxSize().graphicsLayer(
                    scaleX = scale, scaleY = scale,
                    translationX = translation.x, translationY = translation.y),
                contentScale = ContentScale.Fit,
            )
            if (current is NativeLocalStillStage.Thumbnail)
                NativeLocalStillFallbackNotice(
                    retrying = retryingOriginal,
                    onRetryOriginal = { retryNonce++ },
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
                )
        }
    }
}

/**
 * A setup/codec/permission failure must never crash the native Viewer or
 * silently leave a blank PlayerView. Retry is explicit, scoped to the same
 * current local asset; rebuilding never starts a Server upload or media query.
 */
@Composable
private fun ColumnScope.NativeLocalVideoPlayer(
    asset: NativeLocalMedia, autoPlay: Boolean = false,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val mediaKey = asset.viewerReturnKey()
    var retryNonce by remember(mediaKey) { mutableIntStateOf(0) }
    var failed by remember(mediaKey, retryNonce) { mutableStateOf(false) }
    val player = remember(context, mediaKey, retryNonce, autoPlay) {
        createPreparedMediaResource(
            build = { ExoPlayer.Builder(context).build() },
            prepare = { prepared ->
                // Media3 plays the embedded JPEG/HEIC Motion Photo video when
                // imageDurationMs is intentionally not supplied. Ordinary
                // videos keep their existing no-autoplay behavior.
                prepared.setMediaItem(MediaItem.fromUri(asset.uri))
                prepared.prepare()
                if (autoPlay) prepared.playWhenReady = true
            },
            release = { it.release() },
        )
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player?.pause()
        }
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                failed = true
            }
        }
        lifecycle.lifecycle.addObserver(observer)
        player?.addListener(listener)
        if (!lifecycle.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
            player?.pause()
        onDispose {
            lifecycle.lifecycle.removeObserver(observer)
            player?.removeListener(listener)
            player?.release()
        }
    }
    if (player == null || failed) {
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            NativeLocalViewerRetryNotice(isVideo = true, onRetry = { retryNonce++ })
        }
    } else {
        AndroidView(
            factory = { ctx -> PlayerView(ctx).apply { this.player = player } },
            update = { view -> view.player = player },
            modifier = Modifier.fillMaxWidth().weight(1f)
                .testTag("native-local-video-player"),
        )
    }
}
