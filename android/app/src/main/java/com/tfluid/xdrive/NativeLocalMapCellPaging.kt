package com.tfluid.xdrive

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.CancellationSignal
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Only keyset anchors (not every photo ID) survive between 48-item pages. */
internal data class NativeLocalMapReadCursor(
    val after: NativeLocalPageKey? = null,
    val scanned: Int = 0,
    val matched: Int = 0,
)

internal data class NativeLocalMapReadPage(
    val members: List<NativeLocalMedia>,
    val next: NativeLocalMapReadCursor,
    val hasMore: Boolean,
)

/** A full-keyset scan is deliberately bounded to the *same* originally
 * indexed prefix. Never ask a cell to page through newer unverified media. */
internal fun nativeLocalMapHasMore(
    matched: Int, knownCount: Int, scanned: Int, scanLimit: Int,
    providerExhausted: Boolean,
): Boolean = !providerExhausted && matched < knownCount && scanned < scanLimit

/** A truncated final batch still has unread rows if the 48th match
 * was found before the last row. The next keyset cursor starts there. */
internal fun nativeLocalMapBatchExhausted(
    returned: Int, requested: Int, consumed: Int,
): Boolean = returned < requested && consumed == returned

internal suspend fun readNativeLocalMapCellPage(
    context: Context,
    cell: NativeLocalMapCell<NativeLocalMedia>,
    scanLimit: Int,
    start: NativeLocalMapReadCursor,
    signal: CancellationSignal,
): NativeLocalMapReadPage {
    require(scanLimit in 1..NativeLocalMediaStore.MAX_SCAN)
    require(start.scanned in 0..scanLimit)
    require(start.matched in 0..cell.count)
    require(cell.count > 0 && cell.key.level in 0..14)
    if (context.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) !=
            PackageManager.PERMISSION_GRANTED || !nativePhotoAccess(context)) {
        throw SecurityException("native photo map location grant revoked")
    }

    val found = ArrayList<NativeLocalMedia>(NativeLocalMapIndex.MAX_PREVIEW_ITEMS)
    var after = start.after
    var scanned = start.scanned
    var exhausted = false
    while (scanned < scanLimit && found.size < NativeLocalMapIndex.MAX_PREVIEW_ITEMS) {
        currentCoroutineContext().ensureActive()
        signal.throwIfCanceled()
        val limit = minOf(NativeLocalMediaStore.PHOTO_PAGE_SIZE, scanLimit - scanned)
        val batch = NativeLocalMediaStore.pageAfter(
            context.contentResolver, after, limit,
            cancellationSignal = signal)
        if (batch.isEmpty()) {
            exhausted = true
            break
        }
        var consumed = 0
        for (asset in batch) {
            consumed++
            currentCoroutineContext().ensureActive()
            signal.throwIfCanceled()
            scanned++
            after = asset.pageKey
            val gps = readLocalMediaGps(context, asset) ?: continue
            if (NativeLocalMapIndex.keyFor(gps.first, gps.second, cell.key.level) == cell.key) {
                found += asset
                if (found.size == NativeLocalMapIndex.MAX_PREVIEW_ITEMS) break
            }
        }
        // A short final provider batch is NOT exhausted if the 48th match
        // stopped before consuming every row returned in that same batch.
        if (nativeLocalMapBatchExhausted(batch.size, limit, consumed))
            exhausted = true
        if (exhausted) break
    }
    val matched = start.matched + found.size
    check(matched <= cell.count) { "Native photo-map cell membership changed" }
    return NativeLocalMapReadPage(
        found, NativeLocalMapReadCursor(after, scanned, matched),
        nativeLocalMapHasMore(matched, cell.count, scanned, scanLimit, exhausted),
    )
}

