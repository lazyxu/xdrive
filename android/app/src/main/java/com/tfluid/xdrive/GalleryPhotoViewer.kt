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
import com.tfluid.xdrive.core.DriveNode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private sealed interface ImageStage {
    data object Loading : ImageStage
    data class Ready(val image: ImageBitmap, val thumbnailOnly: Boolean = false,
        val upgrading: Boolean = false, val sampledOriginal: Boolean = false) : ImageStage
    data object Failed : ImageStage
}

/** A failed original can be retried without discarding its decoded thumbnail.
 * Oversize/unsupported originals must not offer an ineffective retry. */
internal fun galleryOriginalFallbackRetryVisible(
    thumbnailOnly: Boolean, upgrading: Boolean, originalEligible: Boolean,
): Boolean = thumbnailOnly && !upgrading && originalEligible

internal fun galleryOriginalFailedRetryVisible(originalEligible: Boolean): Boolean =
    originalEligible

@Composable
internal fun GalleryPhotoFailureNotice(
    originalEligible: Boolean, originalSize: Long, onRetry: () -> Unit,
) {
    val oversized = !originalEligible && originalSize > 32L * 1024 * 1024
    Column(Modifier.testTag("gallery-photo-failure"),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (oversized) "原图超过 32 MiB，当前无法直接预览"
            else "原图无法预览", color = Color.White)
        Text(when {
            oversized -> "当前版本不支持该原件的分块预览；可在文件模块下载原件。"
            !originalEligible -> "当前媒体没有受支持的原图预览；重复请求无法改变此限制。"
            else -> "请检查连接或图片格式。"
        }, color = Color.LightGray, style = MaterialTheme.typography.bodySmall)
        if (galleryOriginalFailedRetryVisible(originalEligible)) {
            TextButton(
                onClick = onRetry,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-photo-retry"),
            ) { Text("重试预览", color = Color.White) }
        }
    }
}

/** Native sampled decode is not original-resolution display. The separate
 * 32 MiB Owner read bound remains in the Controller; never bypass it. */
internal fun galleryOriginalSampleSize(width: Int, height: Int): Int? {
    if (width !in 1..32768 || height !in 1..32768) return null
    var sample = 1
    while (maxOf(width, height) / sample > 4096) sample *= 2
    return sample
}

/** A sampled original is not an original-resolution image; labels must remain truthful. */
internal fun galleryViewerQualitySource(thumbnailOnly: Boolean, sampledOriginal: Boolean): String =
    when {
        thumbnailOnly -> "缩略图"
        sampledOriginal -> "原件 · 适屏采样"
        else -> "原件 · 原始分辨率"
    }

private data class GalleryDecodedOriginal(val bitmap: ImageBitmap, val sampled: Boolean)

private fun decodeGalleryOriginal(bytes: ByteArray): GalleryDecodedOriginal? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val sample = galleryOriginalSampleSize(bounds.outWidth, bounds.outHeight) ?: return null
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        ?.asImageBitmap() ?: return null
    return GalleryDecodedOriginal(bitmap, sampled = sample > 1)
}

/** Native Owner photo Viewer with bounded original decode and explicit
 * authenticated-thumbnail fallback; the fallback is not full-resolution.
 * Video and Live motion use their separate verified playback contracts. */
