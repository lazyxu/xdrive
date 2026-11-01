package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** The source is MediaStore DATE_ADDED, not a synthetic full-library photo index.
 * Pages stay in the provider's stable DESC keyset order; each group refers to
 * an actual index within the current bounded (max 512) authorized wall only.
 */
internal data class NativeLocalDateWindowGroup(
    val key: String,
    val label: String,
    val firstIndex: Int,
    val count: Int,
)

internal val nativeLocalDateWindowScales = listOf(
    "year" to "年", "month" to "月", "day" to "日", "all" to "全部",
)

internal fun nativeLocalDateWindowGroups(
    addedAtSeconds: List<Long>,
    scale: String,
    zone: ZoneId = ZoneId.systemDefault(),
): List<NativeLocalDateWindowGroup> {
    if (scale !in setOf("year", "month", "day")) return emptyList()
    require(addedAtSeconds.size <= NativeLocalMediaStore.MAX_WALL_ITEMS) {
        "Date-window groups cannot enumerate an unbounded library"
    }
    val groups = linkedMapOf<String, NativeLocalDateWindowGroup>()
    addedAtSeconds.forEachIndexed { index, seconds ->
        val day: LocalDate? = if (seconds <= 0L) null else
            runCatching { Instant.ofEpochSecond(seconds).atZone(zone).toLocalDate() }
                .getOrNull()
        val key = if (day == null) "unknown" else when (scale) {
            "year" -> String.format(Locale.ROOT, "%04d", day.year)
            "month" -> String.format(Locale.ROOT, "%04d-%02d", day.year, day.monthValue)
            else -> String.format(Locale.ROOT, "%04d-%02d-%02d",
                day.year, day.monthValue, day.dayOfMonth)
        }
        val label = if (day == null) "加入日期未知" else when (scale) {
            "year" -> "${day.year}年"
            "month" -> "${day.year}年${day.monthValue}月"
            else -> "${day.year}年${day.monthValue}月${day.dayOfMonth}日"
        }
        val previous = groups[key]
        if (previous == null) groups[key] =
            NativeLocalDateWindowGroup(key, label, index, 1)
        else groups[key] = previous.copy(count = previous.count + 1)
    }
    return groups.values.toList()
}

/** Four fixed native controls; no additional app tab or persistent search. */
@Composable
internal fun NativeLocalDateWindowDock(
    selectedScale: String,
    enabled: Boolean,
    onPick: (String) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)
            .testTag("native-local-date-window-dock"),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for ((scale, label) in nativeLocalDateWindowScales) {
            TextButton(
                enabled = enabled,
                onClick = { onPick(scale) },
                modifier = Modifier.weight(1f).heightIn(min = 44.dp)
                    .semantics { selected = scale == selectedScale }
                    .testTag("native-local-date-scale-" + scale),
                contentPadding = PaddingValues(horizontal = 4.dp),
            ) { Text(label, style = MaterialTheme.typography.labelMedium) }
        }
    }
}

/** Picker values never imply full-device coverage or a full-library count. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeLocalDateWindowPicker(
    scale: String,
    groups: List<NativeLocalDateWindowGroup>,
    loadedCount: Int,
    onDismiss: () -> Unit,
    onChoose: (NativeLocalDateWindowGroup) -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("native-local-date-window-picker"),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)
            .padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "按加入时间跳转 · " + when (scale) {
                    "year" -> "年份"
                    "month" -> "月份"
                    else -> "日期"
                },
                style = MaterialTheme.typography.titleMedium,
            )
            Text("仅当前已加载的 ${loadedCount} 项；不代表设备全部照片。继续向下加载后可选择更多日期。",
                modifier = Modifier.testTag("native-local-date-picker-scope"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)
                .testTag("native-local-date-window-list")) {
                items(groups, key = { it.key }) { group ->
                    TextButton(
                        onClick = { onChoose(group) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("native-local-date-group-" + group.key),
                    ) {
                        Row(Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(group.label)
                            Text("${group.count} 项（已加载）",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
