package com.tfluid.xdrive

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import java.util.Locale
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.GalleryAsset
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private sealed interface ImageStage {
    data object Loading : ImageStage
    data class Ready(val image: ImageBitmap, val thumbnailOnly: Boolean = false,
        val upgrading: Boolean = false) : ImageStage
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

/** Native Owner photo Viewer with bounded original decode and explicit
 * authenticated-thumbnail fallback; the fallback is not full-resolution.
 * Video and Live motion use their separate verified playback contracts. */
@Composable
internal fun GalleryPhotoViewer(
    photo: GalleryAsset, controller: DriveController,
    thumbnails: LruCache<String, ImageBitmap>,
) {
    // Persist no private media bytes; zoom and pan only live for one image.
    var zoom by remember(photo.node.id, photo.node.revision) { mutableFloatStateOf(1f) }
    var pan by remember(photo.node.id, photo.node.revision) { mutableStateOf(Offset.Zero) }
    // Only an explicit user action retries both existing authenticated readers.
    // Never poll a failed or revoked private media request in the background.
    var retryNonce by remember(photo.node.id, photo.node.revision) { mutableIntStateOf(0) }
    var liveHeld by remember(photo.node.id, photo.node.revision) { mutableStateOf(false) }
    val liveSwipeFence = remember(photo.node.id, photo.node.revision) {
        GalleryLiveHoldSwipeFence()
    }
    var originalProgress by remember(photo.node.id, photo.node.revision) {
        mutableStateOf(0L to (null as Long?))
    }
    val currentZoom by rememberUpdatedState(zoom)
    val swipeThreshold = with(LocalDensity.current) { 72.dp.toPx() }
    val canGoOlder = controller.galleryViewerCanShift(-1)
    val canGoNewer = controller.galleryViewerCanShift(1)
    val cacheKey = "${photo.node.id}:${photo.node.revision}"
    val cachedThumbnail = thumbnails.get(cacheKey)
    val canReadOriginal =
        (photo.livePhoto && photo.node.name.endsWith(".livp", ignoreCase = true)) ||
        photo.node.size in 1L..(32L * 1024 * 1024)
    val stage by produceState<ImageStage>(
        cachedThumbnail?.let {
            ImageStage.Ready(it, thumbnailOnly = true, upgrading = canReadOriginal)
        } ?: ImageStage.Loading,
        photo.node.id, photo.node.revision, retryNonce,
    ) {
        // The Gallery tile and Viewer share one bounded, Owner-session bitmap.
        // A cold thumbnail and original proceed independently. Whichever is
        // actually decoded first is visible; a late thumbnail never replaces
        // a ready original. The parent effect cancels both on Viewer change.
        coroutineScope {
            var thumbnail = thumbnails.get(cacheKey)
            var original: ImageBitmap? = null
            var originalDone = !canReadOriginal
            var thumbnailDone = thumbnail != null || !photo.hasThumbnail
            fun publish() {
                value = when {
                    original != null -> ImageStage.Ready(original!!)
                    thumbnail != null -> ImageStage.Ready(
                        thumbnail!!, thumbnailOnly = true, upgrading = !originalDone)
                    originalDone && thumbnailDone -> ImageStage.Failed
                    else -> ImageStage.Loading
                }
            }
            publish()
            if (!thumbnailDone) launch {
                val decoded = try {
                    val bytes = controller.galleryViewerThumbnail(photo)
                    if (bytes == null) null else withContext(Dispatchers.Default) {
                        decodeGalleryThumbnail(bytes)
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) { null }
                if (decoded != null) {
                    thumbnail = decoded
                    thumbnails.put(cacheKey, decoded)
                }
                thumbnailDone = true
                publish()
            }
            if (!originalDone) launch {
                original = try {
                    val bytes = controller.galleryImageBytes(photo) { done, total ->
                        originalProgress = done to total
                    }
                    withContext(Dispatchers.Default) { decodeGalleryOriginal(bytes) }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) { null }
                originalDone = true
                publish()
            }
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
                .galleryLivePhotoHold(
                    enabled = photo.livePhoto && stage is ImageStage.Ready,
                    sourceIdentity = "${photo.node.id}:${photo.node.revision}",
                ) { pressed ->
                    if (pressed) liveSwipeFence.liveHoldActivated()
                    liveHeld = pressed
                }
                // One-finger swipes are only page navigation at default zoom.
                // Pinch/pan remains owned by the image transformable recognizer.
                // Passively observe INITIAL-pass movement before the nested
                // image transformable can consume Main-pass drag deltas.
                // Do not consume: pinch/pan/tap and trusted Live hold retain
                // ownership of their gestures. Only a single pointer at 1x
                // may navigate between adjacent Owner media (photo or video).
                .pointerInput(controller, photo.node.id, photo.node.revision) {
                    awaitEachGesture {
                        val down = awaitFirstDown(
                            requireUnconsumed = false,
                            pass = PointerEventPass.Initial,
                        )
                        val origin = down.position
                        liveSwipeFence.beginGesture()
                        var singlePointer = true
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            if (event.changes.count { it.pressed } > 1)
                                singlePointer = false
                            val pointer = event.changes.firstOrNull {
                                it.id == down.id
                            } ?: break
                            if (!pointer.pressed) {
                                val dx = pointer.position.x - origin.x
                                val dy = pointer.position.y - origin.y
                                if (liveSwipeFence.mayShift(
                                        deltaX = dx, deltaY = dy,
                                        durationMillis = pointer.uptimeMillis - down.uptimeMillis,
                                        thresholdPx = swipeThreshold,
                                        singlePointer = singlePointer,
                                        atDefaultZoom = currentZoom <= 1.001f,
                                    ) && controller.state.value.galleryViewer == photo) {
                                    controller.shiftGalleryViewer(if (dx < 0f) 1 else -1)
                                }
                                break
                            }
                        }
                    }
                }
                // TalkBack exposes the same real current-Owner navigation without
                // inventing extra iOS-foreign overlay arrows or media controls.
                .semantics {
                    // Native pinch remains unchanged. TalkBack/switch control
                    // now sees actual image state and equivalent local actions.
                    // Do not offer zoom until a real thumbnail/original renders.
                    if (stage is ImageStage.Ready)
                        stateDescription = galleryAccessibleZoomLabel(zoom)
                    customActions = buildList {
                        if (canGoOlder) add(CustomAccessibilityAction("上一项") {
                            controller.shiftGalleryViewer(-1)
                            true
                        })
                        if (canGoNewer) add(CustomAccessibilityAction("下一项") {
                            controller.shiftGalleryViewer(1)
                            true
                        })
                        if (stage is ImageStage.Ready) {
                            if (zoom < 4.999f) add(CustomAccessibilityAction("放大图片") {
                                zoom = galleryAccessibleZoomStep(zoom, 1)
                                pan = Offset.Zero
                                true
                            })
                            if (zoom > 1.001f) {
                                add(CustomAccessibilityAction("缩小图片") {
                                    zoom = galleryAccessibleZoomStep(zoom, -1)
                                    pan = Offset.Zero
                                    true
                                })
                                add(CustomAccessibilityAction("恢复图片大小") {
                                    zoom = 1f
                                    pan = Offset.Zero
                                    true
                                })
                            }
                        }
                    }
                },
            contentAlignment = Alignment.Center) {
            when (val current = stage) {
                ImageStage.Loading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(
                        color = Color.White, modifier = Modifier.testTag("gallery-photo-loading"))
                    if (originalProgress.first > 0L) Text(
                        "正在下载原图 · " + galleryByteLabel(
                            originalProgress.first, originalProgress.second),
                        modifier = Modifier.padding(top = 8.dp),
                        color = Color.White, style = MaterialTheme.typography.labelSmall,
                    )
                }
                ImageStage.Failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("原图无法预览", color = Color.White)
                    Text("请检查连接或图片格式；大于 32 MiB 的原图尚不支持分块预览。",
                        color = Color.LightGray, style = MaterialTheme.typography.bodySmall)
                    TextButton(
                        onClick = {
                            if (controller.state.value.galleryViewer == photo) retryNonce++
                        },
                        modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("gallery-photo-retry"),
                    ) {
                        Text("重试预览", color = Color.White)
                    }
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
                    if (current.upgrading && originalProgress.first > 0L) {
                        Text(
                            "正在下载原图 · " + galleryByteLabel(
                                originalProgress.first, originalProgress.second),
                            modifier = Modifier.align(Alignment.TopEnd).padding(10.dp)
                                .background(Color.Black.copy(alpha = 0.72f))
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                                .testTag("gallery-photo-original-progress"),
                            color = Color.White,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    } else if (current.upgrading) {
                        CircularProgressIndicator(
                            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)
                                .size(22.dp).testTag("gallery-photo-upgrading"),
                            color = Color.White, strokeWidth = 2.dp,
                        )
                    } else if (current.thumbnailOnly) {
                        Text(
                            if (photo.node.size > 32L * 1024 * 1024)
                                "仅显示缩略图 · 原图超过 32 MiB"
                            else "仅显示缩略图 · 原图暂不可预览",
                            modifier = Modifier.align(Alignment.BottomCenter)
                                .padding(bottom = 16.dp)
                                .background(Color.Black.copy(alpha = 0.72f))
                                .padding(horizontal = 12.dp, vertical = 7.dp)
                                .testTag("gallery-photo-fallback"),
                            color = Color.White,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
            if (photo.livePhoto) {
                GalleryLivePhotoMotion(
                    photo = photo,
                    controller = controller,
                    held = liveHeld,
                    stillReady = stage is ImageStage.Ready,
                )
            }
        }
    }
}

/** IEC-only label: the denominator is the actual body size when verified,
 * not the .livp outer ZIP length or a speculative original size. */
private fun galleryByteLabel(loaded: Long, total: Long?): String {
    val amount = maxOf(loaded, total ?: 0L)
    val unit = when {
        amount >= 1024L * 1024L * 1024L -> 1024L * 1024L * 1024L
        amount >= 1024L * 1024L -> 1024L * 1024L
        amount >= 1024L -> 1024L
        else -> 1L
    }
    val unitName = when (unit) {
        1024L * 1024L * 1024L -> "GiB"
        1024L * 1024L -> "MiB"
        1024L -> "KiB"
        else -> "B"
    }
    fun number(bytes: Long) = if (unit == 1L) bytes.toString()
        else String.format(Locale.ROOT, "%.1f", bytes.toDouble() / unit)
    return if (total != null && total > 0L)
        "${number(loaded)} / ${number(total)} $unitName"
    else "${number(loaded)} $unitName"
}
