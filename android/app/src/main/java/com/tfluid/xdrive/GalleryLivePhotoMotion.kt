package com.tfluid.xdrive

import android.view.TextureView
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.tfluid.xdrive.core.GalleryAsset
import com.tfluid.xdrive.core.OwnerVideoPlayback
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Passive long-press observer: never consumes the image's existing double tap,
 * pinch/pan or horizontal Gallery navigation. The gesture is cancelled on
 * movement, another finger, release, revision switch or coroutine disposal.
 */
internal fun Modifier.galleryLivePhotoHold(
    enabled: Boolean,
    sourceIdentity: String,
    onHoldChanged: (Boolean) -> Unit,
): Modifier = if (!enabled) this else pointerInput(sourceIdentity) {
    awaitEachGesture {
        val down = awaitFirstDown(
            requireUnconsumed = false, pass = PointerEventPass.Initial)
        val pointerID = down.id
        val position = down.position
        val releasedBeforeHold = withTimeoutOrNull<Boolean>(
            viewConfiguration.longPressTimeoutMillis.toLong()) {
            var stopped = false
            while (!stopped) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val pointer = event.changes.firstOrNull { it.id == pointerID }
                stopped = pointer == null || !pointer.pressed ||
                    event.changes.count { it.pressed } != 1 ||
                    (pointer.position - position).getDistance() > viewConfiguration.touchSlop
            }
            true
        }
        if (releasedBeforeHold == null) {
            onHoldChanged(true)
            try {
                var pressed = true
                while (pressed) {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    val pointer = event.changes.firstOrNull { it.id == pointerID }
                    pressed = pointer != null && pointer.pressed &&
                        event.changes.count { it.pressed } == 1 &&
                        (pointer.position - position).getDistance() <=
                        viewConfiguration.touchSlop
                }
            } finally {
                onHoldChanged(false)
            }
        }
    }
}

private fun liveBufferClock(milliseconds: Long): String {
    val seconds = (milliseconds.coerceAtLeast(0L) / 1000L)
    return "%02d:%02d".format(seconds / 60L, seconds % 60L)
}

/** The bitmap remains visible throughout motion ticket lookup and buffering.
 * Go validates a real pair or .livp range: never infer a MOV from a filename.
 * A fresh Media3 scoped Dispatcher exists only during the current press.
 */
