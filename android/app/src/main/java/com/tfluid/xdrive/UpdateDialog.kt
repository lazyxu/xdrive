package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tfluid.xdrive.core.UpdateSource

@Composable
internal fun UpdateDialog(controller: UpdateController, openUpdate: (String) -> Boolean) {
    val state by controller.state.collectAsStateWithLifecycle()
    if (!state.visible) return
    AlertDialog(onDismissRequest = controller::dismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        titleContentColor = MaterialTheme.colorScheme.onSurface,
        textContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        title = { Text("检查更新") }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("当前版本：${state.versionName} (${state.versionCode})")
                Text("更新源（无需登录）")
                UpdateSource.entries.forEach { source ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .selectable(selected = state.source == source, role = Role.RadioButton, onClick = { controller.selectSource(source) }),
                        verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = state.source == source, onClick = null)
                        Text(source.label, Modifier.padding(start = 8.dp))
                    }
                }
                if (state.source == UpdateSource.GITLAB) Text("GitLab 使用 HTTP，更新信息和下载可能被篡改；仅在可信网络中使用。",
                    Modifier.testTag("update-http-warning"), color = MaterialTheme.colorScheme.error)
                if (state.checking) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("正在检查…")
                } else if (state.checked) {
                    val result = state.result
                    Text(when {
                        result == null -> "此源最近发布中未找到 Android APK，无法判断是否有新版。"
                        result.available -> "发现新版本：${result.versionName} (${result.versionCode})"
                        else -> "已安装版本不低于此源最新 Android 版本：${result.versionName} (${result.versionCode})。"
                    })
                }
                ErrorNotice(state.error)
                if (state.result?.available == true) {
                    Text("将打开浏览器下载 APK，由 Android 确认安装。更新包必须与已安装应用使用相同签名。", style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { if (!openUpdate(state.result!!.downloadUrl)) controller.browserUnavailable() },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("下载更新") }
                }
                OutlinedButton(onClick = controller::check, enabled = !state.checking,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("检查新版本") }
            }
        }, confirmButton = { TextButton(onClick = controller::dismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("关闭") } })
}
