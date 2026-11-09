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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URI
import javax.crypto.spec.SecretKeySpec

private data class DirectedClipboardPending(
    val payload: String, val deviceID: String, val kind: String,
    val nodeID: Long, val createdAt: Long, val wire: XDriveClipboardTargetCrypto.Wire,
)

/** Native, foreground-only Clipboard text mailbox. No automatic pasteboard
 * monitor, WebView, stored passphrase/key or auxiliary Owner credential.
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
    var password by remember(epoch) { mutableStateOf("") }
    var draft by remember(epoch) { mutableStateOf("") }
    var key by remember(epoch) { mutableStateOf<SecretKeySpec?>(null) }
    // The Keychain/Keystore never enters Compose. This transient recipient
    // is wiped on Lock, Owner switch or route disposal.
    var recipient by remember(epoch) { mutableStateOf<NativeClipboardRecipient?>(null) }
    var aadScope by remember(epoch) { mutableStateOf("") }
    var list by remember(epoch) { mutableStateOf(emptyList<Pair<OwnerClipboardItem, String?>>()) }
    var pending by remember(epoch) { mutableStateOf<Triple<String, Long, XDriveClipboardCrypto.Wire>?>(null) }
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
        recipient?.erase()
        recipient = null
        key = null
        aadScope = ""
        password = ""
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
        // UI state/derived-key references, not just invalidate its callbacks.
        onDispose { lock() }
    }
    suspend fun refresh() {
        val localKey = key ?: return
        val scopeAtStart = aadScope
        if (refreshing || scopeAtStart.isEmpty()) return
        val snapshot = actionFence.capture()
        if (!stillSession(snapshot)) return
        refreshing = true
        try {
            val currentRecipient = recipient
            val page = controller.clipboardList(recipient = currentRecipient)
            val decoded = withContext(Dispatchers.Default) {
                page.items.map { item ->
                    val plain = runCatching {
                        if (item.targetDeviceID == null) {
                            XDriveClipboardCrypto.decrypt(item.wire, localKey, scopeAtStart)
                        } else {
                            require(currentRecipient != null &&
                                item.targetDeviceID == currentRecipient.enrolled.deviceId)
                            XDriveClipboardTargetCrypto.decrypt(scopeAtStart,
                                currentRecipient.enrolled.deviceId,
                                currentRecipient.privatePKCS8,
                                requireNotNull(item.targetedWire()))
                        }
                    }.getOrNull()
                    item to plain
                }
            }
            if (stillSession(snapshot) && key === localKey) list = decoded
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (stillSession(snapshot)) message = e.message ?: "剪贴板读取失败"
        } finally {
            if (stillSession(snapshot)) refreshing = false
        }
    }
    // Recipient discovery has no device token: only the current interactive
    // Owner may read public keys. Discard late results on Lock or A→B→A.
    // One-shot public recipient discovery. No background polling or OS clipboard read.
    LaunchedEffect(epoch, key, "recipient-directory") {
        if (key == null) return@LaunchedEffect
        val snapshot = actionFence.capture()
        try {
            val received = controller.clipboardDevices()
            if (stillSession(snapshot) && key != null) {
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

    // Inactive/background activities must not keep either a polling job or
    // the Owner SSE socket alive. Resume always reconciles full GET first.
    LaunchedEffect(epoch, key, recipient?.enrolled?.deviceId, lifecycleOwner) {
        if (key == null) return@LaunchedEffect
        val snapshot = actionFence.capture()
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (stillOwner() && key != null) refresh()
            while (stillSession(snapshot) && key != null) {
                delay(15_000)
                if (!stillSession(snapshot) || key == null) break
                refresh()
            }
        }
    }
    LaunchedEffect(epoch, key, recipient?.enrolled?.deviceId, lifecycleOwner) {
        if (key == null) return@LaunchedEffect
        val snapshot = actionFence.capture()
        var after = 0L // Only in-memory for the current unlock/Owner epoch.
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            if (stillOwner() && key != null) refresh()
            while (stillSession(snapshot) && key != null) {
                try {
                    val currentRecipient = recipient
                    val invalidation: suspend () -> Unit = {
                        withContext(Dispatchers.Main.immediate) {
                            if (stillSession(snapshot) && key != null) refresh()
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
                if (!stillSession(snapshot) || key == null) break
                refresh() // Disconnect/cursor eviction: full Owner GET.
                delay(3_000)
            }
        }
    }
    LaunchedEffect(epoch, incomingText) {
        if (!incomingText.isNullOrBlank() && stillOwner() &&
            incomingText.toByteArray(Charsets.UTF_8).size <= XDriveClipboardCrypto.MAX_TEXT_BYTES) {
            // ACTION_SEND only populates draft. The user must unlock and tap
            // Send explicitly; no automatic cross-device transmission.
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
            key != null && !busy) {
            val (snapshot, selectedTarget, selectedKind) = intent
            referenceNodeID = ""
            busy = true
            scope.launch {
                try {
                    val result = controller.clipboardImportLocalFile(context, uri) {
                        stillSession(snapshot) && key != null &&
                            targetID == selectedTarget && referenceKind == selectedKind
                    }
                    if (stillSession(snapshot) && targetID == selectedTarget &&
                        referenceKind == selectedKind) {
                        referenceNodeID = result.id.toString()
                        message = "文件已有已核验的 CAS Node 收据。请核对后再次点击定向加密发送。"
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
        Text("当前账号的加密文本收件箱。系统剪贴板只在点击后读取或写入。",
            style = MaterialTheme.typography.bodySmall)
        if (message != null) Text(message!!,color = MaterialTheme.colorScheme.error,
            modifier=Modifier.testTag("native-clipboard-status"))
        if (key == null) {
            OutlinedTextField(value = password, onValueChange = { password = it.take(256) },
                label = { Text("独立剪贴板口令") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            Button(onClick = {
                if (busy) return@Button
                val snapshot = actionFence.capture()
                val passwordAtStart = password
                busy = true
                scope.launch {
                    try {
                        if (!stillSession(snapshot)) return@launch
                        val vault = controller.clipboardVault()
                        val localKey = withContext(Dispatchers.Default) {
                            XDriveClipboardCrypto.deriveKey(passwordAtStart, vault.salt)
                        }
                        val origin = URI(state.server)
                        require(origin.scheme == "https" && origin.rawUserInfo == null &&
                            !origin.host.isNullOrBlank() && vault.ownerID > 0)
                        val claimed = origin.scheme + "://" + origin.rawAuthority + ":" + vault.ownerID
                        val verifiedScope = if (vault.checkCiphertext.isBlank()) {
                            val check = XDriveClipboardCrypto.newCheck(localKey, claimed)
                            if (!stillSession(snapshot)) return@launch
                            val pinned = controller.clipboardCheck(check.nonce, check.ciphertext, claimed)
                            XDriveClipboardCrypto.verifyCheck(localKey, pinned.aadScope,
                                pinned.checkNonce, pinned.checkCiphertext)
                            pinned.aadScope
                        } else {
                            require(vault.aadScope.isNotEmpty()) {
                                "旧版加密历史需先在原始浏览器解锁并固定范围。"
                            }
                            XDriveClipboardCrypto.verifyCheck(localKey, vault.aadScope,
                                vault.checkNonce, vault.checkCiphertext)
                            vault.aadScope
                        }
                        if (stillSession(snapshot) && key == null) {
                            key = localKey
                            aadScope = verifiedScope
                            password = ""
                            message = null
                            refresh()
                        }
                    } catch (e: CancellationException) { throw e }
                    catch (e: Exception) {
                        if (stillSession(snapshot)) message = e.message ?: "无法解锁"
                    } finally {
                        if (stillSession(snapshot)) busy = false
                    }
                }
            },enabled = password.length >= 12 && !busy) { Text("解锁") }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { lock() }) { Text("锁定") }
                OutlinedButton(onClick = { scope.launch { refresh() } },enabled=!busy && !refreshing) {
                    Text("刷新")
                }
            }
            if (recipient == null) {
                OutlinedButton(onClick = {
                    if (busy || key == null) return@OutlinedButton
                    val snapshot = actionFence.capture()
                    val localKey = key
                    busy = true
                    scope.launch {
                        var received: NativeClipboardRecipient? = null
                        try {
                            if (!stillSession(snapshot)) return@launch
                            received = controller.clipboardEnableRecipient(context)
                            if (stillSession(snapshot) && key === localKey) {
                                recipient = received
                                received = null
                                message = "此设备已启用单独授权的 Clipboard 定向接收"
                                refresh()
                            }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) {
                            if (stillSession(snapshot)) message = e.message ?: "设备接收授权失败"
                        } finally {
                            received?.erase()
                            if (stillSession(snapshot)) busy = false
                        }
                    }
                }, enabled = !busy) { Text("启用设备定向接收（需已注册设备）") }
            } else {
                Text("此 Android 设备已启用单独授权的定向解密",
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
                    DropdownMenuItem(text={Text("当前 Owner 广播（v1 文本）")},onClick={
                        targetID="";targetMenu=false;referenceKind="text";referenceNodeID=""
                    })
                    devices.forEach { device ->
                        DropdownMenuItem(text={Text(device.name+" · "+device.platform)},onClick={
                            targetID=device.deviceID;targetMenu=false
                        })
                    }
                }
            }
            if (targetID.isNotEmpty()) {
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    listOf("text" to "文字", "image" to "图片引用", "file" to "文件引用").forEach { pair ->
                        FilterChip(selected=referenceKind==pair.first,
                            onClick={referenceKind=pair.first},label={Text(pair.second)},
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
                        if (busy || key == null || targetID.isEmpty() ||
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
                    val keyAtStart = key ?: return@Button
                    val scopeAtStart = aadScope
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
                                val encrypted = XDriveClipboardCrypto.encrypt(
                                    textAtStart, keyAtStart, scopeAtStart)
                                pending = Triple(textAtStart, System.currentTimeMillis(), encrypted)
                                encrypted
                            }
                            if (!stillSession(snapshot)) return@launch
                            controller.clipboardCreate(wire)
                            if (stillSession(snapshot) && key === keyAtStart) {
                                pending = null
                                if (draft == textAtStart) draft = "" // Preserve newer input.
                                message = "已加密发送到当前账号"
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
                    pendingDirected == null){Text("加密发送")}
            }
            if (targetID.isNotEmpty()) {
                Button(onClick={
                    if (busy || key == null) return@Button
                    val snapshot = actionFence.capture()
                    val scopeAtStart = aadScope
                    val target = targetID
                    val device = devices.firstOrNull { it.deviceID == target }
                    val kind = when(referenceKind) {
                        "image" -> "image/x-xdrive-node-ref"
                        "file" -> "application/x-xdrive-node-ref"
                        else -> XDriveClipboardCrypto.mediaKind(draft)
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
                                withContext(Dispatchers.Default) {
                                    XDriveClipboardTargetCrypto.encrypt(
                                        scopeAtStart, target, device.publicKey, kind, clear, node)
                                }.also {
                                    if (stillSession(snapshot)) pendingDirected = DirectedClipboardPending(
                                        clear,target,kind,node,System.currentTimeMillis(),it)
                                }
                            }
                            if (!stillSession(snapshot) || pendingDirected?.wire != wire)
                                return@launch
                            controller.clipboardCreateDirected(wire)
                            if (stillSession(snapshot)) {
                                pendingDirected=null
                                if (referenceKind=="text" && draft==clear) draft=""
                                message="已将加密内容定向发送到所选设备。"
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
                    Text("定向加密发送")
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
                            if (plain==null) Text("此条消息无法解密。",
                                color=MaterialTheme.colorScheme.error)
                            else {
                                if (item.nodeID > 0L) {
                                    Text("云端文件 #${item.nodeID} · 原件仍在 Files/CAS",
                                        maxLines = 2)
                                    TextButton(onClick = {
                                        if (busy || key == null || plain != "asset:${item.nodeID}")
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
                                if (busy || key == null) return@TextButton
                                val snapshot = actionFence.capture()
                                busy = true
                                scope.launch {
                                    try {
                                        if (!stillSession(snapshot)) return@launch
                                        controller.clipboardDelete(item.id)
                                        if (stillSession(snapshot) && key != null) {
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
    }
    if(clearConfirm) AlertDialog(onDismissRequest={clearConfirm=false},
        title={Text("清空剪贴板历史？")},text={Text("不可撤销。")},
        confirmButton={TextButton(onClick={
            if (busy || key == null) return@TextButton
            clearConfirm = false
            val snapshot = actionFence.capture()
            busy = true
            scope.launch {
                try {
                    if (!stillSession(snapshot)) return@launch
                    controller.clipboardClear()
                    if (stillSession(snapshot) && key != null) list = emptyList()
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
