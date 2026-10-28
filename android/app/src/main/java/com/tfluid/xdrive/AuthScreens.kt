package com.tfluid.xdrive

import androidx.compose.foundation.background
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import com.tfluid.xdrive.core.ServerAddress

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
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = colors.onSurfaceVariant)
        OutlinedTextField(value, onValueChange, enabled = enabled, singleLine = true,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).semantics {
                    contentDescription = label
                    when (tag) {
                        "username" -> contentType = ContentType.Username
                        "password", "current-password" -> contentType = ContentType.Password
                        "new-password", "confirm-password" -> contentType = ContentType.NewPassword
                    }
                }
                // Keep reveal state while the trailing icon owns focus inside this field.
                // Blur outside the whole field must still reset it immediately.
                .onFocusChanged { if (!it.hasFocus) visible = false },
            shape = RoundedCornerShape(12.5.dp),
            placeholder = placeholder?.let { { Text(it) } },
            visualTransformation = if (secret && (!visible || value.isEmpty())) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (secret) KeyboardType.Password else keyboardType,
                imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = {
                // Explicit onDone replaces the IME's default hide action. On
                // short Android viewports, clearing focus alone can leave the
                // keyboard visible while Submit is scrolled into view.
                keyboard?.hide()
                focusManager.clearFocus()
            }),
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

/**
 * The native counterpart of Desktop's compact login panel.
 * Server + optional LAN IP are the only connection inputs; transport chooses
 * LAN first and public DNS only on connectivity failures.
 */
@Composable
internal fun UnifiedLoginForm(
    state: DriveState,
    login: (String, Boolean, String, String, String, Boolean) -> Unit,
    actions: @Composable () -> Unit,
) {
    var server by remember(state.server) { mutableStateOf(state.server) }
    var lanIp by remember(state.server) { mutableStateOf(state.route.lanIp) }
    var username by remember(state.username) { mutableStateOf(state.username) }
    var password by remember { mutableStateOf("") }
    var keepLogin by remember { mutableStateOf(true) }
    var allowHttp by remember(state.server) { mutableStateOf(state.allowHttp) }
    var advanced by remember { mutableStateOf(false) }
    // The transport normalizes the URL separately; the UI must not suggest
    // that an HTTP scheme, including mixed case, can retain credentials.
    val insecureHttp = server.trimStart().startsWith("http:", ignoreCase = true)
    AuthCard("欢迎使用 xDrive", "连接到你的个人云端", actions) {
        AuthField("服务器", server, { value ->
            // Do not carry an optional private socket from one Server to another.
            // Compare normalized HTTPS Origins, not a URL string's trailing slash.
            val oldOrigin = runCatching { ServerAddress.parse(server, allowHttp).url }.getOrNull()
            val newOrigin = runCatching { ServerAddress.parse(value, allowHttp).url }.getOrNull()
            if (oldOrigin != newOrigin) lanIp = ""
            server = value
        }, "server", !state.loading,
            keyboardType = KeyboardType.Uri, placeholder = "https://drive.example.com:8443")
        AuthField("内网 IP（可选）", lanIp, { lanIp = it }, "lan-ip", !state.loading,
            keyboardType = KeyboardType.Uri, placeholder = "192.168.2.4")
        Text("自动优先连接内网，网络不可达时通过服务器域名连接公网；始终验证 HTTPS 身份。",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        AuthField("用户名", username, { username = it }, "username", !state.loading)
        AuthField("密码", password, { password = it }, "password", !state.loading, secret = true)
        // One accessible checkbox action covers the entire 48dp row, including
        // its label. Only the parent handles toggles; the child is a visual
        // indicator, preventing duplicate TalkBack actions or double changes.
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(
                    value = keepLogin && !insecureHttp,
                    enabled = !state.loading && !insecureHttp,
                    role = Role.Checkbox,
                    onValueChange = { keepLogin = it },
                ).testTag("keep-login"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = keepLogin && !insecureHttp, onCheckedChange = null,
                enabled = !state.loading && !insecureHttp,
                modifier = Modifier.testTag("keep-login-indicator"))
            Text("保持登录", modifier = Modifier.padding(start = 8.dp),
                style = MaterialTheme.typography.bodyMedium)
        }
        if (insecureHttp) {
            Text("明文 HTTP 连接不能保持登录，请尽量使用 HTTPS。",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        TextButton(onClick = { advanced = !advanced }, enabled = !state.loading,
            modifier = Modifier.testTag("connection-advanced")) {
            Text(if (advanced) "收起连接设置" else "高级连接设置")
        }
        if (advanced) {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .toggleable(
                        value = allowHttp, enabled = !state.loading,
                        role = Role.Checkbox, onValueChange = { allowHttp = it },
                    ).testTag("allow-http"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = allowHttp, onCheckedChange = null,
                    enabled = !state.loading, modifier = Modifier.testTag("allow-http-indicator"))
                Text("允许不安全的 HTTP 连接", modifier = Modifier.padding(start = 8.dp),
                    style = MaterialTheme.typography.bodySmall)
            }
            if (allowHttp) Text("HTTP 不加密密码或文件，仅限明确可信的本地网络。",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        ErrorNotice(state.error)
        Submit("登录", state.loading) {
            // Keep the entered value until successful navigation so Android
            // Autofill can offer to save it; never persist it in app state.
            // Invalid server or password errors remain editable in place.
            login(server, allowHttp, lanIp, username, password, keepLogin && !insecureHttp)
        }
        Text("账户由 xDrive 管理员创建。", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
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
