package com.tfluid.xdrive

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.provider.MediaStore
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** ISO-6709 video location as exposed by Android's own metadata reader. */
internal fun nativeVideoGps(value: String?): Pair<Double, Double>? {
    val match = Regex("^([+-]\\d{2}(?:\\.\\d+)?)([+-]\\d{3}(?:\\.\\d+)?)(?:[+-]\\d+(?:\\.\\d+)?)?/$")
        .matchEntire(value ?: "") ?: return null
    val lat = match.groupValues[1].toDoubleOrNull() ?: return null
    val lon = match.groupValues[2].toDoubleOrNull() ?: return null
    return if (NativeLocalMapIndex.keyFor(lat, lon, 0) != null) lat to lon else null
}

/** Android 10+ redacts original EXIF location until the OS explicitly grants
 * ACCESS_MEDIA_LOCATION. No map coordinates are sent to a Server or SDK. */
internal suspend fun readLocalMediaGps(
    context: Context, asset: NativeLocalMedia,
): Pair<Double, Double>? = withContext(Dispatchers.IO) {
    currentCoroutineContext().ensureActive()
    try {
        val original = MediaStore.setRequireOriginal(asset.uri)
        if (asset.isVideo) {
            val reader = MediaMetadataRetriever()
            try {
                reader.setDataSource(context, original)
                nativeVideoGps(reader.extractMetadata(
                    MediaMetadataRetriever.METADATA_KEY_LOCATION))
            } finally { reader.release() }
        } else {
            context.contentResolver.openInputStream(original)?.use { stream ->
                val location = ExifInterface(stream).latLong
                location?.takeIf { it.size == 2 &&
                    NativeLocalMapIndex.keyFor(it[0], it[1], 0) != null }
                    ?.let { it[0] to it[1] }
            }
        }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (denied: SecurityException) {
        // A revoked Android media/location grant invalidates this scan.
        throw denied
    } catch (_: Exception) {
        // Corrupt EXIF or unsupported video metadata: not a located photo.
        null
    }
}

private data class NativeLocalPhotoMapScan(
    val index: NativeLocalMapIndex<NativeLocalMedia> = NativeLocalMapIndex(),
    val scanned: Int = 0,
    val finished: Boolean = false,
    val capped: Boolean = false,
    val error: String? = null,
    val scanning: Boolean = false,
)

/** The cloud and local map are two sources of ONE Gallery map route. */
@Composable
internal fun NativePhotoMapSourceBar(
    localSelected: Boolean, onLocal: () -> Unit, onCloud: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
        .testTag("native-photo-map-sources"),
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onLocal, enabled = !localSelected,
            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                .testTag("native-photo-map-source-local")) {
            Text(if (localSelected) "本机位置 ✓" else "本机位置")
        }
        TextButton(onClick = onCloud, enabled = localSelected,
            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                .testTag("native-photo-map-source-cloud")) {
            Text(if (localSelected) "云端 Owner" else "云端 Owner ✓")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ColumnScope.NativeLocalPhotoMap(
    sessionId: Long,
    libraryEpoch: Int,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val resolver = context.contentResolver
    var permissionEpoch by remember(sessionId, libraryEpoch) { mutableIntStateOf(0) }
    val hasMedia = nativePhotoAccess(context)
    val hasGps = context.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    val grant = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissionEpoch++ }
    var scanRequest by remember(sessionId, libraryEpoch, permissionEpoch) {
        mutableIntStateOf(1)
    }
    var scan by remember(sessionId, libraryEpoch, permissionEpoch) {
        mutableStateOf(NativeLocalPhotoMapScan())
    }
    var chosen by remember(sessionId, libraryEpoch, permissionEpoch) {
        mutableStateOf<NativeLocalMapCell<NativeLocalMedia>?>(null)
    }
    // Dispose the Android provider CancellationSignal synchronously when
    // leaving the map, switching Owner or changing media grants. Coroutine
    // cancellation alone cannot interrupt a blocked ContentResolver.query().
    val signal = remember(sessionId, libraryEpoch, permissionEpoch,
        scanRequest, hasMedia, hasGps) { CancellationSignal() }
    DisposableEffect(signal) { onDispose { signal.cancel() } }
    LaunchedEffect(signal, hasMedia, hasGps) {
        if (!hasMedia || !hasGps) return@LaunchedEffect
        scan = NativeLocalPhotoMapScan(scanning = true)
        chosen = null
        var index = NativeLocalMapIndex<NativeLocalMedia>()
        var scanned = 0
        var key: NativeLocalPageKey? = null
        var finished = false
        try {
            while (scanned < NativeLocalMediaStore.MAX_SCAN) {
                currentCoroutineContext().ensureActive()
                val page = NativeLocalMediaStore.pageAfter(
                    resolver, key, NativeLocalMediaStore.PHOTO_PAGE_SIZE,
                    cancellationSignal = signal)
                for (asset in page) {
                    currentCoroutineContext().ensureActive()
                    val gps = readLocalMediaGps(context, asset) ?: continue
                    index = index.append(gps.first, gps.second, asset)
                }
                scanned += page.size
                key = page.lastOrNull()?.pageKey ?: key
                finished = page.size < NativeLocalMediaStore.PHOTO_PAGE_SIZE
                scan = NativeLocalPhotoMapScan(
                    index = index, scanned = scanned, finished = finished,
                    scanning = !finished)
                if (finished) break
            }
            if (!finished) scan = scan.copy(capped = true, scanning = false)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: OperationCanceledException) {
            scan = NativeLocalPhotoMapScan(error = "位置扫描已取消，请重新进入地图。")
        } catch (_: SecurityException) {
            scan = NativeLocalPhotoMapScan(
                error = "照片或原始 GPS 权限已变化，请重新授权后扫描。")
        } catch (_: Exception) {
            scan = NativeLocalPhotoMapScan(
                error = "设备媒体索引或位置读取失败，请重试。")
        } finally {
            signal.cancel()
        }
    }

    if (!hasMedia || !hasGps) {
        Column(Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (!hasMedia) "本机照片读取权限尚未授予。"
                 else "Android 尚未允许读取原件中的拍摄地点。")
            Text("仅在选择本机照片地图时请求系统权限；当前账户的云端地图不受影响。",
                style = MaterialTheme.typography.bodySmall)
            Button(onClick = {
                grant.launch(if (!hasMedia) nativePhotoPermissions()
                    else arrayOf(Manifest.permission.ACCESS_MEDIA_LOCATION))
            }, modifier = Modifier.testTag("native-local-map-grant")) {
                Text(if (!hasMedia) "授权本机照片" else "授权照片 GPS")
            }
            TextButton(onClick = onClose) { Text("返回图库") }
        }
        return
    }

    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("已检查 " + scan.scanned + " 项 · 有定位 " +
            scan.index.locatedCount + " 项 · " + scan.index.cells.size +
            " 个位置区域", modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = { scanRequest++ }, enabled = !scan.scanning,
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("native-local-map-retry")) { Text("重新扫描") }
    }
    if (scan.scanning) {
        LinearProgressIndicator(Modifier.fillMaxWidth()
            .testTag("native-local-map-progress"))
    }
    if (scan.capped) Text("已达到 " + NativeLocalMediaStore.MAX_SCAN +
        " 项扫描上限；当前地图并非完整设备图库。",
        style = MaterialTheme.typography.bodySmall)
    if (scan.error != null) Text(scan.error.orEmpty(),
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("native-local-map-error"))
    Text("按本机照片位置适配 WGS84 视窗（无地图底图）。双指缩放和拖动；点击封面查看已扫描照片。",
        modifier = Modifier.padding(horizontal = 12.dp),
        style = MaterialTheme.typography.bodySmall)
    if (scan.index.cells.isEmpty() && !scan.scanning) {
        Text("当前已读取范围没有带有效 GPS 的照片。",
            modifier = Modifier.padding(16.dp).testTag("native-local-map-empty"))
    }
    NativeLocalPhotoMapCanvas(
        cells = scan.index.cells,
        selectable = !scan.scanning && scan.error == null,
        onSelect = { chosen = it },
    )

    chosen?.let { snapshot ->
        NativeLocalMapCellSheet(
            cell = snapshot,
            scanLimit = scan.scanned,
            sessionId = sessionId,
            libraryEpoch = libraryEpoch,
            onClose = { chosen = null },
        )
    }
}

