package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.util.Locale
import java.util.Date
import java.text.DateFormat

/** Displays only the current Owner's existing SAF transfer, with no new Runner. */
@Composable
internal fun NativeTransferCenter(
    state: DriveState,
    controller: DriveController,
    dismiss: () -> Unit,
) {
    val active = state.nativeTransfers.firstOrNull {
        it.status == NativeTransferStatus.RUNNING
    }
    var confirmation by remember(state.server, state.username) {
        mutableStateOf<NativeInterruptedTransfer?>(null)
    }
    var nowMillis by remember { mutableLongStateOf(System.nanoTime() / 1_000_000L) }
    LaunchedEffect(active?.id) {
        while (active != null) {
            nowMillis = System.nanoTime() / 1_000_000L
            delay(1000)
        }
    }
    AlertDialog(
        onDismissRequest = dismiss,
        modifier = Modifier.testTag("native-transfer-center"),
        title = { Text("传输", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 470.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("本次登录的上传与下载 · 最近最多 20 项",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (state.transferRecoveryIssue) {
                    Text("加密传输恢复记录未能完整读取或清理。新的 HTTPS 传输可能被安全阻止；不会自动覆盖或重传。",
                        modifier = Modifier.testTag("native-recovery-warning"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
                if (state.interruptedNativeTransfers.isNotEmpty()) {
                    Text("上次中断的操作 · 当前账户",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.testTag("native-recovery-heading"))
                    Text("仅保存 Owner、时间和类型的加密标记，不保存文件名或内容。请先在服务器目录或手机文件中核对，再决定清除记录；不会自动续传。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    for (notice in state.interruptedNativeTransfers) {
                        Column(
                            Modifier.fillMaxWidth()
                                .testTag("native-recovery-item-${notice.id}"),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(
                                if (notice.kind == NativeTransferKind.UPLOAD)
                                    "上传结果未确认" else "本地下载可能不完整",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.error)
                            Text(DateFormat.getDateTimeInstance(DateFormat.SHORT,
                                DateFormat.SHORT).format(Date(notice.startedAtUnixMillis)),
                                style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { confirmation = notice },
                                enabled = !state.hasActiveNativeTransfer() &&
                                    state.transferRecoveryClearingId == null && !state.loading,
                                modifier = Modifier.heightIn(min = 48.dp)
                                    .testTag("native-recovery-review-${notice.id}")) {
                                Text("已核对，清除此记录")
                            }
                        }
                    }
                    HorizontalDivider()
                }
                if (state.nativeTransfers.isEmpty()) {
                    Text("本次登录暂无传输记录",
                        modifier = Modifier.testTag("native-transfer-empty"),
                        style = MaterialTheme.typography.bodyMedium)
                }
                for (entry in state.nativeTransfers) {
                    Column(
                        Modifier.fillMaxWidth().testTag("native-transfer-item-${entry.id}"),
                        verticalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Row(Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(entry.fileName, modifier = Modifier.weight(1f),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium)
                            Spacer(Modifier.width(8.dp))
                            Text(nativeTransferStatusLabel(entry),
                                style = MaterialTheme.typography.labelMedium,
                                color = if (entry.status == NativeTransferStatus.FAILED ||
                                    entry.status == NativeTransferStatus.UNCONFIRMED)
                                    MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        val percent = entry.confirmedPercent()?.let { "${it}%" }
                            ?: "待确认"
                        Text("${formatSize(entry.transferredBytes)} / " +
                            "${formatSize(entry.totalBytes)} · $percent",
                            modifier = Modifier.testTag("native-transfer-bytes-${entry.id}"),
                            style = MaterialTheme.typography.bodySmall)
                        if (entry.awaitingCompletionAck()) {
                            Text(
                                if (entry.kind == NativeTransferKind.UPLOAD)
                                    "字节已传输，等待服务器提交确认…"
                                else "字节已写入，等待保存完成确认…",
                                modifier = Modifier.testTag("native-transfer-awaiting-ack-${entry.id}"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (entry.status == NativeTransferStatus.RUNNING) {
                            val fraction = entry.progressFraction()
                            if (fraction != null) {
                                LinearProgressIndicator(progress = { fraction },
                                    modifier = Modifier.fillMaxWidth()
                                        .testTag("native-transfer-progress-${entry.id}"))
                            } else {
                                LinearProgressIndicator(modifier = Modifier.fillMaxWidth()
                                    .testTag("native-transfer-progress-${entry.id}"))
                            }
                        }
                        val clock = if (entry.status == NativeTransferStatus.RUNNING)
                            nowMillis else entry.updatedAtMillis
                        val duration = entry.elapsedMillis(clock)
                        val rate = entry.averageBytesPerSecond(clock)
                        val speed = rate?.let {
                            formatSize(it.coerceAtMost(Long.MAX_VALUE.toDouble()).toLong()) + "/s"
                        } ?: "尚无法测量"
                        val eta = entry.remainingMillis(clock)
                        Text(
                            "已用 ${nativeTransferElapsed(duration)} · 平均速度 $speed" +
                                (if (eta != null) " · 预计剩余 ${nativeTransferElapsed(eta)}" else ""),
                            modifier = Modifier.testTag("native-transfer-rate-${entry.id}"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (entry.status == NativeTransferStatus.UNCONFIRMED)
                            Text("服务端可能已经收到文件。请刷新所在目录核对，不会自动重传。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error)
                        if (entry.status == NativeTransferStatus.RUNNING) {
                            val cancellable = when (entry.kind) {
                                NativeTransferKind.UPLOAD -> state.fileUploadActive
                                NativeTransferKind.DOWNLOAD -> state.fileDownloadActive
                            }
                            TextButton(
                                onClick = {
                                    when (entry.kind) {
                                        NativeTransferKind.UPLOAD -> controller.cancelFileUpload()
                                        NativeTransferKind.DOWNLOAD -> controller.cancelFileDownload()
                                    }
                                },
                                enabled = cancellable,
                                modifier = Modifier.heightIn(min = 48.dp)
                                    .testTag("native-transfer-cancel-${entry.id}"),
                            ) {
                                Text("取消${if (entry.kind == NativeTransferKind.UPLOAD) "上传" else "下载"}")
                            }
                        }
                    }
                    HorizontalDivider()
                }
                if (state.nativeTransfers.any { it.status != NativeTransferStatus.RUNNING }) {
                    TextButton(
                        onClick = controller::clearNativeTransferHistory,
                        modifier = Modifier.heightIn(min = 48.dp)
                            .testTag("native-transfer-clear"),
                    ) { Text("清除已结束的记录") }
                }
                Text("仅当前 App 会话；退出登录将清空。后台续传、暂停和跨设备任务尚未实现。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            TextButton(onClick = dismiss,
                modifier = Modifier.heightIn(min = 48.dp)
                    .testTag("native-transfer-close")) { Text("完成") }
        },
    )
    // Requiring a second explicit decision prevents a tap on a long stale
    // history from silently declaring an unknown finalize as successful.
    confirmation?.let { notice ->
        AlertDialog(
            onDismissRequest = { confirmation = null },
            modifier = Modifier.testTag("native-recovery-confirm-dialog"),
            title = { Text("确认已经人工核对？") },
            text = {
                Text("只有你已自行核对服务器目标目录或本地下载文件时才清除该恢复记录。" +
                    "这不会恢复上传、重新下载或把未知结果改成成功。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        controller.acknowledgeVerifiedInterruptedTransfer(notice.id)
                        confirmation = null
                    },
                    enabled = state.interruptedNativeTransfers.any { it.id == notice.id } &&
                        !state.hasActiveNativeTransfer() &&
                        state.transferRecoveryClearingId == null,
                    modifier = Modifier.testTag("native-recovery-confirm"),
                ) { Text("我已人工核对") }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirmation = null },
                    modifier = Modifier.testTag("native-recovery-cancel"),
                ) { Text("暂不清除") }
            },
        )
    }
}

internal fun nativeTransferStatusLabel(entry: NativeTransferEntry): String =
    when (entry.status) {
        NativeTransferStatus.RUNNING ->
            if (entry.kind == NativeTransferKind.UPLOAD) "上传中" else "下载中"
        NativeTransferStatus.COMPLETED ->
            if (entry.kind == NativeTransferKind.UPLOAD) "已上传" else "已保存"
        NativeTransferStatus.CANCELLED -> "已取消"
        NativeTransferStatus.FAILED -> "失败"
        NativeTransferStatus.UNCONFIRMED -> "结果未确认"
    }

internal fun nativeTransferElapsed(ms: Long): String {
    val seconds = ms.coerceAtLeast(0L) / 1000L
    return if (seconds < 60) "${seconds}秒"
    else String.format(Locale.ROOT, "%d分%02d秒", seconds / 60L, seconds % 60L)
}
