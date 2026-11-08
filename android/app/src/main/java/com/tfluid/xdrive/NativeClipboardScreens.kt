package com.tfluid.xdrive

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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

/** Native, foreground-only Clipboard text mailbox. No automatic pasteboard
 * monitor, WebView, stored passphrase/key or auxiliary Owner credential.
 */
@Composable
internal fun NativeClipboardScreen(
    controller: DriveController,
    incomingText: String? = null,
    onIncomingConsumed: () -> Unit = {},
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
        requireAbandon = false
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
                    if (busy) return@Button
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
                },enabled=!busy && draft.isNotEmpty()){Text("加密发送")}
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
                                Text(if (item.nodeID > 0L)
                                    "已接收云端文件 #${item.nodeID} 的加密引用，原件仍由 Files/CAS 管理。"
                                    else plain, maxLines = 7)
                                if (item.nodeID == 0L) {
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
