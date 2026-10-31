package com.tfluid.xdrive

import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

internal enum class NativePhotoBatchConsent {
    REGISTER_DEVICE, START_BATCH, ENABLE_AUTO, DISABLE_AUTO,
}

/**
 * A real Owner's native Gallery owns this explicit foreground backup control.
 * It never claims a scheduled backup, auto-registers a device, persists a local
 * MediaStore identifier, or treats a preview as proof of an uploaded original.
 */
@Composable
internal fun NativePhotoBatchControls(
    state: DriveState,
    fullReadGrant: Boolean,
    onRequestReadGrant: () -> Unit,
    onEnrollDevice: () -> Unit,
    onStartBatch: (Long) -> Unit,
    onCancelBatch: () -> Unit,
    autoConfigured: Boolean = false,
    autoStatus: String? = null,
    onEnableAuto: () -> Unit = {},
    onDisableAuto: () -> Unit = {},
) {
    if (state.screen != Screen.GALLERY || state.nativeUiSessionId <= 0L) return

    var panelOpen by remember(state.nativeUiSessionId) { mutableStateOf(false) }
    var confirmation by remember(state.nativeUiSessionId) {
        mutableStateOf<NativePhotoBatchConsent?>(null)
    }
    val busy = state.nativePhotoBatchRunning
    val otherWriterBusy = state.fileUploadActive && !busy
    val eligible = state.canStartNativePhotoForeground()
    val nextCursor = if (state.nativePhotoBatchScanned > 0 &&
        !state.nativePhotoBatchExhausted)
        state.nativePhotoBatchNextAfterId else 0L

    TextButton(
        onClick = { panelOpen = true },
        modifier = Modifier.heightIn(min = 48.dp).testTag("native-photo-batch-open"),
    ) { Text("照片和视频备份") }

    if (panelOpen) {
        AlertDialog(
            onDismissRequest = {
                if (!busy) {
                    confirmation = null
                    panelOpen = false
                }
            },
            title = { Text("本机照片和视频增量备份") },
            text = {
                Column(
                    modifier = Modifier.heightIn(max = 430.dp)
                        .verticalScroll(rememberScrollState())
                        .testTag("native-photo-backup-scroll"),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("只上传当前账户授权的原件；与云端图库分开。手动处理每批最多 8 项新原件；自动定时需另行明确开启。")
                    Text(if (fullReadGrant) "照片和视频：已授权完整读取"
                        else "未取得完整照片及视频读取授权；Android 14 只选部分照片不等于完整授权。",
                        modifier = Modifier.testTag("native-photo-batch-permission-status"))
                    if (!fullReadGrant) {
                        OutlinedButton(
                            onClick = onRequestReadGrant,
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("native-photo-batch-request-permission"),
                        ) { Text("授权完整照片与视频访问") }
                    }
                    Text(if (state.nativePhotoDeviceVerified) "本机备份设备身份：本次登录已核验"
                        else "本机备份设备身份：尚未核验；需要明确登记或核验已有设备。",
                        modifier = Modifier.testTag("native-photo-batch-device-status"))
                    OutlinedButton(
                        onClick = { confirmation = NativePhotoBatchConsent.REGISTER_DEVICE },
                        enabled = eligible && !state.nativePhotoDeviceVerified,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("native-photo-batch-register-device"),
                    ) { Text("登记或核验本机备份设备") }

                    if (state.nativePhotoBatchScanned > 0) {
                        Text("本次已扫描 ${state.nativePhotoBatchScanned} 项；" +
                            "收到真实上传回执 ${state.nativePhotoBatchUploaded} 项；" +
                            "跳过已验证原件 ${state.nativePhotoBatchAlreadyVerified} 项。",
                            modifier = Modifier.testTag("native-photo-batch-progress"))
                        if (state.nativePhotoBatchExhausted)
                            Text("本次分页已到末尾，不代表其他设备或云端原件已经完成备份。")
                    }
                    if (otherWriterBusy) {
                        Text("已有其他手动上传正在运行；请返回该操作处理，不会在此处停止或重复启动。",
                            modifier = Modifier.testTag("native-photo-batch-other-writer"))
                    }
                    if (busy) {
                        Text("正在处理本次授权的原件；停止可能使正在发送的原件进入待核对状态。",
                            color = MaterialTheme.colorScheme.error)
                        OutlinedButton(
                            onClick = onCancelBatch,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("native-photo-batch-stop"),
                        ) { Text("停止本次备份（结果可能待核对）") }
                    } else {
                        Button(
                            onClick = { confirmation = NativePhotoBatchConsent.START_BATCH },
                            enabled = eligible && fullReadGrant &&
                                state.nativePhotoDeviceVerified,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("native-photo-batch-confirm-open"),
                        ) { Text(if (nextCursor > 0) "继续下一批（需要确认）"
                            else "备份下一批原件（需要确认）") }
                    }
                    Text(
                        if (autoConfigured) "后台自动备份：本机已保存定时计划，需以当前 Owner 重新核验。"
                        else "后台自动备份：未开启（不会在后台读取照片）。",
                        modifier = Modifier.testTag("native-photo-auto-status"))
                    if (autoStatus == AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW) {
                        Text("后台备份已暂停：有上传结果需要核对，禁止自动重传。",
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag("native-photo-auto-needs-review"))
                    }
                    if (!autoConfigured) {
                        OutlinedButton(
                            onClick = { confirmation = NativePhotoBatchConsent.ENABLE_AUTO },
                            enabled = eligible && fullReadGrant &&
                                state.nativePhotoDeviceVerified,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("native-photo-auto-enable"),
                        ) { Text("开启定时增量备份（需确认）") }
                    } else {
                        OutlinedButton(
                            onClick = { confirmation = NativePhotoBatchConsent.DISABLE_AUTO },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("native-photo-auto-disable"),
                        ) { Text("关闭本机后台备份计划") }
                    }
                    if (state.error != null) Text("操作受阻：${state.error}",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("native-photo-batch-error"))
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { panelOpen = false; confirmation = null },
                    enabled = !busy,
                    modifier = Modifier.testTag("native-photo-batch-close"),
                ) { Text("关闭") }
            },
            modifier = Modifier.testTag("native-photo-batch-panel"),
        )
    }

    when (confirmation) {
        NativePhotoBatchConsent.REGISTER_DEVICE -> AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text("确认本机设备登记") },
            text = {
                Text("将当前登录 Owner 的 Android 设备身份登记到当前服务器。已有设备只做只读核验；如果旧登记结果不明，不会自动重新注册。此操作不上传照片。")
            },
            confirmButton = {
                TextButton(
                    enabled = eligible && !state.nativePhotoDeviceVerified,
                    onClick = { confirmation = null; onEnrollDevice() },
                    modifier = Modifier.testTag("native-photo-batch-register-confirm"),
                ) { Text("确认登记或核验") }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirmation = null },
                    modifier = Modifier.testTag("native-photo-batch-register-cancel"),
                ) { Text("取消") }
            },
        )
        NativePhotoBatchConsent.START_BATCH -> AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text("确认增量备份这一批") },
            text = {
                Text("只向当前已验证账户的根目录上传本机照片或视频原件，最多 8 项新上传；" +
                    "不会覆盖已有云端文件。未知 ACK 不重试，必须先核对；不会自行继续下一批或后台执行。")
            },
            confirmButton = {
                TextButton(
                    enabled = eligible && fullReadGrant &&
                        state.nativePhotoDeviceVerified,
                    onClick = {
                        confirmation = null
                        onStartBatch(nextCursor)
                    },
                    modifier = Modifier.testTag("native-photo-batch-start-confirm"),
                ) { Text("确认开始") }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirmation = null },
                    modifier = Modifier.testTag("native-photo-batch-start-cancel"),
                ) { Text("取消") }
            },
        )
        NativePhotoBatchConsent.ENABLE_AUTO -> AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text("确认开启自动增量备份") },
            text = {
                Text("需要已记住的 HTTPS 登录、完整照片及视频授权和当前 Owner 的真实设备登记。" +
                    "系统按网络及电量条件定期执行，每次最多处理 8 项新原件；" +
                    "停用或退出登录立即撤销授权。未知上传结果会暂停等待人工核对。")
            },
            confirmButton = {
                TextButton(
                    enabled = eligible && fullReadGrant &&
                        state.nativePhotoDeviceVerified,
                    onClick = { confirmation = null; onEnableAuto() },
                    modifier = Modifier.testTag("native-photo-auto-enable-confirm"),
                ) { Text("确认开启") }
            },
            dismissButton = {
                TextButton(onClick = { confirmation = null },
                    modifier = Modifier.testTag("native-photo-auto-enable-cancel")) {
                    Text("取消")
                }
            },
        )
        NativePhotoBatchConsent.DISABLE_AUTO -> AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text("关闭后台照片备份") },
            text = {
                Text("停止本机自动定时任务。正在上传的原件如未收到真实回执，" +
                    "仍需人工核对；不会影响其他手动文件上传。")
            },
            confirmButton = {
                TextButton(onClick = { confirmation = null; onDisableAuto() },
                    modifier = Modifier.testTag("native-photo-auto-disable-confirm")) {
                    Text("确认关闭")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmation = null },
                    modifier = Modifier.testTag("native-photo-auto-disable-cancel")) {
                    Text("取消")
                }
            },
        )
        null -> Unit
    }
}

