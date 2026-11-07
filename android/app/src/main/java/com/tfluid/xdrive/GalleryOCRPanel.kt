package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.tfluid.xdrive.core.GalleryAsset
import com.tfluid.xdrive.core.PhotoOCR
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@Composable
internal fun GalleryOCRPanel(photo: GalleryAsset, controller: DriveController) {
    var result by remember { mutableStateOf<PhotoOCR?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var confirm by remember { mutableStateOf(false) }
    var attempted by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    var revoked by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                revoked = true
                result = null
                notice = ""
                confirm = false
                scope.cancel()
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(reload, revoked) {
        if (revoked) return@LaunchedEffect
        loading = true
        error = false
        result = null
        try { result = controller.galleryOCR(photo) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = true }
        finally { loading = false }
    }
    if (revoked) {
        Text("请重新打开照片信息以读取 OCR")
        return
    }
    Column(Modifier.testTag("gallery-ocr"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("识别文字（OCR）", style = MaterialTheme.typography.titleSmall)
        Text(if (loading) "正在读取识别结果…" else if (error) "读取失败，请刷新重试"
            else result?.message ?: "暂无 OCR 结果，请检查服务器模型配置")
        val text = result?.takeIf { it.state == "ready" }?.text.orEmpty()
        if (text.isNotBlank()) {
            SelectionContainer { Text(text) }
            TextButton(onClick = { clipboard.setText(AnnotatedString(text)); notice = "已复制" }) {
                Text("复制文字")
            }
        }
        TextButton(onClick = { reload++ }, enabled = !loading) { Text("刷新识别结果") }
        TextButton(onClick = { confirm = true }, enabled = !loading && !attempted) {
            Text("重新识别云端图库")
        }
        if (notice.isNotEmpty()) Text(notice)
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false },
        title = { Text("重新识别云端图库？") },
        text = { Text("对当前账号的全部云端照片重新进行 OCR 和物体识别，任务在服务器后台执行。不会修改照片原件。") },
        confirmButton = { TextButton(onClick = {
            confirm = false
            attempted = true
            notice = "正在提交…"
            scope.launch {
                try {
                    controller.reanalyzeGalleryOCR(photo)
                    notice = "已加入后台队列；稍后刷新查看实际识别结果"
                    reload++
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { notice = "提交未确认，请先刷新状态；不会自动重复提交" }
            }
        }) { Text("重新识别") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("取消") } })
}
