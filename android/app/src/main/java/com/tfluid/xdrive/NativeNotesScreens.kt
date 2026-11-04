package com.tfluid.xdrive

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
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

private data class NativeNotesImportDocument(val uri: Uri, val name: String)
private data class NativeNotesImportPlan(
    val title: String,
    val markdown: String,
    val images: Map<String, NativeNotesImportDocument>,
    val references: List<String>,
)

private fun nativeNotesImportDisplayName(context: Context, uri: Uri): String {
    return context.contentResolver.query(
        uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null,
    )?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    }?.takeIf { it.isNotBlank() } ?: throw IOException("无法读取所选文件名")
}

private fun readNativeNotesImportFile(context: Context, uri: Uri, maxBytes: Int): ByteArray {
    val input = context.contentResolver.openInputStream(uri)
        ?: throw IOException("无法读取所选文件内容")
    return input.use {
        val sink = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            if (sink.size() + count > maxBytes) throw IOException("所选文件超过大小限制")
            sink.write(buffer, 0, count)
        }
        sink.toByteArray()
    }
}

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
    val importPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isNotEmpty() && source == "ios_notes" && !importing) {
            val ownerEpoch = owner.nativeUiSessionId
            importing = true
            error = null
            scope.launch {
                var created: OwnerNoteRow? = null
                try {
                    val plan = withContext(Dispatchers.IO) {
                        val documents = uris.map { uri ->
                            NativeNotesImportDocument(uri, nativeNotesImportDisplayName(context, uri))
                        }
                        val markdownFiles = documents.filter {
                            it.name.endsWith(".md", ignoreCase = true) ||
                                it.name.endsWith(".markdown", ignoreCase = true)
                        }
                        if (markdownFiles.size != 1)
                            throw IOException("请同时选择且只选择一份 .md 或 .markdown 文件")
                        val imageFiles = documents.filter {
                            it.name.substringAfterLast('.', "").lowercase() in
                                setOf("png", "jpg", "jpeg", "gif", "webp", "heic")
                        }
                        if (imageFiles.size > NativeNotesManualImportPolicy.maxImages)
                            throw IOException("一次最多选择 32 张图片")
                        val markdownFile = markdownFiles.single()
                        val title = markdownFile.name.substringBeforeLast('.').trim()
                        val markdownBytes = readNativeNotesImportFile(
                            context, markdownFile.uri, 1_048_576)
                        val markdown = try {
                            Charsets.UTF_8.newDecoder()
                                .onMalformedInput(CodingErrorAction.REPORT)
                                .onUnmappableCharacter(CodingErrorAction.REPORT)
                                .decode(ByteBuffer.wrap(markdownBytes)).toString()
                        } catch (_: Exception) {
                            throw IOException("Markdown 文件不是有效的 UTF-8 编码")
                        }
                        if (!validNotesInput(title, markdown))
                            throw IOException("文件名或 Markdown 内容无效")
                        val references = NativeNotesManualImportPolicy.references(markdown)
                        NativeNotesManualImportPolicy.selectedImages(
                            references, imageFiles.map { it.name })
                        NativeNotesImportPlan(
                            title, markdown, imageFiles.associateBy { it.name }, references)
                    }
                    if (controller.state.value.nativeUiSessionId != ownerEpoch ||
                        source != "ios_notes") return@launch
                    controller.notesInitialize()
                    val externalID = if (plan.references.isEmpty()) null
                        else "manual-md:" + UUID.randomUUID().toString().lowercase()
                    created = controller.notesImportIOSMarkdown(
                        plan.title, plan.markdown, externalID)
                    if (controller.state.value.nativeUiSessionId != ownerEpoch ||
                        source != "ios_notes") return@launch
                    refresh++
                    if (created?.source != "ios_notes")
                        throw IOException("服务器未返回只读 iOS 备份")
                    var finalNote = requireNotNull(created)
                    var rewritten = plan.markdown
                    for (name in plan.references) {
                        if (controller.state.value.nativeUiSessionId != ownerEpoch ||
                            source != "ios_notes") return@launch
                        val document = plan.images[name]
                            ?: throw IOException("Markdown 引用的图片未被选择")
                        val bytes = withContext(Dispatchers.IO) {
                            readNativeNotesImportFile(
                                context, document.uri, NativeNotesManualImportPolicy.maxImageBytes)
                        }
                        val receipt = controller.notesImportIOSImage(finalNote.id, bytes)
                        if (!validNotesImagePath(finalNote.id, receipt.relativePath))
                            throw IOException("服务器返回的图片归属或路径无效")
                        rewritten = NativeNotesManualImportPolicy.replacing(
                            rewritten, name, receipt.relativePath, finalNote.id)
                    }
                    if (rewritten != plan.markdown) {
                        val updated = controller.notesImportIOSMarkdown(
                            plan.title, rewritten, externalID)
                        if (updated.id != finalNote.id || updated.source != "ios_notes" ||
                            updated.revision <= finalNote.revision)
                            throw IOException("图片引用更新回执与原笔记不匹配")
                        finalNote = updated
                    }
                    if (controller.state.value.nativeUiSessionId == ownerEpoch &&
                        source == "ios_notes") {
                        selected = finalNote
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    error = if (created != null)
                        "笔记备份已创建，但图片导入或引用更新未完成：" +
                            (failure.message ?: "请求失败") + "。请先核对备份列表，勿重复导入。"
                    else
                        "导入结果未确认：" + (failure.message ?: "请求失败") +
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
        catch (failure: Exception) { error = failure.message ?: "笔记读取失败" }
        finally { if (source == requestedSource && query == requestedQuery) loading = false }
    }

    if (selected != null) {
        NativeNoteEditor(controller, requireNotNull(selected),
            onBack = { selected = null; refresh++ },
            onDeleted = { selected = null; refresh++ })
    } else {
        Column(Modifier.fillMaxSize().padding(12.dp).testTag("native-notes-page")) {
            Text("笔记", style = MaterialTheme.typography.titleLarge)
            Row {
                TextButton(onClick = { source = "mine" }) {
                    Text(if (source == "mine") "✓ 我的笔记" else "我的笔记")
                }
                TextButton(onClick = { source = "ios_notes" }) {
                    Text(if (source == "ios_notes") "✓ iOS 备份" else "iOS 备份")
                }
            }
            OutlinedTextField(query, { query = it }, label = { Text("搜索标题或正文") },
                singleLine = true, modifier = Modifier.fillMaxWidth().testTag("native-notes-search"))
            if (source == "ios_notes") {
                Button(onClick = {
                    importPicker.launch(arrayOf("*/*"))
                }, enabled = !loading && !importing,
                    modifier = Modifier.testTag("native-notes-import-markdown-bundle")) {
                    Text(if (importing) "正在导入…" else "导入 Markdown + 图片")
                }
            }
            if (source == "mine") {
                Button(onClick = {
                    scope.launch {
                        try {
                            controller.notesInitialize()
                            selected = controller.notesCreate("未命名笔记", "")
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { error = failure.message }
                    }
                }, enabled = !loading, modifier = Modifier.testTag("native-notes-create")) {
                    Text("新建笔记")
                }
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            LazyColumn(Modifier.weight(1f).testTag("native-notes-list")) {
                items(notes, key = { it.id }) { row ->
                    TextButton(onClick = { selected = row }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(row.title, style = MaterialTheme.typography.titleMedium)
                            Text((if (row.writable) "我的笔记" else "只读备份") +
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
    var uploadingImage by remember(owner.nativeUiSessionId, note.id) { mutableStateOf(false) }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && note.writable && committed != null &&
            !uploadingImage && !saving && !conflict) {
            val epoch = owner.nativeUiSessionId
            val projected = "_assets/" + note.id +
                "/00000000-0000-4000-8000-000000000000.heic"
            if (!runCatching {
                    validNotesInput(title, appendNotesImageMarkdown(markdown, note.id, projected))
                }.getOrDefault(false)) {
                error = "当前笔记已达到 Markdown 1 MiB 限制，不能再插入图片。"
            } else {
                uploadingImage = true
                error = null
                scope.launch {
                    try {
                        val imageBytes = withContext(Dispatchers.IO) {
                            context.contentResolver.openInputStream(uri)?.use { input ->
                                val output = ByteArrayOutputStream()
                                val buffer = ByteArray(8192)
                                while (true) {
                                    val read = input.read(buffer)
                                    if (read < 0) break
                                    if (read == 0) continue
                                    if (output.size() > 20 * 1_048_576 - read)
                                        throw IOException("图片超过 20 MiB")
                                    output.write(buffer, 0, read)
                                }
                                output.toByteArray()
                            } ?: throw IOException("无法读取所选图片")
                        }
                        if (imageBytes.isEmpty()) throw IOException("图片为空")
                        if (controller.state.value.nativeUiSessionId != epoch)
                            return@launch
                        val receipt = controller.notesUploadImage(note.id, imageBytes)
                        if (!validNotesImagePath(note.id, receipt.relativePath))
                            throw IOException("笔记图片的服务器回执无效")
                        if (controller.state.value.nativeUiSessionId != epoch)
                            return@launch
                        markdown = appendNotesImageMarkdown(markdown, note.id, receipt.relativePath)
                        preview = true
                        error = "图片已加入草稿，正在自动保存。"
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (failure: Exception) {
                        if (controller.state.value.nativeUiSessionId == epoch)
                            error = "图片上传或插入结果未确认：" +
                                (failure.message ?: "请求失败") +
                                "。请先核对当前笔记及图片，勿盲目重复上传。"
                    } finally {
                        if (controller.state.value.nativeUiSessionId == epoch)
                            uploadingImage = false
                    }
                }
            }
        }
    }
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
        if (!note.writable || saving || uploadingImage || conflict || !dirty) return
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
    LaunchedEffect(title, markdown, committed?.row?.revision, conflict, uploadingImage) {
        if (note.writable && dirty && !conflict && !saving && !uploadingImage) {
            delay(1200)
            save()
        }
    }
    BackHandler {
        if (dirty || saving || uploadingImage) discard = true else onBack()
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false },
        title = { Text("放弃未保存的草稿？") },
        confirmButton = { TextButton(onClick = { discard = false; onBack() }) { Text("放弃并返回") } },
        dismissButton = { TextButton(onClick = { discard = false }) { Text("继续编辑") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false },
        title = { Text("删除笔记？") },
        confirmButton = { TextButton(onClick = {
            deleting = false
            val revision = committed?.row?.revision ?: return@TextButton
            if (dirty || saving || uploadingImage) { error = "先保存或放弃草稿"; return@TextButton }
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
            TextButton(onClick = { if (dirty || saving || uploadingImage) discard = true else onBack() }) { Text("返回") }
            Text(if (note.writable) "我的笔记" else "iOS 备份 · 只读")
            TextButton(onClick = { export.launch(note.id + ".md") },
                enabled = committed != null) { Text("导出") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (uploadingImage) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (committed != null) {
            if (note.writable) {
                OutlinedTextField(title, { title = it }, label = { Text("标题") },
                    singleLine = true, enabled = !uploadingImage && !saving,
                    modifier = Modifier.fillMaxWidth())
                Row {
                    TextButton(onClick = { preview = !preview }) {
                        Text(if (preview) "编辑 Markdown" else "预览 Markdown")
                    }
                    TextButton(onClick = { scope.launch { save() } },
                        enabled = dirty && !conflict && !saving && !uploadingImage) { Text("保存") }
                    TextButton(onClick = { imagePicker.launch(arrayOf("image/*")) },
                        enabled = !uploadingImage && !saving && !conflict,
                        modifier = Modifier.testTag("native-notes-insert-image")) {
                        Text(if (uploadingImage) "正在上传图片…" else "插入图片")
                    }
                    TextButton(onClick = { deleting = true }, enabled = !uploadingImage) {
                        Text("删除")
                    }
                }
            } else Text(title, style = MaterialTheme.typography.titleLarge)
            Row {
                Text("版本 " + committed!!.row.revision, modifier = Modifier.weight(1f))
                TextButton(onClick = { history = true }) { Text("历史版本") }
            }
            if (preview || !note.writable) {
                NativeNotesMarkdownPreview(controller, note.id, owner.nativeUiSessionId,
                    markdown, Modifier.weight(1f))
            } else {
                OutlinedTextField(markdown, { markdown = it },
                    label = { Text("Markdown 正文") }, enabled = !uploadingImage && !saving,
                    modifier = Modifier.fillMaxWidth().weight(1f).testTag("native-notes-markdown"),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
            }
        } else Text("正在验证笔记内容…")
    }
}

private data class NativeNoteLine(
    val text: String, val kind: Int, val imagePath: String? = null,
)

@Composable
private fun NativeNotesMarkdownPreview(
    controller: DriveController, noteID: String, ownerEpoch: Long,
    markdown: String, modifier: Modifier = Modifier,
) {
    // Render only immutable same-note _assets references. Untrusted Markdown
    // and code text never initiate network requests.
    val lines = remember(markdown, noteID) {
        var fenced = false
        val images = Regex("""!\[([^\]\r\n]{0,180})\]\(([^)\r\n]{1,220})\)""")
        buildList {
            for (line in markdown.replace("\r\n", "\n").lines()) {
                when {
                    line.startsWith(96.toChar().toString().repeat(3)) ||
                        line.startsWith("~~~") -> fenced = !fenced
                    fenced -> add(NativeNoteLine(line, 3))
                    else -> {
                        val matches = images.findAll(line).toList()
                        if (matches.isEmpty()) {
                            add(when {
                                line.startsWith("# ") -> NativeNoteLine(line.drop(2), 1)
                                line.startsWith("## ") -> NativeNoteLine(line.drop(3), 2)
                                line.startsWith("- ") -> NativeNoteLine("• " + line.drop(2), 0)
                                else -> NativeNoteLine(line, 0)
                            })
                        } else {
                            var cursor = 0
                            for (match in matches) {
                                if (match.range.first > cursor)
                                    add(NativeNoteLine(line.substring(cursor, match.range.first), 0))
                                val path = match.groupValues[2]
                                if (validNotesImagePath(noteID, path)) {
                                    add(NativeNoteLine(match.groupValues[1], 4, path))
                                } else {
                                    add(NativeNoteLine(match.value, 0))
                                }
                                cursor = match.range.last + 1
                            }
                            if (cursor < line.length)
                                add(NativeNoteLine(line.substring(cursor), 0))
                        }
                    }
                }
            }
        }
    }
    LazyColumn(modifier.testTag("native-notes-preview")) {
        items(lines) { line ->
            if (line.imagePath != null) {
                NativeNotesImage(controller, noteID, ownerEpoch, line.imagePath,
                    line.text.ifBlank { "笔记图片" })
            } else {
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
}

@Composable
private fun NativeNotesImage(
    controller: DriveController, noteID: String, ownerEpoch: Long,
    path: String, alt: String,
) {
    var bitmap by remember(noteID, path, ownerEpoch) { mutableStateOf<ImageBitmap?>(null) }
    var error by remember(noteID, path, ownerEpoch) { mutableStateOf<String?>(null) }
    LaunchedEffect(noteID, path, ownerEpoch) {
        try {
            val bytes = controller.notesImage(noteID, path)
            val decoded = withContext(Dispatchers.Default) {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0)
                    throw IOException("图片格式不受设备支持")
                var sample = 1
                while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048)
                    sample *= 2
                val options = BitmapFactory.Options().apply {
                    inSampleSize = sample
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                    ?.asImageBitmap() ?: throw IOException("图片解码失败")
            }
            if (controller.state.value.nativeUiSessionId == ownerEpoch)
                bitmap = decoded
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (controller.state.value.nativeUiSessionId == ownerEpoch)
                error = "当前图片无法预览"
        }
    }
    Column(Modifier.fillMaxWidth().testTag("native-notes-image")) {
        when {
            bitmap != null -> Image(
                bitmap = requireNotNull(bitmap), contentDescription = alt,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp),
            )
            error != null -> Text(alt + " · " + error,
                color = MaterialTheme.colorScheme.error)
            else -> LinearProgressIndicator(Modifier.fillMaxWidth())
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
