package com.tfluid.xdrive

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.DriveNode
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Only this app's private cache, never public storage or a persistent Owner
 * library. Once per process, clean stale PDFs left by an interrupted process.
 * Current viewers are not swept on every screen navigation. */
private object PdfTemporary {
    private var swept = false
    @Synchronized fun newFile(context: Context): File {
        val dir = File(context.cacheDir, "owner-native-pdf")
        if (!dir.isDirectory && !dir.mkdirs())
            throw IOException("Private PDF directory unavailable")
        if (!swept) {
            dir.listFiles()?.filter { it.isFile && it.name.startsWith("preview-") &&
                it.name.endsWith(".pdf") }?.forEach { it.delete() }
            swept = true
        }
        return File.createTempFile("preview-", ".pdf", dir)
    }
}

/** PdfRenderer has a single-current-page contract. Serialize rendering and
 * closing; never leave an open Page when returning to Files. Keep a maximum
 * 4M decoded pixels regardless of pathological PDF page dimensions. */
private class PdfLease(
    private val file: File,
    private val descriptor: ParcelFileDescriptor,
    private val renderer: PdfRenderer,
) : Closeable {
    private var closed = false
    val pageCount: Int = renderer.pageCount
    @Synchronized fun render(index: Int): ImageBitmap {
        check(!closed && index in 0 until pageCount)
        renderer.openPage(index).use { page ->
            val w = page.width.coerceAtLeast(1)
            val h = page.height.coerceAtLeast(1)
            val scale = minOf(
                3.0,
                2048.0 / w.toDouble(),
                2048.0 / h.toDouble(),
                sqrt(4_000_000.0 / (w.toDouble() * h.toDouble())),
            )
            val width = (w * scale).roundToInt().coerceIn(1, 2048)
            val height = (h * scale).roundToInt().coerceIn(1, 2048)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(AndroidColor.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                return bitmap.asImageBitmap()
            } catch (failure: Throwable) {
                bitmap.recycle()
                throw failure
            }
        }
    }
    @Synchronized override fun close() {
        if (closed) return
        closed = true
        try { renderer.close() }
        finally {
            try { descriptor.close() }
            finally { file.delete() }
        }
    }
    companion object {
        fun open(file: File): PdfLease {
            val descriptor = ParcelFileDescriptor.open(
                file, ParcelFileDescriptor.MODE_READ_ONLY)
            try {
                val renderer = PdfRenderer(descriptor)
                if (renderer.pageCount <= 0) {
                    renderer.close()
                    throw IOException("No PDF pages")
                }
                return PdfLease(file, descriptor, renderer)
            } catch (failure: Throwable) {
                // A broken PDF or OEM PdfRenderer may also throw while its
                // descriptor is closed. Preserve the original failure and
                // always remove the Owner's private temporary file.
                try { descriptor.close() }
                catch (closeFailure: Throwable) { failure.addSuppressed(closeFailure) }
                finally { file.delete() }
                throw failure
            }
        }
    }
}

/** DisposableEffect always closes this holder even if a new Compose session
 * has not yet been drawn after the IO result was handed off. */
private class PdfHolder : Closeable {
    var current: PdfLease? = null
        private set
    fun replace(next: PdfLease?) {
        val prior = current
        current = next
        if (prior !== next) prior?.close()
    }
    override fun close() { replace(null) }
}

/** A PDF preview is an explicitly disposable foreground read, not a
 * durable download/backup. STARTED includes the visible foreground Activity;
 * CREATED/STOPPED/DESTROYED must not begin or continue private media work. */
internal fun nativePdfForegroundPermitted(state: Lifecycle.State): Boolean =
    state.isAtLeast(Lifecycle.State.STARTED)

/** A complete native Files PDF Viewer with bounded verified stream, lazy
 * single-page render, zoom/pan, previous/next, and original Files return. */
