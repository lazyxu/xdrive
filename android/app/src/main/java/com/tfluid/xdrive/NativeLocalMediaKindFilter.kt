package com.tfluid.xdrive

import android.provider.MediaStore
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Query the real Android provider by type, not only the visible 512 tiles.
 * Empty type means both kinds. Invalid types must not become raw SQL.
 */
internal val nativeLocalMediaKindOptions = listOf(
    "" to "全部", "image" to "照片", "video" to "视频",
)

internal fun nativeLocalMediaTypesForKind(kind: String): List<Int> = when (kind) {
    "" -> listOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE,
        MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
    "image" -> listOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE)
    "video" -> listOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
    else -> throw IllegalArgumentException("Unsupported local Gallery media kind")
}

/** Fixed three-way Photos-first selector; only a user's tap changes the query. */
@Composable
internal fun NativeLocalMediaKindDock(
    selectedKind: String,
    enabled: Boolean,
    onChoose: (String) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)
            .testTag("native-local-kind-dock"),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for ((kind, label) in nativeLocalMediaKindOptions) {
            TextButton(
                enabled = enabled,
                onClick = { onChoose(kind) },
                contentPadding = PaddingValues(horizontal = 4.dp),
                modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                    .semantics { selected = kind == selectedKind }
                    .testTag("native-local-kind-" + if (kind.isEmpty()) "all" else kind),
            ) { Text(label, style = MaterialTheme.typography.labelLarge) }
        }
    }
}