@Composable
internal fun GalleryPhotoViewer(
    photo: GalleryAsset, controller: DriveController,
    thumbnails: LruCache<String, ImageBitmap>,
    onDownload: ((DriveNode) -> Unit)? = null,
    canDownload: Boolean = false,
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
    val retryPreview: () -> Unit = {
        // This is an explicit, current-Viewer action, never an automatic retry.
        if (controller.state.value.galleryViewer == photo) {
            originalProgress = 0L to null
            retryNonce++
        }
    }
    val currentZoom by rememberUpdatedState(zoom)
    val swipeThreshold = with(LocalDensity.current) { 72.dp.toPx() }
    val canGoOlder = controller.galleryViewerCanShift(-1)
    val canGoNewer = controller.galleryViewerCanShift(1)
    val cacheKey = "${photo.node.id}:${photo.node.revision}"
    val cachedThumbnail = thumbnails.get(cacheKey)
    var qualityPanelVisible by remember(photo.node.id, photo.node.revision) {
        mutableStateOf(false)
    }
    var thumbnailDecoded by remember(photo.node.id, photo.node.revision) {
        mutableStateOf(cachedThumbnail != null)
    }
    var thumbnailBodyBytes by remember(photo.node.id, photo.node.revision) {
        mutableStateOf<Long?>(null)
    }
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
            var original: GalleryDecodedOriginal? = null
            var originalDone = !canReadOriginal
            var thumbnailDone = thumbnail != null || !photo.hasThumbnail
            fun publish() {
                value = when {
                    original != null -> ImageStage.Ready(
                        original!!.bitmap, sampledOriginal = original!!.sampled)
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
                    if (bytes != null) thumbnailBodyBytes = bytes.size.toLong()
                    if (bytes == null) null else withContext(Dispatchers.Default) {
                        decodeGalleryThumbnail(bytes)
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) { null }
                if (decoded != null) {
                    thumbnail = decoded
                    thumbnailDecoded = true
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
    val liveHoldAllowed = galleryLivePhotoHoldAllowed(
        photo.livePhoto, stage is ImageStage.Ready, zoom)
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
            if (onDownload != null) TextButton(
                onClick = {
                    if (canDownload && controller.state.value.galleryViewer == photo)
                        onDownload(photo.node)
                },
                enabled = canDownload,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("gallery-photo-save-original"),
            ) { Text("保存原件", color = Color.White) }
            TextButton(onClick = { controller.showGalleryInfo(photo) },
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-photo-info")) {
                Text("信息", color = Color.White)
            }
        }
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-photo-gesture")
                .galleryLivePhotoHold(
                    enabled = liveHoldAllowed,
                    sourceIdentity = "${photo.node.id}:${photo.node.revision}",
                ) { pressed ->
                    if (pressed && liveHoldAllowed) liveSwipeFence.liveHoldActivated()
                    liveHeld = pressed && liveHoldAllowed
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
                                liveHeld = false
                                zoom = galleryAccessibleZoomStep(zoom, 1)
                                pan = Offset.Zero
                                true
                            })
                            if (zoom > 1.001f) {
                                add(CustomAccessibilityAction("缩小图片") {
                                    liveHeld = false
                                    zoom = galleryAccessibleZoomStep(zoom, -1)
                                    pan = Offset.Zero
                                    true
                                })
                                add(CustomAccessibilityAction("恢复图片大小") {
                                    liveHeld = false
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
                ImageStage.Failed -> GalleryPhotoFailureNotice(
                    originalEligible = canReadOriginal,
                    originalSize = photo.node.size,
                    onRetry = retryPreview,
                )
                is ImageStage.Ready -> {
                    val maxX = constraints.maxWidth.toFloat()
                    val maxY = constraints.maxHeight.toFloat()
                    val gesture = rememberTransformableState { change, drag, _ ->
                        val next = (zoom * change).coerceIn(1f, 5f)
                        if (next > 1.001f) liveHeld = false
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
                                    liveHeld = false
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
                    } else if (current.sampledOriginal) {
                        Text("原图已读取 · 当前为适屏采样预览，非完整原始分辨率",
                            modifier = Modifier.align(Alignment.BottomCenter)
                                .padding(bottom = 16.dp)
                                .background(Color.Black.copy(alpha = 0.72f))
                                .padding(horizontal = 12.dp, vertical = 7.dp)
                                .testTag("gallery-photo-sampled-original"),
                            color = Color.White,
                            style = MaterialTheme.typography.labelMedium)
                    } else if (current.thumbnailOnly) {
                        Column(
                            modifier = Modifier.align(Alignment.BottomCenter)
                                .padding(bottom = 16.dp)
                                .background(Color.Black.copy(alpha = 0.72f))
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                if (canReadOriginal) "仅显示缩略图 · 原图暂不可预览"
                                else if (photo.node.size > 32L * 1024 * 1024)
                                    "仅显示缩略图 · 原图超过 32 MiB"
                                else "仅显示缩略图 · 原图当前不支持预览",
                                modifier = Modifier.testTag("gallery-photo-fallback"),
                                color = Color.White,
                                style = MaterialTheme.typography.labelMedium,
                            )
                            if (galleryOriginalFallbackRetryVisible(
                                    current.thumbnailOnly, current.upgrading, canReadOriginal)) {
                                TextButton(
                                    onClick = retryPreview,
                                    modifier = Modifier.heightIn(min = 48.dp)
                                        .testTag("gallery-photo-original-retry"),
                                ) { Text("重试原图", color = Color.White) }
                            }
                        }
                    }
                }
            }

            // This is only a foreground Viewer overlay. Never download files
            // just to populate technical details, and never label bitmap
            // sampling as original-resolution display.
            val readyImage = stage as? ImageStage.Ready
            if (readyImage != null) {
                Column(
                    Modifier.align(Alignment.TopStart).padding(10.dp)
                        .background(Color.Black.copy(alpha = 0.80f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    TextButton(
                        onClick = { qualityPanelVisible = !qualityPanelVisible },
                        modifier = Modifier.testTag("gallery-viewer-quality-toggle"),
                    ) {
                        Text(
                            "画质：" + galleryViewerQualitySource(
                                readyImage.thumbnailOnly, readyImage.sampledOriginal),
                            color = Color.White, style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    if (qualityPanelVisible) {
                        Text(
                            "当前已解码：" + readyImage.image.width + " × " +
                                readyImage.image.height,
                            color = Color.White, style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.testTag("gallery-viewer-quality-dimensions"),
                        )
                        Text(
                            (if (photo.node.name.endsWith(".livp", ignoreCase = true))
                                "LIVP 容器" else "原件") + "：" +
                                galleryByteLabel(photo.node.size, null),
                            color = Color.LightGray, style = MaterialTheme.typography.labelSmall,
                        )
                        Text(
                            "缩略图：" + (if (thumbnailDecoded) "已解码" else "未解码") +
                                " · " + (thumbnailBodyBytes?.let { galleryByteLabel(it, null) }
                                    ?: "传输大小未知"),
                            color = Color.LightGray, style = MaterialTheme.typography.labelSmall,
                        )
                        Text(
                            "静态原件：" + when {
                                readyImage.thumbnailOnly && readyImage.upgrading -> "加载中"
                                readyImage.thumbnailOnly -> "当前未显示"
                                readyImage.sampledOriginal -> "已读入内存并采样解码"
                                else -> "已读入内存并解码"
                            } +
                                if (originalProgress.first > 0L)
                                    " · " + galleryByteLabel(
                                        originalProgress.first, originalProgress.second)
                                else "",
                            color = Color.LightGray, style = MaterialTheme.typography.labelSmall,
                        )
                        if (photo.livePhoto) Text(
                            "实况动态：长按后按需缓冲，不代表已完整下载",
                            color = Color.LightGray, style = MaterialTheme.typography.labelSmall,
                        )
                        Text(
                            "读取到本次会话内存，不等于已保存到设备磁盘。",
                            color = Color.LightGray, style = MaterialTheme.typography.labelSmall,
                        )
                    }
                }
            }
            if (photo.livePhoto) {
                GalleryLivePhotoMotion(
                    photo = photo,
                    controller = controller,
                    held = liveHeld && liveHoldAllowed,
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
