package com.tfluid.xdrive

import android.content.Context
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.provider.MediaStore
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Only metadata from the currently authorized single native MediaStore URI.
 * No original bytes, EXIF GPS, cloud photo, thumbnail or device-wide scan.
 */
internal data class NativeLocalMediaInfo(
    val name: String? = null,
    val mime: String? = null,
    val bytes: Long? = null,
    val width: Int? = null,
    val height: Int? = null,
    val takenAtMillis: Long? = null,
    val durationMillis: Long? = null,
)

/** Exact single-item read. An OEM may omit optional columns; never guess. */
internal suspend fun readNativeLocalMediaInfo(
    context: Context,
    asset: NativeLocalMedia,
    signal: CancellationSignal,
): NativeLocalMediaInfo = withContext(Dispatchers.IO) {
    signal.throwIfCanceled()
    require(nativeLocalPhotoShareEligible(asset)) {
        "Native local media identity must be an exact authorized MediaStore URI"
    }
    val projection = listOf(
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.MIME_TYPE,
        MediaStore.MediaColumns.SIZE,
        MediaStore.MediaColumns.WIDTH,
        MediaStore.MediaColumns.HEIGHT,
        MediaStore.MediaColumns.DATE_TAKEN,
    ).let { if (asset.isVideo) it + MediaStore.Video.VideoColumns.DURATION else it }
        .toTypedArray()
    context.contentResolver.query(asset.uri, projection, null, null, null, signal)
        ?.use { cursor ->
            signal.throwIfCanceled()
            if (!cursor.moveToFirst()) throw IllegalStateException("Media item missing")
            fun string(column: String): String? {
                val i = cursor.getColumnIndex(column)
                return if (i < 0 || cursor.isNull(i)) null else cursor.getString(i)
            }
            fun long(column: String): Long? {
                val i = cursor.getColumnIndex(column)
                return if (i < 0 || cursor.isNull(i)) null else cursor.getLong(i)
            }
            val result = NativeLocalMediaInfo(
                name = string(MediaStore.MediaColumns.DISPLAY_NAME),
                mime = string(MediaStore.MediaColumns.MIME_TYPE),
                bytes = long(MediaStore.MediaColumns.SIZE),
                width = long(MediaStore.MediaColumns.WIDTH)
                    ?.takeIf { it in 1..100_000 }?.toInt(),
                height = long(MediaStore.MediaColumns.HEIGHT)
                    ?.takeIf { it in 1..100_000 }?.toInt(),
                takenAtMillis = long(MediaStore.MediaColumns.DATE_TAKEN),
                durationMillis = if (asset.isVideo)
                    long(MediaStore.Video.VideoColumns.DURATION) else null,
            )
            signal.throwIfCanceled()
            result
        } ?: throw IllegalStateException("Media metadata unavailable")
}

/** A missing DATE_TAKEN is not reconstructed from DATE_ADDED: they carry
 * different semantics. The returned display rows contain no private ID/URI.
 */
internal fun nativeLocalMediaInfoRows(
    info: NativeLocalMediaInfo,
    isVideo: Boolean,
    albumName: String,
    addedAtSeconds: Long,
    zone: ZoneId = ZoneId.systemDefault(),
): List<Pair<String, String>> {
    val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ROOT)
    fun dateFromMillis(ms: Long?): String? = if (ms == null || ms <= 0L) null else
        runCatching { Instant.ofEpochMilli(ms).atZone(zone).format(formatter) }
            .getOrNull()
    val name = info.name?.trim()?.take(180)?.takeIf {
        it.isNotEmpty() && it.none { c -> c.isISOControl() }
    } ?: "未记录"
    // A MIME type must contain one valid type/subtype, not merely become
    // printable after trimming control bytes (e.g. "\\ntext" -> "text").
    val mime = info.mime?.takeIf {
        it.length in 3..100 &&
            it.matches(Regex("[A-Za-z0-9!#    val mime = info.mime?.trim()?.take(100)?.takeIf {
        it.isNotEmpty() && it.none { c -> c.isISOControl() }
    } ?: "未知"^_.+-]+/[A-Za-z0-9!#    val mime = info.mime?.trim()?.take(100)?.takeIf {
        it.isNotEmpty() && it.none { c -> c.isISOControl() }
    } ?: "未知"^_.+-]+"))
    } ?: "未知"
    val dimensions = if (info.width != null && info.width in 1..100_000 &&
        info.height != null && info.height in 1..100_000)
        "${info.width} × ${info.height} 像素" else "未知"
    return buildList {
        add("名称" to name)
        add("类型" to (if (isVideo) "视频" else "照片"))
        add("格式" to mime)
        add("拍摄时间" to (dateFromMillis(info.takenAtMillis) ?: "未记录"))
        add("加入时间" to (addedAtSeconds.takeIf { it > 0L }?.let {
            dateFromMillis(it * 1000L)
        } ?: "未记录"))
        add("尺寸" to dimensions)
        add("文件大小" to (info.bytes?.takeIf { it >= 0L }?.let {
            "${it} 字节"
        } ?: "未知"))
        if (isVideo) add("视频时长" to (info.durationMillis
            ?.takeIf { it >= 0L }
            ?.let { "${it / 60000} 分 ${(it % 60000) / 1000} 秒" } ?: "未知"))
        add("相册" to albumName.take(180).ifBlank { "未知" })
    }
}

