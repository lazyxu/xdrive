package com.tfluid.xdrive

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.OwnerVideoPlayback
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle

/** Only foreground Activity states may start an Owner audio stream.
 * A source resolved after ON_STOP must never begin playback in background. */
internal fun filesAudioMayAutoPlay(lifecycleState: Lifecycle.State): Boolean =
    lifecycleState.isAtLeast(Lifecycle.State.STARTED)

/** Files-only read-only audio. Media3 reuses the same pinned Owner Range/ETag
 * transport as the Gallery video Viewer. No downloaded audio file or token is
 * written to the device. Closing this screen releases and cancels the source. */
@OptIn(UnstableApi::class)
@Composable
internal fun NativeFilesAudioViewer(node: DriveNode, controller: DriveController) {
    val context = LocalContext.current
    var retryNonce by remember(node.id, node.revision) { mutableIntStateOf(0) }
    var source by remember(node.id, node.revision) {
        mutableStateOf<OwnerVideoPlayback?>(null)
    }
    var failed by remember(node.id, node.revision) { mutableStateOf(false) }
    LaunchedEffect(controller, node.id, node.revision, retryNonce) {
        source = null
        failed = false
        try {
            val result = controller.openFilesAudioPlayback(node)
            if (result == null) failed = true else source = result
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true // Never reveal raw Owner URL, token or headers.
        }
    }
    val activeSource = source // Capture exact source for Dispose, even after retry/logout.
    val lifecycleOwner = LocalLifecycleOwner.current
    val player = remember(context, activeSource, lifecycleOwner) {
        // The Android provider or Owner ticket may resolve only after
        // Activity STOP. Never bootstrap ExoPlayer in background autoplay.
        activeSource?.let { owned ->
            createFilesAudioPlayer(context, owned,
                allowAutoplay = filesAudioMayAutoPlay(
                    lifecycleOwner.lifecycle.currentState))
        }
    }
    // A verified Owner stream can exist even when Media3 initialization fails
    // (decoder/device resource unavailable). Never show inert play controls.
    val playerSetupFailed = activeSource != null && player == null
    var isPlaying by remember(node.id, node.revision) { mutableStateOf(false) }
    var positionMs by remember(node.id, node.revision) { mutableLongStateOf(0L) }
    var durationMs by remember(node.id, node.revision) { mutableLongStateOf(0L) }
    var bufferedMs by remember(node.id, node.revision) { mutableLongStateOf(0L) }
    var seeking by remember(node.id, node.revision) { mutableStateOf(false) }
    var seekProgress by remember(node.id, node.revision) { mutableFloatStateOf(0f) }
    DisposableEffect(player, activeSource, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player?.pause()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        // Cover a STOP that happened before this effect was installed.
        // The playback source may have been delivered asynchronously.
        if (!filesAudioMayAutoPlay(lifecycleOwner.lifecycle.currentState))
            player?.pause()
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(value: Boolean) { isPlaying = value }
            override fun onPlayerError(error: PlaybackException) { failed = true }
        }
        player?.addListener(listener)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            player?.removeListener(listener)
            player?.release()
            // Refers to the immutable stream from this exact player generation.
            // Reading mutable 'source' here would leak the old Owner client
            // when a failed playback is retried (source = null -> new source).
            activeSource?.let { controller.closeGalleryVideoPlayback(it) }
        }
    }
    LaunchedEffect(player, lifecycleOwner) {
        // Pause the frequent UI position poll while the app is backgrounded.
        // A STOP already paused playback; START only restores the controls,
        // never an old playWhenReady flag.
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (player != null) {
                positionMs = player.currentPosition.coerceAtLeast(0L)
                bufferedMs = player.bufferedPosition.coerceAtLeast(0L)
                durationMs = player.duration.takeIf { it > 0 } ?: 0L
                delay(250)
            }
        }
    }
    Column(
        Modifier.fillMaxSize().background(Color.Black).testTag("files-audio-viewer")
            .padding(horizontal = 20.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(
                onClick = controller::dismissFilesAudioViewer,
                modifier = Modifier.testTag("files-audio-close").heightIn(min = 48.dp),
            ) { Text("返回", color = Color.White) }
            Spacer(Modifier.width(8.dp))
            Text(node.name, modifier = Modifier.weight(1f),
                maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White,
                style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.weight(1f))
        Text("音频", color = Color.White, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(24.dp))
        when {
            source == null && !failed -> CircularProgressIndicator(color = Color.White,
                modifier = Modifier.testTag("files-audio-loading"))
            failed || playerSetupFailed -> {
                Text("音频暂时无法播放，请检查连接或文件格式。", color = Color.White,
                    modifier = Modifier.testTag("files-audio-error"))
                TextButton(onClick = { retryNonce++ }, modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("files-audio-retry")) { Text("重试", color = Color.White) }
            }
            else -> {
                val playable = player != null && durationMs > 0L
                Slider(
                    value = if (seeking) seekProgress
                        else if (durationMs > 0L)
                            (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
                        else 0f,
                    onValueChange = { seeking = true; seekProgress = it },
                    onValueChangeFinished = {
                        if (durationMs > 0L) {
                            player?.seekTo((durationMs * seekProgress).toLong()
                                .coerceIn(0L, durationMs))
                        }
                        seeking = false
                    },
                    enabled = playable,
                    modifier = Modifier.fillMaxWidth().testTag("files-audio-seek"),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(audioTime(positionMs), color = Color.White)
                    Text(if (playable) audioTime(durationMs) else "--:--", color = Color.White)
                }
                Spacer(Modifier.height(12.dp))
                Button(onClick = {
                    if (isPlaying) player?.pause()
                    else if (filesAudioMayAutoPlay(lifecycleOwner.lifecycle.currentState))
                        player?.play()
                },
                    enabled = player != null, modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("files-audio-play-pause")) {
                    Text(if (isPlaying) "暂停" else "播放")
                }
                if (bufferedMs > 0L) Text("已缓冲 ${audioTime(bufferedMs)}",
                    color = Color.LightGray, style = MaterialTheme.typography.bodySmall)
            }
        }
        Spacer(Modifier.weight(1f))
        Text("当前账户的只读播放；离开后立即释放连接。",
            color = Color.LightGray, style = MaterialTheme.typography.bodySmall)
    }
}

private fun audioTime(valueMs: Long): String {
    val total = valueMs.coerceAtLeast(0L) / 1000L
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds)
        else "%d:%02d".format(minutes, seconds)
}

/** When Media3 throws during preparation, it may already own a decoder/player.
 * Release that partial allocation; the matching Owner HTTP session is released
 * by the DisposableEffect bound to this exact source. */
@OptIn(UnstableApi::class)
private fun createFilesAudioPlayer(
    context: Context, owned: OwnerVideoPlayback, allowAutoplay: Boolean,
): ExoPlayer? {
    var candidate: ExoPlayer? = null
    return try {
        val player = ExoPlayer.Builder(context).build()
        candidate = player
        val reader = OkHttpDataSource.Factory(owned.client)
        val media = ProgressiveMediaSource.Factory(reader)
            .createMediaSource(MediaItem.fromUri(owned.url))
        player.setMediaSource(media)
        player.prepare()
        player.playWhenReady = allowAutoplay
        player
    } catch (_: Exception) {
        // Some vendor decoders also throw on cleanup after a failed prepare.
        // A second cleanup error must not escape into Compose or leak an
        // Owner-specific URL/transport cause into the visible UI.
        try { candidate?.release() } catch (_: Exception) { }
        null
    }
}
