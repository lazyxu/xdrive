package com.tfluid.xdrive

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.DriveNode

/** Split the bounded 1 MiB UTF-8 preview for Compose without cutting a UTF-16
 * surrogate pair (emoji) or a Windows CRLF at a render item boundary. The
 * original text is retained unchanged and chunks stay <= 4096 code units.
 * This is a visual chunking policy, not a new transport or unbounded read. */
internal fun nativeTextViewerDisplayChunks(
    text: String, maxUnits: Int = 4096,
): List<String> {
    require(maxUnits >= 2)
    if (text.isEmpty()) return emptyList()
    val result = ArrayList<String>((text.length + maxUnits - 1) / maxUnits)
    var offset = 0
    while (offset < text.length) {
        var end = minOf(offset + maxUnits, text.length)
        if (end < text.length && (
                (Character.isHighSurrogate(text[end - 1]) &&
                    Character.isLowSurrogate(text[end])) ||
                (text[end - 1] == '\r' && text[end] == '\n')
            )) end--
        check(end > offset)
        result += text.substring(offset, end)
        offset = end
    }
    return result
}

/** Real native UTF-8 Files Viewer. Reuses the existing 1 MiB Owner/revision
 * verified text endpoint and Controller retry fence; never writes media to disk,
 * stores tokens, or builds one pathological million-character Compose Text. */
@Composable
internal fun NativeFilesTextViewer(
    node: DriveNode, state: DriveState, controller: DriveController,
) {
    Column(Modifier.fillMaxSize().background(Color.Black)
        .testTag("files-text-viewer")) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = controller::dismissFilesTextViewer,
                modifier = Modifier.heightIn(min = 48.dp).testTag("files-text-close")) {
                Text("返回", color = Color.White)
            }
            Text(node.name, modifier = Modifier.weight(1f),
                color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleSmall)
        }
        val preview = state.fileTextPreview
        when {
            state.fileTextPreviewLoading || (preview == null && state.fileTextPreviewError == null) -> {
                Column(Modifier.fillMaxWidth().weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(color = Color.White,
                        modifier = Modifier.testTag("files-text-loading"))
                    Text("正在读取 UTF-8 文本（最多 1 MiB）…", color = Color.LightGray,
                        modifier = Modifier.padding(top = 12.dp))
                }
            }
            state.fileTextPreviewError != null -> {
                Column(Modifier.fillMaxWidth().weight(1f).padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center) {
                    Text(requireNotNull(state.fileTextPreviewError), color = Color.White,
                        modifier = Modifier.testTag("files-text-error"))
                    TextButton(onClick = controller::retryTextPreview,
                        modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("files-text-retry")) {
                        Text("重试读取", color = Color.White)
                    }
                }
            }
            preview != null -> {
                Text(if (preview.truncated) "只显示前 1 MiB · 文件已截断"
                    else "完整文本 · ${formatSize(preview.size)}",
                    color = Color.LightGray, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)
                        .testTag("files-text-status"))
                val chunks = remember(node.id, node.revision, preview.text) {
                    nativeTextViewerDisplayChunks(preview.text)
                }
                if (chunks.isEmpty()) {
                    Box(Modifier.fillMaxWidth().weight(1f),
                        contentAlignment = Alignment.Center) {
                        Text("空文件", color = Color.White,
                            modifier = Modifier.testTag("files-text-empty"))
                    }
                } else {
                    LazyColumn(Modifier.weight(1f).fillMaxWidth()
                        .navigationBarsPadding().padding(horizontal = 12.dp)
                        .testTag("files-text-content")) {
                        items(chunks.size) { index ->
                            SelectionContainer {
                                Text(chunks[index], color = Color.White,
                                    fontFamily = FontFamily.Monospace, softWrap = true,
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}
