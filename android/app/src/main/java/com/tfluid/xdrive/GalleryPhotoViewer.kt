package com.tfluid.xdrive

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAsset
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private sealed interface ImageStage {
    data object Loading : ImageStage
    data class Ready(val image: ImageBitmap) : ImageStage
    data object Failed : ImageStage
}

/** Sample pixels off the main thread and cap the decoded long edge to 2048.
 * This first stage intentionally rejects >32 MiB originals in the Controller
 * instead of risking unbounded memory; a later tiled decoder removes the cap. */
private fun decodeGalleryOriginal(bytes: ByteArray): ImageBitmap? {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    if (options.outWidth !in 1..32768 || options.outHeight !in 1..32768) return null
    var sample = 1
    while (maxOf(options.outWidth, options.outHeight) / sample > 2048) sample *= 2
    val sampled = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, sampled)?.asImageBitmap()
}

/** First real Android photo Viewer: Owner-revisioned source, no public URL,
 * native back/info and bounded zoom/pan. Videos and Live require separate
 * real playback work; they are never displayed as a pretend full Viewer. */
@Composable
internal fun GalleryPhotoViewer(photo: GalleryAsset, controller: DriveController) {
    // Persist no private media bytes; zoom and pan only live for one image.
    var zoom by remember(photo.node.id, photo.node.revision) { mutableFloatStateOf(1f) }
    var pan by remember(photo.node.id, photo.node.revision) { mutableStateOf(Offset.Zero) }
    val currentZoom by rememberUpdatedState(zoom)
    val swipeThreshold = with(LocalDensity.current) { 72.dp.toPx() }
    val older = controller.galleryViewerNeighbor(-1)
    val newer = controller.galleryViewerNeighbor(1)
    val stage by produceState<ImageStage>(ImageStage.Loading, photo.node.id, photo.node.revision) {
        value = try {
            val original = controller.galleryImageBytes(photo)
            val bitmap = withContext(Dispatchers.Default) { decodeGalleryOriginal(original) }
            if (bitmap == null) ImageStage.Failed else ImageStage.Ready(bitmap)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            ImageStage.Failed // Never render Server response bodies or token/URI.
        }
    }
    Column(Modifier.fillMaxSize().background(Color.Black).testTag("gallery-photo-viewer")) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = controller::dismissGalleryViewer,
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-photo-close")) {
                Text("返回", color = Color.White)
            }
            Text(photo.node.name, modifier = Modifier.weight(1f),
                color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { controller.showGalleryInfo(photo) },
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-photo-info")) {
                Text("信息", color = Color.White)
            }
        }
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-photo-gesture")
                // One-finger swipes are only page navigation at default zoom.
                // Pinch/pan remains owned by the image transformable recognizer.
                .pointerInput(photo.node.id, photo.node.revision) {
                    var distance = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { distance = 0f },
                        onDragEnd = {
                            if (currentZoom <= 1.001f) {
                                if (distance < -swipeThreshold) controller.shiftGalleryViewer(1)
                                if (distance > swipeThreshold) controller.shiftGalleryViewer(-1)
                            }
                            distance = 0f
                        },
                        onDragCancel = { distance = 0f },
                        onHorizontalDrag = { change, drag ->
                            if (currentZoom <= 1.001f) {
                                distance += drag
                                change.consume()
                            }
                        },
                    )
                }
                // TalkBack exposes the same real current-Owner navigation without
                // inventing extra iOS-foreign overlay arrows or media controls.
                .semantics {
                    customActions = buildList {
                        if (older != null) add(CustomAccessibilityAction("上一张照片") {
                            controller.shiftGalleryViewer(-1)
                            true
                        })
                        if (newer != null) add(CustomAccessibilityAction("下一张照片") {
                            controller.shiftGalleryViewer(1)
                            true
                        })
                    }
                },
            contentAlignment = Alignment.Center) {
            when (val current = stage) {
                ImageStage.Loading -> CircularProgressIndicator(
                    color = Color.White, modifier = Modifier.testTag("gallery-photo-loading"))
                ImageStage.Failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("原图无法预览", color = Color.White)
                    Text("请检查连接；超过 32 MiB 的原图需要后续分块预览。",
                        color = Color.LightGray, style = MaterialTheme.typography.bodySmall)
                }
                is ImageStage.Ready -> {
                    val maxX = constraints.maxWidth.toFloat()
                    val maxY = constraints.maxHeight.toFloat()
                    val gesture = rememberTransformableState { change, drag, _ ->
                        val next = (zoom * change).coerceIn(1f, 5f)
                        zoom = next
                        val boundX = maxX * (next - 1f) / 2f
                        val boundY = maxY * (next - 1f) / 2f
                        pan = if (next == 1f) Offset.Zero else Offset(
                            (pan.x + drag.x).coerceIn(-boundX, boundX),
                            (pan.y + drag.y).coerceIn(-boundY, boundY))
                    }
                    Image(
                        bitmap = current.image, contentDescription = photo.node.name,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                            .graphicsLayer {
                                scaleX = zoom
                                scaleY = zoom
                                translationX = pan.x
                                translationY = pan.y
                            }
                            .transformable(gesture)
                            .pointerInput(photo.node.id, photo.node.revision) {
                                detectTapGestures(onDoubleTap = {
                                    zoom = if (zoom > 1f) 1f else 2f
                                    pan = Offset.Zero
                                })
                            }
                            .testTag("gallery-photo-image"))
                }
            }
        }
    }
}
