package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.FileBrowseArrangement
import com.tfluid.xdrive.core.FileBrowseGroupIndex
import java.util.Locale

/** Rows in the *loaded* Owner window; headers reference the complete Server index.
 * Never infer a bucket from the visible 100 files or reorder them locally. */
internal sealed interface FilesBrowseVisualRow {
    val stableKey: String

    data class Header(val index: FileBrowseGroupIndex) : FilesBrowseVisualRow {
        override val stableKey: String get() = "group:${index.startIndex}:${index.key}"
    }

    data class File(val node: DriveNode) : FilesBrowseVisualRow {
        override val stableKey: String get() = "node:${node.id}"
    }
}

internal fun filesBrowseVisualRows(
    items: List<DriveNode>, start: Int, arrangement: FileBrowseArrangement,
    groups: List<FileBrowseGroupIndex>,
): List<FilesBrowseVisualRow> {
    val ungrouped = { items.map { FilesBrowseVisualRow.File(it) } }
    if (items.isEmpty() || arrangement.group == "none" || groups.isEmpty() || start < 0)
        return ungrouped()
    val first = start.toLong()
    var g = groups.indexOfFirst {
        first >= it.startIndex && first - it.startIndex < it.itemCount
    }
    if (g < 0) return ungrouped()
    val rows = ArrayList<FilesBrowseVisualRow>(items.size + 8)
    var previous: FileBrowseGroupIndex? = null
    for ((local, node) in items.withIndex()) {
        val absolute = first + local.toLong()
        while (g < groups.size && absolute >= groups[g].startIndex + groups[g].itemCount) g++
        val index = groups.getOrNull(g) ?: return ungrouped()
        if (absolute < index.startIndex) return ungrouped()
        if (previous != index) rows.add(FilesBrowseVisualRow.Header(index))
        rows.add(FilesBrowseVisualRow.File(node))
        previous = index
    }
    return rows
}

/** Same labels as ui/shared/src/file-explorer-grouping.ts. */
internal fun filesBrowseGroupLabel(arrangement: FileBrowseArrangement, key: String): String =
    when (arrangement.group) {
        "type" -> when {
            key == "folder" -> "文件夹"
            key == "other" -> "其他文件"
            key.startsWith("ext:") && key.length > 4 ->
                key.drop(4).trim().uppercase(Locale.ROOT).ifEmpty { "其他文件" }
            else -> "其他文件"
        }
        "modified" -> {
            val month = Regex("""month:(\d{4})-(\d{2})""").matchEntire(key)
            if (month == null) "日期未知"
            else "${month.groupValues[1].toInt()}年${month.groupValues[2].toInt()}月"
        }
        "size" -> when (key) {
            "folder" -> "文件夹"
            "empty" -> "空文件"
            "tiny" -> "小于 1 MiB"
            "small" -> "1–100 MiB"
            "medium" -> "100 MiB–1 GiB"
            "large" -> "1 GiB 及以上"
            else -> "其他大小"
        }
        else -> key
    }
