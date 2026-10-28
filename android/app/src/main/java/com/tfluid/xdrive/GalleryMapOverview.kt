package com.tfluid.xdrive

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
        Text("仅显示当前账户的真实 GPS 代表点。百度地图底图、BD-09 转换及地点照片联动尚未接入。",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("gallery-map-unavailable-basemap"))
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
            ) { Text("重新读取 GPS 概览") }
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