@OptIn(UnstableApi::class)
@Composable
internal fun GalleryLivePhotoMotion(
    photo: GalleryAsset,
    controller: DriveController,
    held: Boolean,
    stillReady: Boolean,
) {
    val context = LocalContext.current
    val currentHeld by rememberUpdatedState(held && stillReady)
    var lease by remember(photo.node.id, photo.node.revision) {
        mutableStateOf<OwnerVideoPlayback?>(null)
    }
    var frameReady by remember(photo.node.id, photo.node.revision) {
        mutableStateOf(false)
    }
    var ended by remember(photo.node.id, photo.node.revision) {
        mutableStateOf(false)
    }
    var failed by remember(photo.node.id, photo.node.revision) {
        mutableStateOf(false)
    }
    var bufferedMs by remember(photo.node.id, photo.node.revision) {
        mutableLongStateOf(0L)
    }
    var durationMs by remember(photo.node.id, photo.node.revision) {
        mutableLongStateOf(0L)
    }
    var videoAspect by remember(photo.node.id, photo.node.revision) {
        mutableFloatStateOf(16f / 9f)
    }

    LaunchedEffect(photo.node.id, photo.node.revision, held, stillReady) {
        if (!held || !stillReady) {
            frameReady = false
            lease = null
            return@LaunchedEffect
        }
        frameReady = false
        failed = false
        ended = false
        bufferedMs = 0L
        durationMs = 0L
        var current: OwnerVideoPlayback? = null
        try {
            current = controller.openGalleryLivePhotoPlayback(photo)
            if (current == null || !currentHeld) return@LaunchedEffect
            lease = current
            awaitCancellation()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (currentHeld) failed = true
        } finally {
            lease = null
            frameReady = false
            current?.let(controller::closeGalleryVideoPlayback)
        }
    }

    val player = remember(context, lease) {
        val source = lease
        if (source == null) null else createPreparedMediaResource(
            build = { ExoPlayer.Builder(context).build() },
            prepare = { owned ->
                owned.setMediaSource(ProgressiveMediaSource.Factory(
                    OkHttpDataSource.Factory(source.client))
                    .createMediaSource(MediaItem.fromUri(source.url)))
                owned.playWhenReady = true
                owned.prepare()
            },
            release = { it.release() },
        )
    }
    // A verified Owner stream is not proof that this Android codec/player
    // initialized correctly. Expose an error, not an inert loading spinner or
    // an exception escaping the Compose composition.
    val playerSetupFailed = lease != null && player == null

    DisposableEffect(player, photo.node.id, photo.node.revision) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() {
                if (currentHeld && !ended && !failed) frameReady = true
            }
            override fun onPlayerError(error: PlaybackException) {
                if (currentHeld) {
                    failed = true
                    frameReady = false
                }
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                val currentPlayer = player ?: return
                if (!currentHeld) return
                bufferedMs = currentPlayer.bufferedPosition.coerceAtLeast(0L)
                if (currentPlayer.duration > 0 && currentPlayer.duration != C.TIME_UNSET) {
                    durationMs = currentPlayer.duration
                }
                if (playbackState == Player.STATE_ENDED) {
                    ended = true
                    frameReady = false
                    currentPlayer.pause()
                }
            }
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (!currentHeld || videoSize.width <= 0 || videoSize.height <= 0) return
                val ratio = (videoSize.width.toFloat() / videoSize.height) *
                    videoSize.pixelWidthHeightRatio
                if (ratio.isFinite() && ratio in 0.1f..10f) videoAspect = ratio
            }
        }
        player?.addListener(listener)
        onDispose {
            player?.removeListener(listener)
            player?.release()
        }
    }

    if (!held || !stillReady) return
    BoxWithConstraints(Modifier.fillMaxSize().testTag("gallery-live-motion-surface"),
        contentAlignment = Alignment.Center) {
        if (player != null) {
            val edgeWidth = if (maxHeight > 0.dp && maxWidth / maxHeight > videoAspect)
                maxHeight * videoAspect else maxWidth
            val edgeHeight = edgeWidth / videoAspect
            // A TextureView can really decode while alpha is zero. Unlike a
            // SurfaceView it does not obscure the existing bitmap before the
            // compositor has presented the first video frame.
            key(player) {
                AndroidView(
                    factory = { ctx ->
                        TextureView(ctx).also { player.setVideoTextureView(it) }
                    },
                    modifier = Modifier.width(edgeWidth).height(edgeHeight)
                        .graphicsLayer {
                            alpha = if (currentHeld && frameReady && !ended && !failed) 1f else 0f
                        }
                        .testTag("gallery-live-motion-video"),
                )
            }
        }
        if (!frameReady || ended || failed || playerSetupFailed) {
            Row(
                Modifier.align(Alignment.TopEnd).padding(12.dp)
                    .background(Color.Black.copy(alpha = 0.65f))
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!ended && !failed) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(15.dp), strokeWidth = 2.dp,
                        color = Color.White,
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Text(
                    when {
                        failed || playerSetupFailed -> "动态暂不可播放"
                        ended -> "动态播放结束"
                        bufferedMs > 0 -> "已缓冲 ${liveBufferClock(bufferedMs)}" +
                            (if (durationMs > 0) " / ${liveBufferClock(durationMs)}" else "")
                        else -> "正在准备动态画面…"
                    },
                    color = Color.White, style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.testTag("gallery-live-motion-status"),
                )
            }
        }
    }
}
