package com.tfluid.xdrive

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A native Compose child of DYNAMIC; no WebView and no separate credentials. */
@Composable
internal fun NativeNotesScreen(controller: DriveController) {
    val owner by controller.state.collectAsStateWithLifecycle()
    var source by remember(owner.nativeUiSessionId) { mutableStateOf("mine") }
    var query by remember(owner.nativeUiSessionId) { mutableStateOf("") }
    var selected by remember(owner.nativeUiSessionId) { mutableStateOf<OwnerNoteRow?>(null) }
    var notes by remember(owner.nativeUiSessionId) { mutableStateOf(emptyList<OwnerNoteRow>()) }
    var nextOffset by remember(owner.nativeUiSessionId) { mutableIntStateOf(0) }
    var loading by remember(owner.nativeUiSessionId) { mutableStateOf(false) }
    var importing by remember(owner.nativeUiSessionId) { mutableStateOf(false) }
    var error by remember(owner.nativeUiSessionId) { mutableStateOf<String?>(null) }
    var refresh by remember(owner.nativeUiSessionId) { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    val context = LocalContext.current
    val importPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && source == "ios_notes" && !importing) {
            val ownerEpoch = owner.nativeUiSessionId
            importing = true
            scope.launch {
                try {
                    val (title, markdown) = withContext(Dispatchers.IO) {
                        val resolver = context.contentResolver
                        val displayName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME),
                            null, null, null)?.use { cursor ->
                            if (cursor.moveToFirst()) cursor.getString(0) else null
                        } ?: throw IOException("无法读取 Markdown 文件名")
                        if (!displayName.endsWith(".md", ignoreCase = true) &&
                            !displayName.endsWith(".markdown", ignoreCase = true)) {
                            throw IOException("请选择 .md 或 .markdown 文件")
                        }
                        val fileTitle = displayName.substringBeforeLast('.').trim()
                        val content = resolver.openInputStream(uri)?.use { input ->
                            val sink = ByteArrayOutputStream()
                            val buffer = ByteArray(8192)
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                if (sink.size() + read > 1_048_576)
                                    throw IOException("Markdown 正文超过 1 MiB")
                                sink.write(buffer, 0, read)
                            }
                            sink.toByteArray()
                        } ?: throw IOException("无法读取 Markdown 文件内容")
                        val text = Charsets.UTF_8.newDecoder()
                            .onMalformedInput(CodingErrorAction.REPORT)
                            .onUnmappableCharacter(CodingErrorAction.REPORT)
                            .decode(ByteBuffer.wrap(content)).toString()
                        if (!validNotesInput(fileTitle, text))
                            throw IOException("文件名或 Markdown 内容无效")
                        Pair(fileTitle, text)
                    }
                    if (owner.nativeUiSessionId != ownerEpoch || source != "ios_notes")
                        return@launch
                    controller.notesInitialize()
                    val imported = controller.notesImportIOSMarkdown(title, markdown)
                    if (imported.source != "ios_notes")
                        throw IOException("服务器未返回只读 iOS 备份")
                    if (owner.nativeUiSessionId == ownerEpoch && source == "ios_notes") {
                        selected = imported
                        refresh++
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = "导入结果未确认：" + (failure.message ?: "请求失败") +
                        "。请先核对备份列表，勿重复导入。"
                } finally {
                    importing = false
                }
            }
        }
    }

    BackHandler(selected != null) { selected = null; refresh++ }
    LaunchedEffect(owner.nativeUiSessionId, source, query, refresh) {
        if (selected != null) return@LaunchedEffect
        val requestedSource = source
        val requestedQuery = query
        loading = true
        error = null
        try {
            delay(250)
            controller.notesInitialize()
            val page = controller.notesList(requestedSource, requestedQuery)
            if (source == requestedSource && query == requestedQuery) {
                notes = page.items
                nextOffset = page.nextOffset
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message ?: "备忘录读取失败" }
        finally { if (source == requestedSource && query == requestedQuery) loading = false }
    }

    if (selected != null) {
        NativeNoteEditor(controller, requireNotNull(selected),
            onBack = { selected = null; refresh++ },
            onDeleted = { selected = null; refresh++ })
    } else {
        Column(Modifier.fillMaxSize().padding(12.dp).testTag("native-notes-page")) {
            Text("备忘录", style = MaterialTheme.typography.titleLarge)
            Row {
                TextButton(onClick = { source = "mine" }) {
                    Text(if (source == "mine") "✓ 我的备忘录" else "我的备忘录")
                }
                TextButton(onClick = { source = "ios_notes" }) {
                    Text(if (source == "ios_notes") "✓ iOS 备份" else "iOS 备份")
                }
            }
            OutlinedTextField(query, { query = it }, label = { Text("搜索标题或正文") },
                singleLine = true, modifier = Modifier.fillMaxWidth().testTag("native-notes-search"))
            if (source == "ios_notes") {
                Button(onClick = {
                    importPicker.launch(arrayOf("text/*", "application/octet-stream"))
                }, enabled = !loading && !importing,
                    modifier = Modifier.testTag("native-notes-import-markdown")) {
                    Text(if (importing) "正在导入…" else "从文件导入 Markdown")
                }
            }
            if (source == "mine") {
                Button(onClick = {
                    scope.launch {
                        try {
                            controller.notesInitialize()
                            selected = controller.notesCreate("未命名备忘录", "")
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { error = failure.message }
                    }
                }, enabled = !loading, modifier = Modifier.testTag("native-notes-create")) {
                    Text("新建备忘录")
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            LazyColumn(Modifier.weight(1f).testTag("native-notes-list")) {
                items(notes, key = { it.id }) { row ->
                    TextButton(onClick = { selected = row }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(row.title, style = MaterialTheme.typography.titleMedium)
                            Text((if (row.writable) "我的备忘录" else "只读备份") +
                                " · 版本 " + row.revision,
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    HorizontalDivider()
                }
                if (nextOffset > 0) item {
                    TextButton(enabled = !loading, onClick = {
                        val offset = nextOffset
                        val expectedSource = source
                        val expectedQuery = query
                        scope.launch {
                            try {
                                val page = controller.notesList(expectedSource, expectedQuery, offset)
                                if (source == expectedSource && query == expectedQuery &&
                                    selected == null && nextOffset == offset) {
                                    val ids = notes.map { it.id }.toSet()
                                    notes = notes + page.items.filterNot { it.id in ids }
                                    nextOffset = page.nextOffset
                                }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message }
                        }
                    }) { Text("加载更多") }
                }
            }
        }
    }
}

@Composable
private fun NativeNoteEditor(
    controller: DriveController, note: OwnerNoteRow,
    onBack: () -> Unit, onDeleted: () -> Unit,
) {
    val owner by controller.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var committed by remember(owner.nativeUiSessionId, note.id) { mutableStateOf<OwnerNoteDetail?>(null) }
    var title by remember(owner.nativeUiSessionId, note.id) { mutableStateOf("") }
    var markdown by remember(owner.nativeUiSessionId, note.id) { mutableStateOf("") }
    var saving by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(false) }
    var conflict by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(false) }
    var preview by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(true) }
    var error by remember(owner.nativeUiSessionId, note.id) { mutableStateOf<String?>(null) }
    var deleting by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(false) }
    var discard by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(false) }
    var history by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(false) }
    val dirty = committed?.let { it.row.title != title || it.markdown != markdown } ?: false
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri ->
        if (uri != null && committed != null) {
            val bytes = markdown.toByteArray(Charsets.UTF_8)
            val epoch = owner.nativeUiSessionId
            scope.launch {
                try {
                    if (controller.state.value.nativeUiSessionId != epoch) return@launch
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            ?: throw IllegalStateException("Cannot open destination")
                    }
                    error = "Markdown 已导出"
                } catch (failure: Exception) { error = failure.message }
            }
        }
    }
    suspend fun load() {
        try {
            val value = controller.notesDetail(note.id)
            if (value.row.source != note.source) throw IllegalStateException("Note source mismatch")
            committed = value
            title = value.row.title
            markdown = value.markdown
            conflict = false
            error = null
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
    }
    suspend fun save() {
        val old = committed ?: return
        if (!note.writable || saving || conflict || !dirty) return
        if (!validNotesInput(title, markdown)) {
            error = "Markdown 限制 1 MiB，标题不能包含非法字符"
            return
        }
        val sentTitle = title
        val sentMarkdown = markdown
        saving = true
        error = null
        try {
            val saved = controller.notesUpdate(note.id, sentTitle, sentMarkdown, old.row.revision)
            committed = OwnerNoteDetail(saved, sentMarkdown)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (failure is ApiException && failure.statusCode == 409) {
                conflict = true
                error = "其他设备已更新；当前草稿保留"
            } else error = failure.message ?: "保存失败，草稿保留"
        } finally { saving = false }
    }

    LaunchedEffect(note.id, owner.nativeUiSessionId) { load() }
    LaunchedEffect(title, markdown, committed?.row?.revision, conflict) {
        if (note.writable && dirty && !conflict && !saving) {
            delay(1200)
            save()
        }
    }
    BackHandler {
        if (dirty || saving) discard = true else onBack()
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false },
        title = { Text("放弃未保存的草稿？") },
        confirmButton = { TextButton(onClick = { discard = false; onBack() }) { Text("放弃并返回") } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text("继续编辑") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false },
        title = { Text("删除备忘录？") },
        confirmButton = { TextButton(onClick = {
            deleting = false
            val revision = committed?.row?.revision ?: return@TextButton
            if (dirty || saving) { error = "先保存或放弃草稿"; return@TextButton }
            scope.launch {
                try { controller.notesDelete(note.id, revision); onDeleted() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message }
            }
        }) { Text("删除") } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } })
    if (history) NativeNotesHistory(controller, note.id, note.nodeId) { history = false }

    Column(Modifier.fillMaxSize().padding(12.dp).testTag("native-notes-editor")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { if (dirty || saving) discard = true else onBack() }) { Text("返回") }
            Text(if (note.writable) "我的备忘录" else "iOS 备份 · 只读")
            TextButton(onClick = { export.launch(note.id + ".md") },
                enabled = committed != null) { Text("导出") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (committed != null) {
            if (note.writable) {
                OutlinedTextField(title, { title = it }, label = { Text("标题") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Row {
                    TextButton(onClick = { preview = !preview }) {
                        Text(if (preview) "编辑 Markdown" else "预览 Markdown")
                    }
                    TextButton(onClick = { scope.launch { save() } },
                        enabled = dirty && !conflict && !saving) { Text("保存") }
                    TextButton(onClick = { deleting = true }) { Text("删除") }
                }
            } else Text(title, style = MaterialTheme.typography.titleLarge)
            Row {
                Text("版本 " + committed!!.row.revision, modifier = Modifier.weight(1f))
                TextButton(onClick = { history = true }) { Text("历史版本") }
            }
            if (preview || !note.writable) {
                NativeNotesMarkdownPreview(markdown, Modifier.weight(1f))
            } else {
                OutlinedTextField(markdown, { markdown = it },
                    label = { Text("Markdown 正文") },
                    modifier = Modifier.fillMaxWidth().weight(1f).testTag("native-notes-markdown"),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
            }
        } else Text("正在验证笔记内容…")
    }
}

private data class NativeNoteLine(val text: String, val kind: Int)

@Composable
private fun NativeNotesMarkdownPreview(markdown: String, modifier: Modifier = Modifier) {
    val lines = remember(markdown) {
        var fenced = false
        markdown.replace("\r\n", "\n").lines().mapNotNull { line ->
            when {
                line.startsWith(96.toChar().toString().repeat(3)) -> {
                    fenced = !fenced; null
                }
                fenced -> NativeNoteLine(line, 3)
                line.startsWith("# ") -> NativeNoteLine(line.drop(2), 1)
                line.startsWith("## ") -> NativeNoteLine(line.drop(3), 2)
                line.startsWith("- ") -> NativeNoteLine("• " + line.drop(2), 0)
                else -> NativeNoteLine(line, 0)
            }
        }
    }
    LazyColumn(modifier.testTag("native-notes-preview")) {
        items(lines) { line ->
            Text(line.text,
                style = when (line.kind) {
                    1 -> MaterialTheme.typography.headlineSmall
                    2 -> MaterialTheme.typography.titleLarge
                    else -> MaterialTheme.typography.bodyMedium
                },
                fontFamily = if (line.kind == 3) FontFamily.Monospace else null)
        }
    }
}

@Composable
private fun NativeNotesHistory(
    controller: DriveController, noteID: String, nodeID: Long, onClose: () -> Unit,
) {
    var versions by remember(noteID) { mutableStateOf(emptyList<OwnerNoteVersion>()) }
    var oldMarkdown by remember(noteID) { mutableStateOf<String?>(null) }
    var error by remember(noteID) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(noteID) {
        try { versions = controller.notesVersions(noteID) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message }
    }
    AlertDialog(onDismissRequest = onClose, title = { Text("历史版本 · 只读") },
        text = {
            Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                versions.forEach { version ->
                    TextButton(onClick = {
                        scope.launch {
                            try { oldMarkdown = controller.notesPreviousMarkdown(nodeID, version.id) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message }
                        }
                    }) { Text("版本 " + version.revision + " · " + version.bytes + " B") }
                }
                oldMarkdown?.let { Text(it) }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }, confirmButton = { TextButton(onClick = onClose) { Text("关闭") } })
}
