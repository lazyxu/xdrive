package com.tfluid.xdrive

import android.content.ContentResolver
import android.os.CancellationSignal
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** An actual MediaStore DATE_ADDED first-item position, not an Owner/server row.
 * `before` is the exact preceding keyset row, including across 512-row batches.
 * No photo URI, thumbnail, location or password is stored in this index.
 */
internal data class NativeLocalFullDateGroup(
    val key: String, val label: String, val firstIndex: Int, val count: Int,
    val before: NativeLocalPageKey?,
)

/** Complete means the authorized provider returned a short/empty page before
 * the hard cap. A full 115,200-row final page can never prove completeness.
 */
internal data class NativeLocalFullDateIndex(
    val years: List<NativeLocalFullDateGroup>,
    val months: List<NativeLocalFullDateGroup>,
    val days: List<NativeLocalFullDateGroup>,
    val scanned: Int,
    val complete: Boolean,
    val groupBudgetHit: Boolean,
) {
    fun forScale(scale: String): List<NativeLocalFullDateGroup> = when (scale) {
        "year" -> years
        "month" -> months
        "day" -> days
        else -> emptyList()
    }
}

/** Pure bounded streaming reducer. A 100k-library never becomes 100k UI items. */
internal class NativeLocalFullDateIndexBuilder(
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val maxGroups: Int = MAX_GROUPS,
) {
    init { require(maxGroups in 3..MAX_GROUPS) }
    private val years = linkedMapOf<String, NativeLocalFullDateGroup>()
    private val months = linkedMapOf<String, NativeLocalFullDateGroup>()
    private val days = linkedMapOf<String, NativeLocalFullDateGroup>()
    var scanned: Int = 0
        private set
    private var previous: NativeLocalPageKey? = null

    /** false means the group budget was exhausted BEFORE consuming a new row. */
    fun append(keys: List<NativeLocalPageKey>): Boolean {
        check(nativeLocalStrictPageOrder(previous, keys)) {
            "MediaStore date index returned duplicate/unordered rows"
        }
        for (row in keys) {
            val localDate: LocalDate? = if (row.addedAtSeconds <= 0L) null else
                runCatching { Instant.ofEpochSecond(row.addedAtSeconds)
                    .atZone(zone).toLocalDate() }.getOrNull()
            val year = if (localDate == null) "unknown" else
                String.format(Locale.ROOT, "%04d", localDate.year)
            val month = if (localDate == null) "unknown" else
                String.format(Locale.ROOT, "%04d-%02d",
                    localDate.year, localDate.monthValue)
            val day = if (localDate == null) "unknown" else
                String.format(Locale.ROOT, "%04d-%02d-%02d",
                    localDate.year, localDate.monthValue, localDate.dayOfMonth)
            val newGroups = listOf(year to years, month to months, day to days)
                .count { (key, groups) -> !groups.containsKey(key) }
            if (years.size + months.size + days.size + newGroups > maxGroups)
                return false
            fun add(
                groups: MutableMap<String, NativeLocalFullDateGroup>,
                key: String, label: String,
            ) {
                val existing = groups[key]
                if (existing == null) groups[key] = NativeLocalFullDateGroup(
                    key, label, scanned, 1, previous)
                else groups[key] = existing.copy(count = existing.count + 1)
            }
            add(years, year, if (localDate == null) "加入日期未知"
                else "${localDate.year}年")
            add(months, month, if (localDate == null) "加入日期未知"
                else "${localDate.year}年${localDate.monthValue}月")
            add(days, day, if (localDate == null) "加入日期未知"
                else "${localDate.year}年${localDate.monthValue}月${localDate.dayOfMonth}日")
            previous = row
            scanned++
        }
        return true
    }

    fun snapshot(complete: Boolean, groupBudgetHit: Boolean = false) =
        NativeLocalFullDateIndex(
            years.values.toList(), months.values.toList(), days.values.toList(),
            scanned, complete = complete && !groupBudgetHit, groupBudgetHit,
        )

    companion object { const val MAX_GROUPS = 24_576 }
}

/** Explicit foreground-only index build. Uses the same bounded authorized
 * keyset reader as the wall, never a new MediaStore permission or Server call.
 * Every provider query has a true CancellationSignal; no full-library URI list.
 */
internal suspend fun scanNativeLocalFullDateIndex(
    resolver: ContentResolver,
    albumId: String?,
    signal: CancellationSignal,
    onProgress: suspend (Int) -> Unit = {},
): NativeLocalFullDateIndex {
    val builder = NativeLocalFullDateIndexBuilder()
    var after: NativeLocalPageKey? = null
    var complete = false
    var groupBudgetHit = false
    while (builder.scanned < NativeLocalMediaStore.MAX_SCAN) {
        currentCoroutineContext().ensureActive()
        signal.throwIfCanceled()
        val amount = minOf(NativeLocalMediaStore.SCAN_BATCH_SIZE,
            NativeLocalMediaStore.MAX_SCAN - builder.scanned)
        val page = NativeLocalMediaStore.pageAfter(
            resolver, after = after, limit = amount, albumId = albumId,
            cancellationSignal = signal,
        )
        if (page.isEmpty()) { complete = true; break }
        if (!builder.append(page.map { it.pageKey })) {
            groupBudgetHit = true
            onProgress(builder.scanned)
            break
        }
        after = page.last().pageKey
        onProgress(builder.scanned)
        if (page.size < amount) { complete = true; break }
    }
    currentCoroutineContext().ensureActive()
    signal.throwIfCanceled()
    return builder.snapshot(complete, groupBudgetHit)
}

/** Full index covers the scanned authorized prefix only, never hidden photos. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NativeLocalFullDatePicker(
    scale: String,
    index: NativeLocalFullDateIndex,
    onDismiss: () -> Unit,
    onChoose: (NativeLocalFullDateGroup) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss,
        modifier = Modifier.testTag("native-local-full-date-picker")) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)
            .padding(bottom = 24.dp)) {
            Text("本机日期跳转 · " + when (scale) {
                "year" -> "年"
                "month" -> "月"
                else -> "日"
            }, style = MaterialTheme.typography.titleMedium)
            Text(
                if (index.complete) "已索引当前授权范围的 ${index.scanned} 项（按加入时间）"
                else "仅索引前 ${index.scanned} 项；扫描达到上限，更多日期尚未覆盖。",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(vertical = 8.dp)
                    .testTag("native-local-full-date-coverage"),
            )
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 440.dp)
                .testTag("native-local-full-date-list")) {
                items(index.forScale(scale), key = { it.key }) { group ->
                    TextButton(onClick = { onChoose(group) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("native-local-full-date-group-" + group.key)) {
                        Row(Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(group.label)
                            Text("${group.count} 项", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