@Composable
internal fun NativeFilesPdfViewer(
    node: DriveNode,
    controller: DriveController,
    receivedBytes: Long,
) {
    val context = LocalContext.current.applicationContext
    val lifecycleOwner = LocalLifecycleOwner.current
    val holder = remember(node.id, node.revision) { PdfHolder() }
    var lease by remember(node.id, node.revision) { mutableStateOf<PdfLease?>(null) }
    var retry by remember(node.id, node.revision) { mutableIntStateOf(0) }
    var error by remember(node.id, node.revision) { mutableStateOf<String?>(null) }
    var pageIndex by remember(node.id, node.revision) { mutableIntStateOf(0) }
    var drawing by remember(node.id, node.revision) { mutableStateOf(false) }
    var bitmap by remember(node.id, node.revision) { mutableStateOf<ImageBitmap?>(null) }
    var zoom by remember(node.id, node.revision) { mutableFloatStateOf(1f) }
    var pan by remember(node.id, node.revision) { mutableStateOf(Offset.Zero) }

    DisposableEffect(holder) {
        onDispose { holder.close() }
    }
    // The native Viewer is a disposable GET/renderer. When Activity STOPs,
    // repeatOnLifecycle cancels the Owner download and releases the private
    // temp file. START starts one fresh *verified* read; no old Owner URI,
    // token or PdfRenderer lease is kept alive in the background.
    LaunchedEffect(controller, node.id, node.revision, retry, lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (!nativePdfForegroundPermitted(
                    lifecycleOwner.lifecycle.currentState)) return@repeatOnLifecycle
            var temporary: File? = null
            var created: PdfLease? = null
            error = null
            lease = null
            bitmap = null
            holder.replace(null)
            try {
                // NonCancellable is limited to allocation/cleanup of local
                // ownership resources. The authenticated network download
                // below remains fully cancellable at Activity STOP.
                temporary = withContext(NonCancellable + Dispatchers.IO) {
                    PdfTemporary.newFile(context)
                }
                currentCoroutineContext().ensureActive()
                val output = temporary
                controller.downloadFilesPdf(node) {
                    FileOutputStream(requireNotNull(output))
                }
                currentCoroutineContext().ensureActive()
                created = withContext(NonCancellable + Dispatchers.IO) {
                    PdfLease.open(requireNotNull(temporary))
                }
                currentCoroutineContext().ensureActive()
                if (controller.state.value.filesPdfViewer != node)
                    throw CancellationException()
                holder.replace(created)
                lease = created
                created = null
                temporary = null
                // Keep this lifecycle child alive to own the verified
                // renderer, and guarantee close on STOP/Owner change/retry.
                awaitCancellation()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                error = if (node.size > 64L * 1024 * 1024)
                    "PDF 超过 64 MiB 的原生预览上限，请使用保存到设备。"
                else "无法预览此 PDF，可能是网络、文件版本、损坏或密码保护导致。"
            } finally {
                // Remove this exact bitmap/lease before a new foreground
                // session can load a different version of the same file.
                lease = null
                bitmap = null
                drawing = false
                withContext(NonCancellable + Dispatchers.IO) {
                    try { created?.close() }
                    finally {
                        try { temporary?.delete() }
                        finally {
                            // The PdfLease serializes close vs. page render.
                            // A vendor close error must not suppress cleanup.
                            runCatching { holder.close() }
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(lease, pageIndex, lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (!nativePdfForegroundPermitted(
                    lifecycleOwner.lifecycle.currentState)) return@repeatOnLifecycle
            val doc = lease ?: return@repeatOnLifecycle
            if (pageIndex !in 0 until doc.pageCount) return@repeatOnLifecycle
            bitmap = null
            drawing = true
            error = null
            zoom = 1f
            pan = Offset.Zero
            try {
                val image = withContext(Dispatchers.IO) { doc.render(pageIndex) }
                if (holder.current === doc &&
                    controller.state.value.filesPdfViewer == node) bitmap = image
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (holder.current === doc)
                    error = "PDF 第 ${pageIndex + 1} 页无法渲染。"
            } finally {
                drawing = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().background(Color.Black).testTag("files-pdf-viewer"),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = controller::dismissFilesPdfViewer,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("files-pdf-close")) { Text("返回", color = Color.White) }
            Text(node.name, modifier = Modifier.weight(1f),
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = Color.White, style = MaterialTheme.typography.titleMedium)
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(),
            contentAlignment = Alignment.Center) {
            val shown = bitmap
            val gesture = rememberTransformableState { scale, drag, _ ->
                val next = (zoom * scale).coerceIn(1f, 4f)
                zoom = next
                pan = if (next == 1f) Offset.Zero else {
                    val dx = constraints.maxWidth * (next - 1f) / 2f
                    val dy = constraints.maxHeight * (next - 1f) / 2f
                    Offset((pan.x + drag.x).coerceIn(-dx, dx),
                        (pan.y + drag.y).coerceIn(-dy, dy))
                }
            }
            val decodedDoc = lease
            if (shown != null && decodedDoc != null) {
                Image(
                    bitmap = shown, contentDescription = "PDF 第 ${pageIndex + 1} 页",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize()
                        .graphicsLayer {
                            scaleX = zoom; scaleY = zoom
                            translationX = pan.x; translationY = pan.y
                        }
                        .transformable(gesture)
                        .pointerInput(pageIndex) {
                            detectTapGestures(onDoubleTap = {
                                zoom = if (zoom > 1f) 1f else 2f
                                pan = Offset.Zero
                            })
                        }
                        .nativePdfZoomAccessibility(
                            pageIndex = pageIndex,
                            pageCount = decodedDoc.pageCount,
                            zoom = zoom,
                            onZoomTo = { newZoom ->
                                zoom = newZoom
                                // A switch/TalkBack zoom jump must never strand
                                // an invisible PDF page offscreen from old pan.
                                pan = Offset.Zero
                            },
                        )
                        .testTag("files-pdf-page-ready"),
                )
            } else if (error == null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color.White,
                        modifier = Modifier.testTag("files-pdf-loading"))
                    Text(
                        if (lease == null)
                            "正在验证并读取 PDF：${formatSize(receivedBytes)} / ${formatSize(node.size)}"
                        else if (drawing) "正在渲染第 ${pageIndex + 1} 页…"
                        else "正在准备 PDF 页面…",
                        color = Color.White,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
            if (error != null) {
                Column(
                    Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(requireNotNull(error), color = Color.White,
                        modifier = Modifier.testTag("files-pdf-error"))
                    if (lease == null) TextButton(
                        onClick = { retry++ },
                        modifier = Modifier.heightIn(min = 48.dp).testTag("files-pdf-retry"),
                    ) { Text("重试预览", color = Color.White) }
                }
            }
        }
        val document = lease
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { pageIndex-- },
                enabled = document != null && pageIndex > 0,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("files-pdf-previous")) { Text("上一页") }
            Text(
                if (document == null) "PDF"
                else "${pageIndex + 1} / ${document.pageCount}",
                color = Color.White,
                modifier = Modifier.testTag("files-pdf-page-count"),
                style = MaterialTheme.typography.bodyMedium,
            )
            TextButton(onClick = { pageIndex++ },
                enabled = document != null && pageIndex < document.pageCount - 1,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("files-pdf-next")) { Text("下一页") }
        }
    }
}