/** One real local spatial cell, re-reading its exact WGS84 cell by keyset.
 * At most ten opaque page anchors are retained, never all 100k media URIs. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeLocalMapCellSheet(
    cell: NativeLocalMapCell<NativeLocalMedia>,
    scanLimit: Int,
    sessionId: Long,
    libraryEpoch: Int,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val anchors = remember(cell.key, sessionId, libraryEpoch) {
        mutableStateListOf(NativeLocalMapReadCursor())
    }
    var position by remember(cell.key, sessionId, libraryEpoch) { mutableIntStateOf(0) }
    var ordinal by remember(cell.key, sessionId, libraryEpoch) { mutableIntStateOf(1) }
    var viewer by remember(cell.key, sessionId, libraryEpoch) {
        mutableStateOf<NativeLocalMedia?>(null)
    }
    val signal = remember(cell.key, position, sessionId, libraryEpoch) {
        CancellationSignal()
    }
    DisposableEffect(signal) { onDispose { signal.cancel() } }
    var page by remember(cell.key, position, sessionId, libraryEpoch) {
        mutableStateOf<NativeLocalMapReadPage?>(null)
    }
    var busy by remember(cell.key, position, sessionId, libraryEpoch) {
        mutableStateOf(true)
    }
    var error by remember(cell.key, position, sessionId, libraryEpoch) {
        mutableStateOf<String?>(null)
    }
    var retry by remember(cell.key, position, sessionId, libraryEpoch) {
        mutableIntStateOf(0)
    }
    LaunchedEffect(signal, retry) {
        busy = true
        error = null
        viewer = null
        try {
            val result = readNativeLocalMapCellPage(
                context, cell, scanLimit, anchors[position], signal)
            currentCoroutineContext().ensureActive()
            page = result
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: SecurityException) {
            page = null
            error = "本机照片或原件位置权限已变化，请返回地图刷新。"
        } catch (_: Exception) {
            page = null
            error = "当前 GPS 区域读取失败；可以重试，或返回地图刷新。"
        } finally {
            busy = false
        }
    }
    // The first 48 image covers are already verified by the foreground map
    // scan; display them only while the reauthorizing first Range is pending.
    val members = page?.members ?: if (position == 0 && busy) cell.members else emptyList()
    ModalBottomSheet(
        onDismissRequest = { if (viewer == null) onClose() },
        modifier = Modifier.testTag("native-local-map-cell-sheet"),
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.85f)) {
            Text("本机同一 GPS 区域 · 已扫描 " + cell.count +
                " 张 · 第 " + ordinal + " 批",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            Text("每批最多 48 张；仅扫描当前已索引的本机媒体范围，不包含未授权照片。",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp))
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()
                .testTag("native-local-map-page-progress"))
            if (error != null) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(12.dp).testTag("native-local-map-page-error"))
                TextButton(onClick = { retry++ },
                    modifier = Modifier.testTag("native-local-map-page-retry")) {
                    Text("重新读取此批")
                }
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(96.dp),
                modifier = Modifier.weight(1f).testTag("native-local-map-cell-wall"),
                contentPadding = PaddingValues(8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(members, key = { it.id }) { asset ->
                    NativeLocalPhotoWallTile(
                        asset = asset, restoreFocus = false,
                        onOpen = { if (!busy && error == null) viewer = asset },
                        onFocusRestored = {},
                    )
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(
                    onClick = { position--; ordinal-- },
                    enabled = position > 0 && !busy,
                    modifier = Modifier.testTag("native-local-map-page-previous"),
                ) { Text("上一批") }
                TextButton(
                    onClick = {
                        val next = page?.next ?: return@TextButton
                        if (anchors.size > position + 1) {
                            // An existing later-page anchor was already verified.
                            position++
                        } else {
                            anchors.add(next)
                            if (anchors.size > 10) anchors.removeAt(0)
                            position = anchors.lastIndex
                        }
                        ordinal++
                    },
                    enabled = page?.hasMore == true && !busy,
                    modifier = Modifier.testTag("native-local-map-page-next"),
                ) { Text("下一批") }
            }
        }
    }
    viewer?.let { asset ->
        val index = members.indexOfFirst { it.id == asset.id }
        NativeLocalMediaViewer(
            asset = asset,
            loadedPosition = index.takeIf { it >= 0 },
            loadedCount = members.size,
            onDismiss = { viewer = null },
            onPrevious = if (index > 0) ({ viewer = members[index - 1] }) else null,
            onNext = if (index in 0 until members.lastIndex) ({
                viewer = members[index + 1]
            }) else null,
        )
    }
}
