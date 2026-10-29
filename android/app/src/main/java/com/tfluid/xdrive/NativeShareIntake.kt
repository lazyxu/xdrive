package com.tfluid.xdrive

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.tfluid.xdrive.core.validDriveNodeName

/** Transient incoming OS grant. Never persisted, logged, or treated as an
 * authenticated Owner. Only the existing UploadSession may consume bytes. */
internal data class NativeIncomingShare(
    val uri: Uri,
    val sourceOwner: ShareOwnerIdentity?,
)
internal data class ShareOwnerIdentity(val server: String, val username: String)
internal data class NativeShareTarget(
    val identity: ShareOwnerIdentity,
    val folderId: Long,
    val pathIds: List<Long>,
    val folderName: String,
)
internal data class NativeShareMetadata(val name: String, val byteSize: Long)
internal const val MAX_NATIVE_SHARE_BYTES = 8L * 1024L * 1024L * 1_000_000L

/** Never accept arbitrary URLs, file:// paths, ACTION_SEND_MULTIPLE or an
 * ungranted content Uri. An Intent or ClipData alone is not read authority:
 * ContentResolver still enforces the current OS grant when opened. */
@Suppress("DEPRECATION")
internal fun nativeSingleShareCandidate(intent: Intent?): Uri? {
    if (intent?.action != Intent.ACTION_SEND ||
        intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) return null
    val uri = try { intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) }
        catch (_: Exception) { null } ?: return null
    if (uri.scheme != ContentResolver.SCHEME_CONTENT ||
        uri.authority.isNullOrBlank() || uri.userInfo != null) return null
    val clip = intent.clipData ?: return uri
    if (clip.itemCount != 1) return null
    val clipUri = try { clip.getItemAt(0).uri }
        catch (_: Exception) { null }
    if (clipUri != null && clipUri != uri) return null
    return uri
}

internal fun nativeShareMetadata(name: String?, size: Long?): NativeShareMetadata? {
    if (name == null || !validDriveNodeName(name) || size == null ||
        size < 0L || size > MAX_NATIVE_SHARE_BYTES) return null
    return NativeShareMetadata(name, size)
}

/** Metadata read only; no provider bytes, guessed filename or unbounded
 * buffering. Unknown size must use the existing explicit SAF picker instead. */
internal fun queryNativeShareMetadata(
    resolver: ContentResolver, uri: Uri,
): NativeShareMetadata? = try {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (nameIndex < 0 || sizeIndex < 0 ||
            cursor.isNull(nameIndex) || cursor.isNull(sizeIndex)) return@use null
        nativeShareMetadata(cursor.getString(nameIndex), cursor.getLong(sizeIndex))
    }
} catch (_: Exception) {
    null
}

/** Present only an authenticated, first-party verified Files Browse folder.
 * Controller.prepareFileUpload does its own second check at the user click. */
internal fun nativeShareTarget(state: DriveState): NativeShareTarget? {
    if (state.screen != Screen.FILES || state.filesSection != FilesSection.BROWSE ||
        state.server.isBlank() || state.username.isBlank() || !state.loaded ||
        state.loading || state.error != null || state.browseSelectionMode ||
        state.browseBatchWriteAttempted || state.destinationKind != null ||
        state.fileExportPending != null || state.fileDownloadActive ||
        state.fileUploadActive || state.fileUploadPickerParent != null ||
        state.hasActiveNativeTransfer()) return null
    val folder = state.path.lastOrNull() ?: return null
    if (!folder.isDirectory || folder.id <= 0L ||
        state.path.any { it.id <= 0L || !it.isDirectory }) return null
    return NativeShareTarget(ShareOwnerIdentity(state.server, state.username),
        folder.id, state.path.map { it.id },
        folder.name.ifEmpty { "根目录" })
}

@Composable
internal fun BoxScope.NativeShareReview(
    pending: NativeIncomingShare,
    state: DriveState,
    busy: Boolean,
    failure: String?,
    onDismiss: () -> Unit,
    onConfirm: (NativeShareTarget) -> Unit,
) {
    val target = nativeShareTarget(state)?.takeIf {
        pending.sourceOwner == null || it.identity == pending.sourceOwner
    }
    if (target == null) {
        Surface(
            modifier = Modifier.align(Alignment.BottomCenter)
                .navigationBarsPadding().fillMaxWidth().padding(12.dp)
                .testTag("native-share-not-ready"),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shape = MaterialTheme.shapes.medium,
            tonalElevation = 4.dp,
        ) {
            Row(Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (pending.sourceOwner != null &&
                        ShareOwnerIdentity(state.server, state.username) != pending.sourceOwner)
                        "账户已切换，已停止共享导入。"
                    else "请先登录并打开云端文件中的目标目录，再确认导入共享文件。",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onDismiss,
                    modifier = Modifier.testTag("native-share-dismiss")) { Text("取消") }
            }
        }
    } else {
        AlertDialog(
            modifier = Modifier.testTag("native-share-confirm-dialog"),
            onDismissRequest = { if (!busy) onDismiss() },
            title = { Text("从其他应用上传到 xDrive") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("目标：${target.folderName}。确认后读取系统共享文件的名称和大小，" +
                        "并通过当前账户的原有上传流程写入此目录。")
                    Text("本次仅上传一个文件。不会自动重传、后台续传或保存共享 URI。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (failure != null) Text(failure,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("native-share-error"))
                    if (busy) CircularProgressIndicator(
                        modifier = Modifier.size(20.dp))
                }
            },
            confirmButton = {
                TextButton(onClick = { onConfirm(target) }, enabled = !busy,
                    modifier = Modifier.testTag("native-share-confirm")) { Text("确认上传") }
            },
            dismissButton = {
                TextButton(onClick = onDismiss, enabled = !busy,
                    modifier = Modifier.testTag("native-share-cancel")) { Text("取消") }
            },
        )
    }
}