/** Android OS permission prompt is always driven by the user's own tap. */
@Composable
internal fun NativePhotoBatchPanel(state: DriveState, controller: DriveController) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var permissionEpoch by remember(state.nativeUiSessionId) { mutableIntStateOf(0) }
    val permissionPrompt = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { permissionEpoch++ }
    DisposableEffect(owner, state.nativeUiSessionId) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) permissionEpoch++
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val fullRead = remember(permissionEpoch, state.nativeUiSessionId) {
        hasNativeFullPhotoVideoReadGrant(context)
    }
    val versionName = remember(context.packageName) {
        runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: "0.1"
    }
    val auto = remember(permissionEpoch, state.nativePhotoAutoApproved,
        state.nativeUiSessionId) {
        AndroidPhotoAutoPolicyStore(context).snapshot()
    }
    NativePhotoBatchControls(
        state = state,
        fullReadGrant = fullRead,
        onRequestReadGrant = { permissionPrompt.launch(nativePhotoPermissions()) },
        onEnrollDevice = {
            controller.enrollNativePhotoDeviceExplicit(context,
                "Android Photos", versionName)
        },
        onStartBatch = { after ->
            controller.backupNativePhotoNextForegroundBatch(context, after)
        },
        onCancelBatch = controller::cancelFileUpload,
        autoConfigured = auto?.enabled == true,
        autoStatus = auto?.status,
        onEnableAuto = { controller.enableNativePhotoAutoBackup(context) },
        onDisableAuto = { controller.disableNativePhotoAutoBackup(context) },
    )
}