private sealed interface NativeLocalMediaInfoRead {
    data object Loading : NativeLocalMediaInfoRead
    data class Ready(val details: NativeLocalMediaInfo) : NativeLocalMediaInfoRead
    data object Failed : NativeLocalMediaInfoRead
}

/** One explicit Info tap; every new item/retry gets a fresh cancellable query.
 * Retain no metadata across account, Viewer or media-authorization changes.
 */
@Composable
internal fun NativeLocalMediaInfoAction(
    asset: NativeLocalMedia,
    reader: suspend (Context, NativeLocalMedia, CancellationSignal) ->
        NativeLocalMediaInfo = ::readNativeLocalMediaInfo,
) {
    val mediaKey = asset.viewerReturnKey()
    val context = LocalContext.current
    var expanded by remember(mediaKey, asset.uri) { mutableStateOf(false) }
    TextButton(
        onClick = { expanded = true },
        enabled = nativeLocalPhotoShareEligible(asset),
        modifier = Modifier.heightIn(min = 48.dp)
            .testTag("native-local-viewer-info"),
    ) { Text("信息") }
    if (!expanded) return

    var retry by remember(mediaKey, asset.uri) { mutableIntStateOf(0) }
    val signal = remember(mediaKey, asset.uri, retry) { CancellationSignal() }
    DisposableEffect(signal) { onDispose { signal.cancel() } }
    val loaded by produceState<NativeLocalMediaInfoRead>(
        NativeLocalMediaInfoRead.Loading, mediaKey, asset.uri, signal
    ) {
        value = try {
            NativeLocalMediaInfoRead.Ready(reader(context, asset, signal))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: OperationCanceledException) {
            NativeLocalMediaInfoRead.Failed
        } catch (_: Exception) {
            NativeLocalMediaInfoRead.Failed
        }
    }
    AlertDialog(
        onDismissRequest = { expanded = false },
        title = { Text("本机媒体信息") },
        text = {
            Column(
                Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())
                    .testTag("native-local-info-content"),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (val current = loaded) {
                    NativeLocalMediaInfoRead.Loading ->
                        CircularProgressIndicator(
                            modifier = Modifier.testTag("native-local-info-loading"))
                    NativeLocalMediaInfoRead.Failed -> {
                        Text("当前媒体信息读取失败；权限可能已变化，照片仍保持原样。",
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag("native-local-info-error"))
                        TextButton(onClick = { retry++ },
                            modifier = Modifier.testTag("native-local-info-retry")
                                .heightIn(min = 48.dp)) { Text("重试信息") }
                    }
                    is NativeLocalMediaInfoRead.Ready -> {
                        val rows = nativeLocalMediaInfoRows(
                            current.details, asset.isVideo, asset.albumName,
                            asset.addedAtSeconds)
                        rows.forEach { (label, value) ->
                            Row(Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(label, style = MaterialTheme.typography.bodySmall)
                                Text(value, style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.testTag(
                                        "native-local-info-" + when (label) {
                                            "拍摄时间" -> "taken"
                                            "加入时间" -> "added"
                                            "尺寸" -> "dimensions"
                                            "视频时长" -> "duration"
                                            else -> label
                                        }))
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { expanded = false },
                modifier = Modifier.testTag("native-local-info-close")
                    .heightIn(min = 48.dp)) { Text("关闭") }
        },
        modifier = Modifier.testTag("native-local-info-dialog"),
    )
}
