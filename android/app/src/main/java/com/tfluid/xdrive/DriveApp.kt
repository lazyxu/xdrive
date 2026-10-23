package com.tfluid.xdrive

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tfluid.xdrive.core.DriveNode
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriveApp(controller: DriveController) {
    val state by controller.state.collectAsStateWithLifecycle()
    var menu by remember(state.screen) { mutableStateOf(false) }
    BackHandler(state.selected != null || (state.screen == Screen.FILES && state.path.size > 1)) { controller.back() }
    Scaffold(
        modifier = Modifier.imePadding(),
        topBar = {
            TopAppBar(
                title = { Text(if (state.screen == Screen.FILES) "我的文件" else "xDrive") },
                navigationIcon = {
                    if (state.screen == Screen.FILES && state.path.size > 1) {
                        IconButton(onClick = controller::back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回上级") }
                    }
                },
                actions = {
                    if (state.screen == Screen.FILES) IconButton(onClick = controller::refresh) { Icon(Icons.Default.Refresh, "刷新") }
                    if (state.screen != Screen.CONNECT) {
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "账户菜单") }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                if (state.screen != Screen.LOGIN) DropdownMenuItem(
                                    text = { Text("退出登录") }, onClick = { menu = false; controller.logout() },
                                )
                                DropdownMenuItem(text = { Text("更换服务器") }, onClick = { menu = false; controller.changeServer() })
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            when (state.screen) {
                Screen.CONNECT -> ConnectionForm(state, controller::connect)
                Screen.LOGIN -> LoginForm(state, controller::login)
                Screen.PASSWORD -> PasswordForm(state, controller::changePassword)
                Screen.FILES -> Files(state, controller)
            }
        }
    }
    state.selected?.let { node ->
        AlertDialog(
            onDismissRequest = controller::dismissDetails,
            title = { Text(node.name) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(formatSize(node.size))
                    Text("修改时间：${node.updatedAt.ifEmpty { "未知" }}")
                    Text("版本：${node.revision}")
                    Text("文件 ID：${node.id}")
                }
            },
            confirmButton = { TextButton(onClick = controller::dismissDetails) { Text("关闭") } },
        )
    }
}

@Composable
private fun Form(content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 480.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

@Composable
private fun ErrorNotice(error: String?) {
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("request-error"))
}

@Composable
private fun ConnectionForm(state: DriveState, connect: (String, Boolean) -> Unit) {
    var server by remember { mutableStateOf(state.server) }
    var allow by remember { mutableStateOf(state.allowHttp) }
    Form {
        Text("连接你的 xDrive", style = MaterialTheme.typography.headlineSmall)
        Text("使用现有服务器和账户。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(
            value = server, onValueChange = { server = it }, singleLine = true,
            label = { Text("服务器地址") }, placeholder = { Text("https://drive.example") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth().testTag("server"),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = allow, onCheckedChange = { allow = it }, modifier = Modifier.testTag("allow-http"))
            Text("允许不安全的 HTTP 连接")
        }
        if (allow) Text("HTTP 不加密密码和文件信息，仅在可信网络中使用。", color = MaterialTheme.colorScheme.error)
        ErrorNotice(state.error)
        Button(onClick = { connect(server, allow) }, modifier = Modifier.fillMaxWidth()) { Text("连接服务器") }
    }
}

@Composable
private fun LoginForm(state: DriveState, login: (String, String) -> Unit) {
    var username by remember { mutableStateOf("") }
    // Intentionally not rememberSaveable: passwords must never enter saved instance state.
    var password by remember { mutableStateOf("") }
    Form {
        Text("欢迎回来", style = MaterialTheme.typography.headlineSmall)
        Text(state.server, style = MaterialTheme.typography.bodyMedium)
        if (state.server.startsWith("http:")) Text("此连接未加密", color = MaterialTheme.colorScheme.error)
        OutlinedTextField(
            value = username, onValueChange = { username = it }, label = { Text("用户名") },
            singleLine = true, enabled = !state.loading, modifier = Modifier.fillMaxWidth().testTag("username"),
        )
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("密码") },
            singleLine = true, enabled = !state.loading, visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth().testTag("password"),
        )
        ErrorNotice(state.error)
        Button(onClick = { val supplied = password; password = ""; login(username, supplied) }, enabled = !state.loading,
            modifier = Modifier.fillMaxWidth()) { Text("登录") }
        Text("此版本仅在内存保留登录状态，应用进程重启后需要重新登录。", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun PasswordForm(state: DriveState, changePassword: (String, String) -> Unit) {
    var current by remember { mutableStateOf("") }
    var replacement by remember { mutableStateOf("") }
    Form {
        Text("需要更新密码", style = MaterialTheme.typography.headlineSmall)
        Text("账户要求先修改密码，再访问文件。")
        OutlinedTextField(value = current, onValueChange = { current = it }, label = { Text("当前密码") },
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true, enabled = !state.loading, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = replacement, onValueChange = { replacement = it }, label = { Text("新密码") },
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            singleLine = true, enabled = !state.loading, modifier = Modifier.fillMaxWidth())
        ErrorNotice(state.error)
        Button(onClick = { val old = current; val new = replacement; current = ""; replacement = ""; changePassword(old, new) },
            enabled = !state.loading, modifier = Modifier.fillMaxWidth()) { Text("更新密码") }
    }
}

@Composable
private fun ColumnScope.Files(state: DriveState, controller: DriveController) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(state.path.joinToString(" / ") { it.name.ifEmpty { "我的文件" } }.ifEmpty { "我的文件" },
            style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("${state.username} · ${state.server}", style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        ErrorNotice(state.error)
        if (state.error != null) {
            if (state.loaded) Text("保留上次成功读取的目录。", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = controller::retry, enabled = !state.loading) { Text("重试") }
        }
    }
    HorizontalDivider()
    key(state.path.lastOrNull()?.id, state.offset) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("files"), contentPadding = PaddingValues(vertical = 8.dp)) {
            if (state.loaded && state.items.isEmpty() && state.error == null && !state.loading) {
                item { Text(if (state.offset == 0) "此文件夹为空" else "此页没有项目，请返回上一页或刷新。", Modifier.padding(24.dp)) }
            }
            items(state.items, key = { it.id }) { node ->
                FileRow(node, enabled = !state.loading, onClick = { controller.open(node) })
            }
        }
    }
    HorizontalDivider()
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = controller::previousPage, enabled = state.offset > 0 && !state.loading) { Text("上一页") }
        Text(if (state.loaded) "${if (state.items.isEmpty()) 0 else state.offset + 1}–${state.offset + state.items.size} / ${state.totalCount}"
            else "等待目录", modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelMedium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        TextButton(onClick = controller::nextPage, enabled = state.hasNext && !state.loading) { Text("下一页") }
    }
}

@Composable
private fun FileRow(node: DriveNode, enabled: Boolean, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(node.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(if (node.isDirectory) "文件夹" else formatSize(node.size)) },
        leadingContent = {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
                Text(if (node.isDirectory) "目录" else "文件", Modifier.padding(10.dp), style = MaterialTheme.typography.labelMedium)
            }
        },
        modifier = Modifier.clickable(enabled = enabled, onClick = onClick).heightIn(min = 64.dp),
    )
}

internal fun formatSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.ROOT, "%.1f KiB", bytes / 1024.0)
    bytes < 1024L * 1024 * 1024 -> String.format(Locale.ROOT, "%.1f MiB", bytes / (1024.0 * 1024))
    else -> String.format(Locale.ROOT, "%.1f GiB", bytes / (1024.0 * 1024 * 1024))
}
