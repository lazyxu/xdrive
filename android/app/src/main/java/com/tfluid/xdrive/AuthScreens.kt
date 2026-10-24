package com.tfluid.xdrive

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

@Composable
private fun AuthCard(title: String, subtitle: String, actions: @Composable () -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(colors.primary.copy(alpha = .055f), colors.background)))) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight).padding(24.dp),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(Modifier.widthIn(max = 430.dp).fillMaxWidth().testTag("auth-card"),
                shape = RoundedCornerShape(14.dp), color = colors.surface, shadowElevation = 6.dp) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    BoxWithConstraints {
                        if (maxWidth < 280.dp) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    XDriveBrand(size = 48.dp)
                                    Text("xDrive", Modifier.weight(1f).padding(start = 14.dp).testTag("auth-brand-title"),
                                        style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(subtitle, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                                        color = colors.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    actions()
                                }
                            }
                        } else Row(verticalAlignment = Alignment.CenterVertically) {
                            XDriveBrand(size = 48.dp)
                            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                                Text("xDrive", Modifier.testTag("auth-brand-title"), style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant,
                                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            actions()
                        }
                    }
                    Text(title, style = MaterialTheme.typography.titleLarge)
                    content()
                }
            }
        }
    }
}

@Composable
internal fun ErrorNotice(error: String?) {
    if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("request-error"), style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun AuthField(label: String, value: String, onValueChange: (String) -> Unit, tag: String,
    enabled: Boolean, secret: Boolean = false, keyboardType: KeyboardType = KeyboardType.Text, placeholder: String? = null) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(value.isEmpty()) { if (value.isEmpty()) visible = false }
    val colors = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = colors.onSurfaceVariant)
        OutlinedTextField(value, onValueChange, enabled = enabled, singleLine = true,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).semantics { contentDescription = label }
                .onFocusChanged { if (!it.isFocused) visible = false },
            shape = RoundedCornerShape(12.5.dp),
            placeholder = placeholder?.let { { Text(it) } },
            visualTransformation = if (secret && (!visible || value.isEmpty())) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else keyboardType),
            trailingIcon = if (secret) { { IconButton(onClick = { visible = !visible }, enabled = enabled, modifier = Modifier.testTag("$tag-reveal")) {
                Icon(painterResource(if (visible) R.drawable.xd_visibility_off else R.drawable.xd_visibility), if (visible) "隐藏密码" else "显示密码", tint = colors.onSurfaceVariant)
            } } } else null,
            colors = OutlinedTextFieldDefaults.colors(focusedTextColor = colors.onSurface, unfocusedTextColor = colors.onSurface,
                focusedContainerColor = colors.surface, unfocusedContainerColor = colors.surface, disabledContainerColor = colors.surface,
                focusedBorderColor = colors.primary, unfocusedBorderColor = colors.outline, cursorColor = colors.primary,
                focusedTrailingIconColor = colors.onSurfaceVariant, unfocusedTrailingIconColor = colors.onSurfaceVariant))
    }
}

@Composable
private fun Submit(label: String, loading: Boolean, onClick: () -> Unit) {
    val focus = LocalFocusManager.current
    Button(onClick = { focus.clearFocus(); onClick() }, enabled = !loading,
        shape = RoundedCornerShape(12.5.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("auth-submit"),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary)) { Text(label) }
}

@Composable
internal fun ConnectionForm(state: DriveState, connect: (String, Boolean) -> Unit) {
    var server by remember { mutableStateOf(state.server) }
    var allow by remember { mutableStateOf(state.allowHttp) }
    AuthCard("连接你的 xDrive", "连接到你的 xDrive 服务器。") {
        AuthField("服务器地址", server, { server = it }, "server", !state.loading, keyboardType = KeyboardType.Uri, placeholder = "https://drive.example")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(allow, { allow = it }, modifier = Modifier.testTag("allow-http"), colors = CheckboxDefaults.colors(
                checkedColor = MaterialTheme.colorScheme.primary, checkmarkColor = MaterialTheme.colorScheme.onPrimary, uncheckedColor = MaterialTheme.colorScheme.onSurfaceVariant))
            Text("允许不安全的 HTTP 连接", style = MaterialTheme.typography.bodyMedium)
        }
        if (allow) Text("HTTP 不加密密码和文件信息，仅在可信网络中使用。", color = MaterialTheme.colorScheme.error)
        ErrorNotice(state.error)
        Submit("连接服务器", state.loading) { connect(server, allow) }
    }
}

@Composable
internal fun LoginForm(state: DriveState, login: (String, String) -> Unit, actions: @Composable () -> Unit) {
    var username by remember { mutableStateOf("") }
    // Credentials deliberately never enter saved instance state.
    var password by remember { mutableStateOf("") }
    AuthCard("欢迎回来", state.server, actions) {
        if (state.server.startsWith("http:")) Text("此连接未加密", color = MaterialTheme.colorScheme.error)
        AuthField("用户名", username, { username = it }, "username", !state.loading)
        AuthField("密码", password, { password = it }, "password", !state.loading, secret = true)
        ErrorNotice(state.error)
        Submit("登录", state.loading) { val supplied = password; password = ""; login(username, supplied) }
        Text("账户由 xDrive 管理员创建。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("此版本仅在内存保留登录状态，应用进程重启后需要重新登录。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun PasswordForm(state: DriveState, changePassword: (String, String) -> Unit, actions: @Composable () -> Unit) {
    var current by remember { mutableStateOf("") }
    var replacement by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AuthCard("需要更新密码", "账户要求先修改密码，再访问文件。", actions) {
        AuthField("当前密码", current, { current = it; error = null }, "current-password", !state.loading, secret = true)
        AuthField("新密码", replacement, { replacement = it; error = null }, "new-password", !state.loading, secret = true)
        AuthField("确认新密码", confirmation, { confirmation = it; error = null }, "confirm-password", !state.loading, secret = true)
        ErrorNotice(error ?: state.error)
        Submit("更新密码", state.loading) {
            when {
                replacement.length < 8 -> error = "新密码至少需要 8 个字符。"
                replacement != confirmation -> error = "两次输入的密码不一致。"
                else -> { val old = current; val new = replacement; current = ""; replacement = ""; confirmation = ""; changePassword(old, new) }
            }
        }
    }
}