@Composable
internal fun ColumnScope.NativeLocalPhotoMapCanvas(
    cells: List<NativeLocalMapCell<NativeLocalMedia>>,
    selectable: Boolean,
    onSelect: (NativeLocalMapCell<NativeLocalMedia>) -> Unit,
) {
    var zoom by remember { mutableFloatStateOf(1f) }
    var shift by remember { mutableStateOf(Offset.Zero) }
    // The source already holds at most 64 verified, streaming WGS84 cells.
    // Fit the smallest longitude arc, not [-180, 180]; a photo on each
    // side of the antimeridian must appear as neighbors in the native map.
    val camera = remember(cells) {
        nativeLocalMapViewport(cells.map { it.latitude to it.longitude })
    }
    val density = LocalDensity.current.density
    Column(Modifier.fillMaxWidth().weight(1f)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { zoom = (zoom / 1.6f).coerceAtLeast(1f) },
                modifier = Modifier.testTag("native-local-map-zoom-out")) { Text("－") }
            TextButton(onClick = { zoom = (zoom * 1.6f).coerceAtMost(24f) },
                modifier = Modifier.testTag("native-local-map-zoom-in")) { Text("＋") }
            TextButton(onClick = { zoom = 1f; shift = Offset.Zero },
                modifier = Modifier.testTag("native-local-map-fit")) { Text("适配照片") }
        }
        BoxWithConstraints(Modifier.fillMaxSize().background(
            MaterialTheme.colorScheme.surfaceContainerLow)
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, factor, _ ->
                    zoom = (zoom * factor).coerceIn(1f, 24f)
                    shift = Offset(
                        (shift.x + pan.x / density).coerceIn(-3000f, 3000f),
                        (shift.y + pan.y / density).coerceIn(-3000f, 3000f))
                }
            }.testTag("native-local-photo-map")) {
            val canvasWidth = maxWidth.value
            val canvasHeight = maxHeight.value
            Canvas(Modifier.fillMaxSize()) {
                val stroke = Color.Gray.copy(alpha = 0.2f)
                for (k in 1..5) {
                    val x = size.width * k / 6f
                    val y = size.height * k / 6f
                    drawLine(stroke, Offset(x, 0f), Offset(x, size.height))
                    drawLine(stroke, Offset(0f, y), Offset(size.width, y))
                }
            }
            for (cell in cells) {
                val point = camera?.position(
                    cell.latitude, cell.longitude,
                    canvasWidth, canvasHeight, zoom,
                    shift.x, shift.y,
                ) ?: continue
                val (x, y) = point
                if (x < 0f || x >= canvasWidth || y < 0f || y >= canvasHeight) continue
                Surface(
                    shape = RoundedCornerShape(9.dp),
                    color = MaterialTheme.colorScheme.surface,
                    shadowElevation = 3.dp,
                    modifier = Modifier.offset(
                        (x - 26f).coerceIn(0f, (canvasWidth - 56f).coerceAtLeast(0f)).dp,
                        (y - 26f).coerceIn(0f, (canvasHeight - 66f).coerceAtLeast(0f)).dp
                    ).size(width = 56.dp, height = 66.dp)
                        .clickable(enabled = selectable) { onSelect(cell) }
                        .testTag("native-local-map-cell-" +
                            cell.key.latitudeCell + "-" + cell.key.longitudeCell),
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        NativeLocalPhotoMapCover(cell.representative,
                            Modifier.size(52.dp))
                        Text(if (cell.count > 999) "999+" else cell.count.toString(),
                            style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeLocalPhotoMapCover(
    media: NativeLocalMedia, modifier: Modifier,
) {
    val resolver = LocalContext.current.contentResolver
    val signal = remember(media.uri) { CancellationSignal() }
    DisposableEffect(signal) { onDispose { signal.cancel() } }
    val thumbnail by produceState<ImageBitmap?>(null, media.uri) {
        value = withContext(Dispatchers.IO) {
            try {
                resolver.loadThumbnail(media.uri, Size(128, 128), signal).asImageBitmap()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { null }
        }
    }
    if (thumbnail != null) {
        Image(bitmap = thumbnail!!, contentDescription = "本机照片聚合封面",
            modifier = modifier, contentScale = ContentScale.Crop)
    } else Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center) {
        Text("照片", style = MaterialTheme.typography.labelSmall)
    }
}
