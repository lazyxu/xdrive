package com.tfluid.xdrive

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.OwnerBd09MapCells
import com.tfluid.xdrive.core.OwnerMapOverview
import com.tfluid.xdrive.core.OwnerMapSample
import java.util.Locale

/** WGS84 preview of real Owner GPS samples. Never show unverified Baidu tiles
 * or silently claim this geographic distribution is the iOS SDK map. */
@Composable
internal fun ColumnScope.GalleryMapOverview(
    state: DriveState, controller: DriveController,
) {
    val overview = state.galleryMapOverview
    val bd09Cells = state.galleryBd09Cells
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("地点", style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(
                onClick = controller::closeGalleryMapOverview,
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-map-close"),
            ) { Text("返回图库") }
        }
        Text(if (state.galleryBd09Requested)
            "BD-09LL 数据来自当前 Owner 的已验证 8×8 网格；这里不是百度地图底图，地点照片联动仍需原生 SDK。"
            else "仅显示当前账户的真实 WGS84 GPS 代表点；百度地图底图和地点照片联动尚未接入。",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("gallery-map-unavailable-basemap"))
        if (state.galleryBd09Requested) TextButton(
            onClick = controller::showGalleryGpsOverview,
            enabled = !state.hasActiveNativeTransfer(),
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("gallery-map-back-to-gps"),
        ) { Text("返回 GPS 概览") }
        else if (state.galleryMapLoaded && overview != null) TextButton(
            onClick = controller::openGalleryVerifiedBd09Cells,
            enabled = !state.loading && !state.hasActiveNativeTransfer(),
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("gallery-map-open-bd09"),
        ) { Text("查看已验证 BD-09 网格") }
    }
    when {
        state.error != null -> Column(Modifier.weight(1f).fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(state.error,
                modifier = Modifier.testTag("gallery-map-error"))
            TextButton(
                onClick = controller::retryGalleryMapOverview,
                enabled = !state.loading,
                modifier = Modifier.heightIn(min = 48.dp).testTag("gallery-map-retry"),
            ) { Text(if (state.galleryBd09Requested) "重新读取 BD-09 网格"
                else "重新读取 GPS 概览") }
        }
        state.galleryBd09Requested -> when {
            !state.loading && bd09Cells != null -> GalleryVerifiedBd09Cells(bd09Cells, controller)
            else -> Box(Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-map-bd09-loading"), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        !state.galleryMapLoaded || overview == null ->
            Box(Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-map-loading"), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        overview.samples.isEmpty() ->
            Box(Modifier.weight(1f).fillMaxWidth()
                .testTag("gallery-map-empty"), contentAlignment = Alignment.Center) {
                Text("当前账户暂无可显示的 GPS 照片。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        else -> GalleryGpsSamples(overview)
    }
}

@Composable
private fun ColumnScope.GalleryGpsSamples(overview: OwnerMapOverview) {
    LazyColumn(
        modifier = Modifier.fillMaxWidth().weight(1f)
            .testTag("gallery-map-samples"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "summary") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("当前范围共有 ${overview.totalPhotoCount} 张定位照片 · " +
                    "${overview.samples.size} 个真实 GPS 代表位置",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("gallery-map-count"))
                Text(if (overview.aggregated) "大范围聚合概览" else "完整地点网格",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.testTag("gallery-map-aggregation-label"))
                WorldGpsScatter(overview.samples)
            }
        }
        items(overview.samples, key = { it.id }) { sample ->
            Surface(color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
                    .testTag("gallery-map-sample-${sample.id}")) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(sample.name,
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.weight(1f))
                        Text("${sample.itemCount} 张", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text("GPS ${formatGps(sample.sampleLatitude)}, " +
                        formatGps(sample.sampleLongitude) + " · WGS84",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** The official BD09 Owner representative coordinates, NOT grid centers.
 * Every dot uses an actual stored BD09LL sample, never a WGS84 projection.
 * A real Baidu basemap/cluster SDK must replace this explicitly labeled
 * visualization when correctly configured and validated. */
@Composable
private fun ColumnScope.GalleryVerifiedBd09Cells(
    result: OwnerBd09MapCells, controller: DriveController,
) {
    LazyColumn(
        modifier = Modifier.fillMaxWidth().weight(1f)
            .testTag("gallery-map-bd09-cells"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "summary") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("当前 Owner 已验证 ${result.totalPhotoCount} 张定位照片 · " +
                    "${result.cells.size} 个真实 BD-09 代表点（最多 64 格）",
                    modifier = Modifier.testTag("gallery-map-bd09-count"),
                    style = MaterialTheme.typography.bodyMedium)
                VerifiedBd09Grid(result)
            }
        }
        if (result.cells.isEmpty()) item(key = "empty") {
            Text("当前已验证的 BD-09 范围内暂无照片。",
                modifier = Modifier.testTag("gallery-map-bd09-empty"),
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(result.cells, key = { "cell:${it.cellX}:${it.cellY}" }) { cell ->
            Surface(color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
                    .testTag("gallery-map-bd09-cell-${cell.cellX}-${cell.cellY}")
                    .clickable { controller.openGalleryBd09Cell(cell) }) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("聚合网格 ${cell.cellX + 1}-${cell.cellY + 1}",
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.titleSmall)
                        Text("${cell.photoCount} 张",
                            style = MaterialTheme.typography.labelMedium)
                    }
                    Text("真实 BD-09 代表位置：${formatGps(cell.latitude)}, " +
                        formatGps(cell.longitude),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun VerifiedBd09Grid(result: OwnerBd09MapCells) {
    val dot = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    val paper = MaterialTheme.colorScheme.surfaceContainer
    Canvas(Modifier.fillMaxWidth().height(190.dp)
        .background(paper, RoundedCornerShape(12.dp))
        .semantics {
            contentDescription = "已验证 BD-09 代表点示意，非百度地图底图，共 ${result.cells.size} 个点"
        }
        .testTag("gallery-map-bd09-distribution")) {
        val w = size.width
        val h = size.height
        for (step in 1..7) {
            drawLine(grid, Offset(w * step / 8f, 0f),
                Offset(w * step / 8f, h), strokeWidth = 1.dp.toPx())
            drawLine(grid, Offset(0f, h * step / 8f),
                Offset(w, h * step / 8f), strokeWidth = 1.dp.toPx())
        }
        for (cell in result.cells) {
            // The actual server-certified sample is used, never cell center.
            val x = ((cell.longitude + 180.0) / 360.0).toFloat() * w
            val y = ((90.0 - cell.latitude) / 180.0).toFloat() * h
            if (!x.isFinite() || !y.isFinite()) continue
            drawCircle(dot, radius = 4.5.dp.toPx(),
                center = Offset(x.coerceIn(0f, w), y.coerceIn(0f, h)))
        }
    }
}

private fun formatGps(value: Double): String =
    String.format(Locale.ROOT, "%.4f°", value)

/** True WGS84 equirectangular projection only: not a Baidu map or a
 * fabricated city/region center. Every dot comes from Owner's sample_*. */
@Composable
private fun WorldGpsScatter(samples: List<OwnerMapSample>) {
    val pointColor = MaterialTheme.colorScheme.primary
    val lineColor = MaterialTheme.colorScheme.outlineVariant
    val paper = MaterialTheme.colorScheme.surfaceContainer
    Canvas(
        Modifier.fillMaxWidth().height(190.dp)
            .background(paper, RoundedCornerShape(12.dp))
            .semantics {
                contentDescription = "WGS84 真实 GPS 分布示意，非地图底图，共 ${samples.size} 个代表位置"
            }
            .testTag("gallery-map-wgs84-distribution"),
    ) {
        val width = size.width
        val height = size.height
        // Equator and Greenwich meridian are mathematical axes, not map tiles.
        drawLine(lineColor, Offset(width / 2f, 0f), Offset(width / 2f, height),
            strokeWidth = 1.dp.toPx())
        drawLine(lineColor, Offset(0f, height / 2f), Offset(width, height / 2f),
            strokeWidth = 1.dp.toPx())
        for (sample in samples) {
            val px = ((sample.sampleLongitude + 180.0) / 360.0).toFloat() * width
            val py = ((90.0 - sample.sampleLatitude) / 180.0).toFloat() * height
            if (!px.isFinite() || !py.isFinite()) continue
            drawCircle(pointColor, radius = 4.5.dp.toPx(),
                center = Offset(px.coerceIn(0f, width), py.coerceIn(0f, height)))
        }
    }
}
