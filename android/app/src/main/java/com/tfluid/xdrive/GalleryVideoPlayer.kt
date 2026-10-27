package com.tfluid.xdrive

import androidx.annotation.OptIn
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import com.tfluid.xdrive.core.GalleryAsset

/** Observe a deliberate horizontal swipe without consuming Media3 touch events.
 * The bottom player-control area is excluded so seeking does not change files.
 * Native media controls retain full ownership of their touch and seek events. */
private fun Modifier.galleryVideoSwipeNavigation(
    video: GalleryAsset, controller: DriveController,
): Modifier = pointerInput(controller, video.node.id, video.node.revision) {
    val threshold = 72.dp.toPx()
    val protectedHeader = 52.dp.toPx()
    awaitEachGesture {
        val down = awaitFirstDown(
            requireUnconsumed = false, pass = PointerEventPass.Initial)
        val origin = down.position
        var singlePointer = true
        while (true) {
            val frame = awaitPointerEvent(PointerEventPass.Initial)
            if (frame.changes.count { it.pressed } > 1) singlePointer = false
            val pointer = frame.changes.firstOrNull { it.id == down.id } ?: break
            if (!pointer.pressed) {
                val dx = pointer.position.x - origin.x
                val dy = pointer.position.y - origin.y
                if (singlePointer &&
                    origin.y >= protectedHeader && origin.y < size.height * 0.78f &&
                    pointer.uptimeMillis - down.uptimeMillis <= 800L &&
                    kotlin.math.abs(dx) >= threshold &&
                    kotlin.math.abs(dx) > kotlin.math.abs(dy) * 1.25f &&
                    controller.state.value.galleryViewer == video) {
                    controller.shiftGalleryViewer(if (dx < 0f) 1 else -1)
                }
                break
            }
        }
    }
}

/** Real Owner video playback: no public media ticket or local loopback proxy.
 * Video decoding and playback/seek/buffering are delegated to Media3. */
@OptIn(UnstableApi::class)
@Composable
internal fun GalleryVideoPlayer(
    video: GalleryAsset, controller: DriveController,
    thumbnails: LruCache<String, ImageBitmap>,
) {
    val context = LocalContext.current
    val thumbKey = "${video.node.id}:${video.node.revision}"
    var cover by remember(video.node.id, video.node.revision) {
        mutableStateOf(thumbnails.get(thumbKey))
    }
    var firstFrame by remember(video.node.id, video.node.revision) {
        mutableStateOf(false)
    }
    var bufferedMs by remember(video.node.id, video.node.revision) {
        mutableLongStateOf(0L)
    }
    var durationMs by remember(video.node.id, video.node.revision) {
        mutableLongStateOf(video.durationMs)
    }
    // A cached Gallery tile is the first frame. Otherwise use only the
    // existing authenticated 4 MiB poster endpoint, never a second video GET.
    LaunchedEffect(video.node.id, video.node.revision) {
        if (cover != null || !video.hasThumbnail) return@LaunchedEffect
        val bitmap = try {
            val bytes = controller.galleryViewerThumbnail(video)
            if (bytes == null) null else withContext(Dispatchers.Default) {
                decodeGalleryThumbnail(bytes)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) { null }
        if (bitmap != null && controller.state.value.galleryViewer == video) {
            thumbnails.put(thumbKey, bitmap)
            cover = bitmap
        }
    }
    val source = remember(controller, video.node.id, video.node.revision) {
        controller.openGalleryVideoPlayback(video)
    }
    var failed by remember(video.node.id, video.node.revision) { mutableStateOf(false) }
    val player = remember(context, source) {
        if (source == null) null else ExoPlayer.Builder(context).build().apply {
            val dataSource = OkHttpDataSource.Factory(source.client)
            val media = ProgressiveMediaSource.Factory(dataSource)
                .createMediaSource(MediaItem.fromUri(source.url))
            setMediaSource(media)
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(player, source) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                failed = true // Do not display raw URL, host, credentials or body.
            }
            override fun onRenderedFirstFrame() {
                firstFrame = true // Never replace a visible frame with a late cover.
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (player == null) return
                bufferedMs = player.bufferedPosition.coerceAtLeast(0L)
                val duration = player.duration
                if (duration > 0 && duration != androidx.media3.common.C.TIME_UNSET) {
                    durationMs = duration
                }
            }
        }
        player?.addListener(listener)
        onDispose {
            player?.removeListener(listener)
            player?.release()
            if (source != null) controller.closeGalleryVideoPlayback(source)
        }
    }
    val canGoOlder = controller.galleryViewerCanShift(-1)
    val canGoNewer = controller.galleryViewerCanShift(1)
    Column(
        Modifier.fillMaxSize().background(Color.Black).testTag("gallery-video-viewer")
            .galleryVideoSwipeNavigation(video, controller)
            .semantics {
                customActions = buildList {
                    if (canGoOlder) add(CustomAccessibilityAction("上一项") {
                        controller.shiftGalleryViewer(-1)
                        true
                    })
                    if (canGoNewer) add(CustomAccessibilityAction("下一项") {
                        controller.shiftGalleryViewer(1)
                        true
                    })
                }
            },
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = controller::dismissGalleryViewer,
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-video-close")) {
                Text("返回", color = Color.White)
            }
            Text(video.node.name, modifier = Modifier.weight(1f), color = Color.White,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { controller.showGalleryInfo(video) },
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-video-info")) {
                Text("信息", color = Color.White)
            }
        }
        if (source == null || player == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("暂时无法播放这个视频", color = Color.White)
            }
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            this.player = player
                            useController = true
                            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                        }
                    },
                    update = { it.player = player },
                    modifier = Modifier.fillMaxSize().testTag("gallery-video-player"),
                )
                if (!firstFrame) {
                    val still = cover
                    if (still != null) {
                        Image(
                            bitmap = still, contentDescription = video.node.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize()
                                .testTag("gallery-video-poster"),
                        )
                    } else if (!failed) CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                            .testTag("gallery-video-loading"),
                        color = Color.White,
                    )
                }
                if (failed) {
                    Text("视频播放失败，请检查网络或文件格式。",
                        modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp)
                            .background(Color.Black.copy(alpha = 0.7f)),
                        color = Color.White)
                } else if (!firstFrame && bufferedMs > 0L) {
                    val total = if (durationMs > 0L) " / ${formatBufferedTime(durationMs)}" else ""
                    Text("已缓冲 ${formatBufferedTime(bufferedMs)}$total",
                        modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp)
                            .background(Color.Black.copy(alpha = 0.7f)),
                        color = Color.White, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

private fun formatBufferedTime(ms: Long): String {
    val seconds = (ms.coerceAtLeast(0L) / 1000L)
    return "%02d:%02d".format(seconds / 60L, seconds % 60L)
}
