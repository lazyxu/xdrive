package com.tfluid.xdrive

import androidx.annotation.OptIn
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.tfluid.xdrive.core.GalleryAsset

/** Real Owner video playback: no public media ticket or local loopback proxy.
 * Video decoding and playback/seek/buffering are delegated to Media3. */
@OptIn(UnstableApi::class)
@Composable
internal fun GalleryVideoPlayer(video: GalleryAsset, controller: DriveController) {
    val context = LocalContext.current
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
        }
        player?.addListener(listener)
        onDispose {
            player?.removeListener(listener)
            player?.release()
            if (source != null) controller.closeGalleryVideoPlayback(source)
        }
    }
    Column(Modifier.fillMaxSize().background(Color.Black).testTag("gallery-video-viewer")) {
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
                if (failed) Text("视频播放失败，请检查网络或文件格式。",
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    color = Color.White)
            }
        }
    }
}
