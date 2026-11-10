package com.tfluid.xdrive

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private data class DirectedClipboardPending(
    val payload: String, val deviceID: String, val kind: String,
    val nodeID: Long, val createdAt: Long, val wire: XDriveClipboardWrite,
)

/** Native, foreground-only Clipboard text mailbox. No automatic pasteboard
 * monitor, WebView, stored passwords or auxiliary Owner credential.
 */
@Composable
internal fun NativeClipboardScreen(
    controller: DriveController,
    incomingText: String? = null,
    onIncomingConsumed: () -> Unit = {},
    onOpenReferencedFile: (Long) -> Unit = {},
) {
    val state by controller.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val clipboard = remember(context) {
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }
    val scope = rememberCoroutineScope()
    val epoch = state.nativeUiSessionId
    val actionFence = remember(epoch) { XDriveClipboardSessionFence() }
    var draft by remember(epoch) { mutableStateOf("") }
    // Only the verified device identity stays in ephemeral UI state.
    var recipient by remember(epoch) { mutableStateOf<NativeClipboardRecipient?>(null) }
    var list by remember(epoch) { mutableStateOf(emptyList<Pair<OwnerClipboardItem, String?>>()) }
    var pending by remember(epoch) { mutableStateOf<Triple<String, Long, XDriveClipboardWrite>?>(null) }
    var requireAbandon by remember(epoch) { mutableStateOf(false) }
    var devices by remember(epoch) { mutableStateOf(emptyList<OwnerClipboardDevice>()) }
    var targetID by remember(epoch) { mutableStateOf("") }
    var targetMenu by remember(epoch) { mutableStateOf(false) }
    var referenceKind by remember(epoch) { mutableStateOf("text") }
    var referenceNodeID by remember(epoch) { mutableStateOf("") }
    var pickerIntent by remember(epoch) { mutableStateOf<Triple<Long, String, String>?>(null) }
    var pendingDirected by remember(epoch) { mutableStateOf<DirectedClipboardPending?>(null) }
    var busy by remember(epoch) { mutableStateOf(false) }
    var message by remember(epoch) { mutableStateOf<String?>(null) }
    var clearConfirm by remember(epoch) { mutableStateOf(false) }
    var refreshing by remember(epoch) { mutableStateOf(false) }

    fun stillOwner() = controller.state.value.nativeUiSessionId == epoch &&
        controller.state.value.server == state.server &&
        controller.state.value.username == state.username &&
        epoch > 0
    fun stillSession(snapshot: Long) = stillOwner() && actionFence.accepts(snapshot)
    fun lock() {
        actionFence.invalidate()
        recipient = null
        draft = ""
        list = emptyList()
        pending = null
        pendingDirected = null
        requireAbandon = false
        devices = emptyList()
        targetID = ""
        targetMenu = false
        referenceKind = "text"
        referenceNodeID = ""
        pickerIntent = null
        busy = false
        refreshing = false
        message = null
        clearConfirm = false
    }
    DisposableEffect(epoch) {
        // Disposal must both invalidate late work and drop all decrypted
        // UI state and Owner-scoped history, not just invalidate its callbacks.
        onDispose { lock() }
    }
    suspend fun refresh() {
        if (refreshing || !stillOwner()) return
        val snapshot = actionFence.capture()
        refreshing = true
        try {
            val page = controller.clipboardList(recipient = recipient)
            if (stillSession(snapshot)) {
                list = page.items.map { item ->
                    item to item.content.takeIf { clear ->
                        item.nodeID == 0L || clear == "asset:" + item.nodeID
                    }
                }
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (stillSession(snapshot)) message = e.message ?: "剪贴板读取失败"
        } finally {
            if (stillSession(snapshot)) refreshing = false
        }
    }
    // Recipient discovery has no device token: only the current interactive
    // Owner may read public keys. Discard late results on Lock or A→B→A.
    // A single scoped recipient-directory GET on each visible foreground
    // entry. Lifecycle STOP cancels it; there is NO background polling.
    LaunchedEffect(epoch, lifecycleOwner) {
                lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (!stillOwner() ) return@repeatOnLifecycle
            val snapshot = actionFence.capture()
            try {
                val received = controller.clipboardDevices()
                if (stillSession(snapshot) ) {
                    devices = received
                    if (targetID.isNotEmpty() && received.none { it.deviceID == targetID }) {
                        targetID = ""
                        referenceNodeID = ""
                    }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                if (stillSession(snapshot)) devices = emptyList()
            }
        }
    }

    // Inactive/background activities must not keep either a polling job or
    // the Owner SSE socket alive. Resume always reconciles full GET first.
    LaunchedEffect(epoch, recipient?.enrolled?.deviceId, lifecycleOwner) {
                val snapshot = actionFence.capture()
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (stillOwner() ) refresh()
            while (stillSession(snapshot) ) {
                delay(15_000)
                if (!stillSession(snapshot) ) break
                refresh()
            }
        }
    }
    LaunchedEffect(epoch, recipient?.enrolled?.deviceId, lifecycleOwner) {
                val snapshot = actionFence.capture()
        var after = 0L // Never persist across Owner epochs.
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (stillOwner() ) refresh()
            while (stillSession(snapshot) ) {
                try {
                    val currentRecipient = recipient
                    val invalidation: suspend () -> Unit = {
                        withContext(Dispatchers.Main.immediate) {
                            if (stillSession(snapshot) ) refresh()
                        }
                    }
                    after = if (currentRecipient == null) {
                        controller.clipboardWatch(after) { invalidation() }
                    } else {
                        controller.clipboardWatchForRecipient(after, currentRecipient) { invalidation() }
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // Unsupported/failed SSE never disables the 15s fallback.
                }
                if (!stillSession(snapshot) ) break
                refresh() // Disconnect/cursor eviction: full Owner GET.
                delay(3_000)
            }
        }
    }
    LaunchedEffect(epoch, incomingText) {
        if (!incomingText.isNullOrBlank() && stillOwner() &&
            incomingText.toByteArray(Charsets.UTF_8).size <= 65536) {
            // ACTION_SEND only populates draft; send requires an explicit tap.
            draft = incomingText
            onIncomingConsumed()
        }
    }
    // A provider picker can return after Owner switch, Lock, or new target
    // selection. A callback is NEVER itself permission to send a message.
    val localFilePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val intent = pickerIntent
        pickerIntent = null
        if (uri != null && intent != null && stillSession(intent.first) &&
            targetID == intent.second && referenceKind == intent.third &&
            !busy) {
            val (snapshot, selectedTarget, selectedKind) = intent
            referenceNodeID = ""
            busy = true
            scope.launch {
                try {
                    val result = controller.clipboardImportLocalFile(context, uri) {
                        stillSession(snapshot)  &&
                            targetID == selectedTarget && referenceKind == selectedKind
                    }
                    if (stillSession(snapshot) && targetID == selectedTarget &&
                        referenceKind == selectedKind) {
                        referenceNodeID = result.id.toString()
                        message = "文件已有已核验的 CAS Node 收据。请核对后再次点击定向发送。"
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    if (stillSession(snapshot)) {
                        referenceNodeID = ""
                        message = "上传未确认：" + (error.message ?: "请先查看 Files 目录，勿自动重传。")
                    }
                } finally {
                    if (stillSession(snapshot)) busy = false
                }
            }
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("剪贴板", style = MaterialTheme.typography.headlineSmall)
        Text("剪贴板不加密，Server 明文保存最多 24 小时；请勿发送密码或验证码。系统剪贴板只在点击后读取或写入。",
            style = MaterialTheme.typography.bodySmall)
        if (message != null) Text(message!!,color = MaterialTheme.colorScheme.error,
            modifier=Modifier.testTag("native-clipboard-status"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { scope.launch { refresh() } },enabled=!busy && !refreshing) {
                    Text("刷新")
                }
            }
            if (recipient == null) {
                OutlinedButton(onClick = {
                    if (busy ) return@OutlinedButton
                    val snapshot = actionFence.capture()
                    busy = true
                    scope.launch {
                        var received: NativeClipboardRecipient? = null
                        try {
                            if (!stillSession(snapshot)) return@launch
                            received = controller.clipboardEnableRecipient(context)
                            if (stillSession(snapshot)) {
                                recipient = received
                                received = null
                                message = "此设备已启用单独授权的 Clipboard 定向接收"
                                refresh()
                            }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) {
                            if (stillSession(snapshot)) message = e.message ?: "设备接收授权失败"
                        } finally {
                            if (stillSession(snapshot)) busy = false
                        }
                    }
                }, enabled = !busy) { Text("启用设备定向接收（需已注册设备）") }
            } else {
                Text("此 Android 设备已启用单独授权的定向接收",
                    style = MaterialTheme.typography.bodySmall)
            }
            // Target selection is explicit. A directed v2 message must never
            // be passed to the v1 broadcast send branch.
            Box {
                OutlinedButton(onClick={targetMenu=true},enabled=!busy) {
                    Text(if (targetID.isEmpty()) "发送范围：当前账号广播" else
                        "定向发送：" + (devices.firstOrNull { it.deviceID == targetID }?.name ?: "设备已失效"))
                }
                DropdownMenu(expanded=targetMenu,onDismissRequest={targetMenu=false}) {
                    DropdownMenuItem(text={Text("当前 Owner 广播")},onClick={
                        targetID="";targetMenu=false;referenceKind="text";referenceNodeID=""
                    })
                    devices.forEach { device ->
                        DropdownMenuItem(text={Text(device.name+" · "+device.platform)},onClick={
                            targetID=device.deviceID;targetMenu=false
                            referenceKind="text";referenceNodeID=""
                        })
                    }
                }
            }
            if (targetID.isNotEmpty()) {
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("text" to "文字", "image" to "图片引用", "file" to "文件引用").forEach { pair ->
                        FilterChip(selected=referenceKind==pair.first,
                            onClick={
                                if (referenceKind != pair.first) {
                                    referenceKind = pair.first
                                    referenceNodeID = ""
                                }
                            },label={Text(pair.second)},
                            enabled=!busy)
                    }
                }
                if (referenceKind!="text") {
                    OutlinedTextField(value=referenceNodeID,
                        onValueChange={referenceNodeID=it.take(20).filter(Char::isDigit)},
                        modifier=Modifier.fillMaxWidth(),singleLine=true,
                        label={Text("已上传 CAS 的文件 Node ID")},
                        keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
                    Text("只发送已存在的云端 Node 引用，不增加文件权限。",
                        style=MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick={
                        if (busy  || targetID.isEmpty() ||
                            pending != null || pendingDirected != null) return@OutlinedButton
                        pickerIntent = Triple(actionFence.capture(), targetID, referenceKind)
                        localFilePicker.launch(arrayOf(
                            if (referenceKind == "image") "image/*" else "*/*"))
                    }, enabled = !busy && pending == null && pendingDirected == null) {
                        Text("选择本机文件并上传 CAS（不会自动发送）")
                    }
                }
            }
            OutlinedTextField(value=draft,onValueChange={ draft=it; requireAbandon=false },
                modifier=Modifier.fillMaxWidth().heightIn(min=100.dp),
                label={Text("文字或链接")},maxLines=7)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick={
                    val text=clipboard.primaryClip?.takeIf{it.itemCount>0}
                        ?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (text!=null) draft=text else message="本机没有可读取的文本"
                },enabled=!busy){Text("粘贴本机")}
                Button(onClick={
                    if (busy || pendingDirected != null || targetID.isNotEmpty()) {
                        requireAbandon = pendingDirected != null
                        return@Button
                    }
                    val snapshot = actionFence.capture()
                                                            val textAtStart = draft
                    busy = true
                    scope.launch {
                        try {
                            if (!stillSession(snapshot)) return@launch
                            val wire = if (pending != null) {
                                val previous = requireNotNull(pending)
                                if (previous.first != textAtStart) {
                                    requireAbandon = true
                                    error("上一条发送回执未确认，请核对历史后放弃旧回执。")
                                }
                                val elapsed = System.currentTimeMillis() - previous.second
                                if (elapsed !in 0 until 300_000L) {
                                    requireAbandon = true
                                    error("原回执已超出 5 分钟安全重试期限。")
                                }
                                previous.third
                            } else {
                                val plain = XDriveClipboardWrite(
                                    java.util.UUID.randomUUID().toString(),
                                    if (textAtStart.trim().matches(Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)))
                                        "text/uri-list" else "text/plain",
                                    textAtStart)
                                require(plain.valid())
                                pending = Triple(textAtStart, System.currentTimeMillis(), plain)
                                plain
                            }
                            if (!stillSession(snapshot)) return@launch
                            controller.clipboardCreate(wire)
                            if (stillSession(snapshot)) {
                                pending = null
                                if (draft == textAtStart) draft = "" // Preserve newer input.
                                message = "已发送到当前账号"
                                refresh()
                            }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) {
                            if (stillSession(snapshot)) {
                                message = "发送未确认：${e.message ?: "请核对历史"}"
                            }
                        } finally {
                            if (stillSession(snapshot)) busy = false
                        }
                    }
                },enabled=!busy && draft.isNotEmpty() && targetID.isEmpty() &&
                    pendingDirected == null){Text("发送")}
            }
            if (targetID.isNotEmpty()) {
                Button(onClick={
                    if (busy ) return@Button
                    val snapshot = actionFence.capture()
                                        val target = targetID
                    val device = devices.firstOrNull { it.deviceID == target }
                    val kind = when(referenceKind) {
                        "image" -> "image/x-xdrive-node-ref"
                        "file" -> "application/x-xdrive-node-ref"
                        else -> if (draft.trim().matches(Regex("^https?://\\S+$", RegexOption.IGNORE_CASE))) "text/uri-list" else "text/plain"
                    }
                    val node = if (referenceKind == "text") 0L else referenceNodeID.toLongOrNull() ?: 0L
                    val clear = if (node > 0L) "asset:"+node else draft
                    if (device == null || (referenceKind != "text" && node <= 0) ||
                        (referenceKind == "text" && clear.isEmpty())) {
                        message="请选择有效的已登记设备、文本或原始 CAS Node。"
                        return@Button
                    }
                    if (pending != null) {
                        requireAbandon = true
                        message="广播消息回执未确认；请先核对或放弃，不能切换到定向发送。"
                        return@Button
                    }
                    busy = true
                    scope.launch {
                        try {
                            val previous = pendingDirected
                            val wire = if (previous != null) {
                                val age = System.currentTimeMillis() - previous.createdAt
                                if (age !in 0 until 300_000L ||
                                    previous.payload != clear || previous.deviceID != target ||
                                    previous.kind != kind || previous.nodeID != node) {
                                    requireAbandon = true
                                    error("旧定向回执未知：必须核对历史或明确放弃，不能改变投递目标。")
                                }
                                previous.wire
                            } else {
                                XDriveClipboardWrite(
                                    java.util.UUID.randomUUID().toString(), kind, clear, target, node
                                ).also {
                                    if (stillSession(snapshot)) pendingDirected = DirectedClipboardPending(
                                        clear,target,kind,node,System.currentTimeMillis(),it)
                                }
                            }
                            if (!stillSession(snapshot) || pendingDirected?.wire != wire)
                                return@launch
                            controller.clipboardCreate(wire)
                            if (stillSession(snapshot)) {
                                pendingDirected=null
                                if (referenceKind=="text" && draft==clear) draft=""
                                message="已将内容定向发送到所选设备。"
                                refresh()
                            }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) {
                            if (stillSession(snapshot)) message="定向发送回执未知："+
                                (e.message ?: "请检查历史，不能盲目重传")
                        } finally {
                            if (stillSession(snapshot)) busy=false
                        }
                    }
                },enabled=!busy && devices.any { it.deviceID==targetID }) {
                    Text("定向发送")
                }
            }
            if (requireAbandon && (pending != null || pendingDirected != null)) {
                TextButton(onClick={
                    pending=null
                    pendingDirected=null
                    requireAbandon=false
                    message="已放弃旧回执。请先核对历史，再尝试新的发送。"
                }) { Text("放弃不确定回执") }
            }
            if (requireAbandon && pending != null) {
                TextButton(onClick={
                    pending=null
                    requireAbandon=false
                    message="已放弃旧回执。请先核对历史，再发送新内容。"
                }){Text("放弃待确认回执")}
            }
            Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("最近内容",style=MaterialTheme.typography.titleMedium)
                if (refreshing) CircularProgressIndicator(Modifier.size(20.dp))
                Spacer(Modifier.weight(1f))
                TextButton(onClick={clearConfirm=true},enabled=!busy && list.isNotEmpty()) {
                    Text("清空")
                }
            }
            LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)) {
                items(list,key={it.first.id}) { (item,plain) ->
                    ElevatedCard(modifier=Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                            Text(when (item.kind) {
                                "text/uri-list" -> "链接"
                                "image/x-xdrive-node-ref" -> "云端图片引用"
                                "application/x-xdrive-node-ref" -> "云端文件引用"
                                else -> "文本"
                            }, style=MaterialTheme.typography.labelSmall)
                            if (plain==null) Text("此条消息无效或无访问权限。",
                                color=MaterialTheme.colorScheme.error)
                            else {
                                if (item.nodeID > 0L) {
                                    Text("云端文件 #${item.nodeID} · 原件仍在 Files/CAS",
                                        maxLines = 2)
                                    TextButton(onClick = {
                                        if (busy  || plain != "asset:${item.nodeID}")
                                            return@TextButton
                                        onOpenReferencedFile(item.nodeID)
                                    }, enabled = !busy && plain == "asset:${item.nodeID}") {
                                        Text("在文件查看器中打开")
                                    }
                                } else {
                                    Text(plain, maxLines = 7)
                                    TextButton(onClick = {
                                        clipboard.setPrimaryClip(ClipData.newPlainText("xDrive", plain))
                                        message = "已复制到本机剪贴板"
                                    }) { Text("复制到本机") }
                                }
                            }
                            TextButton(onClick={
                                if (busy ) return@TextButton
                                val snapshot = actionFence.capture()
                                busy = true
                                scope.launch {
                                    try {
                                        if (!stillSession(snapshot)) return@launch
                                        controller.clipboardDelete(item.id)
                                        if (stillSession(snapshot) ) {
                                            list = list.filterNot { it.first.id == item.id }
                                        }
                                    } catch (e: CancellationException) { throw e }
                                    catch (e: Exception) {
                                        if (stillSession(snapshot)) message = e.message
                                    } finally {
                                        if (stillSession(snapshot)) busy = false
                                    }
                                }
                            },enabled=!busy){Text("删除")}
                        }
                    }
                }
            }
    }
    if(clearConfirm) AlertDialog(onDismissRequest={clearConfirm=false},
        title={Text("清空剪贴板历史？")},text={Text("不可撤销。")},
        confirmButton={TextButton(onClick={
            if (busy ) return@TextButton
            clearConfirm = false
            val snapshot = actionFence.capture()
            busy = true
            scope.launch {
                try {
                    if (!stillSession(snapshot)) return@launch
                    controller.clipboardClear()
                    if (stillSession(snapshot) ) list = emptyList()
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    if (stillSession(snapshot)) message = e.message
                } finally {
                    if (stillSession(snapshot)) busy = false
                }
            }
        }){Text("确认清空")}},
        dismissButton={TextButton(onClick={clearConfirm=false}){Text("取消")}})
}
