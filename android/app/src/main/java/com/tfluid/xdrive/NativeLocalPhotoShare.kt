package com.tfluid.xdrive

import android.content.ClipData
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** A user-opened *local* Gallery asset must resolve to its exact platform
 * MediaStore content URI. Neither cloud URLs nor arbitrary file:// paths
 * may enter an Android ACTION_SEND through this UI.
 */
internal fun nativeLocalPhotoShareEligible(asset: NativeLocalMedia): Boolean {
    if (asset.id <= 0L || asset.uri.scheme != "content" ||
        asset.uri.authority != "media") return false
    val collection = if (asset.isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    return asset.uri == ContentUris.withAppendedId(collection, asset.id)
}

/** No file copy, thumbnail surrogate, Server call or long-lived URI grant:
 * Android's chooser and the selected target receive only the one OS URI.
 */
internal fun nativeLocalPhotoShareIntent(asset: NativeLocalMedia): Intent? {
    if (!nativeLocalPhotoShareEligible(asset)) return null
    return Intent(Intent.ACTION_SEND).apply {
        type = if (asset.isVideo) "video/*" else "image/*"
        putExtra(Intent.EXTRA_STREAM, asset.uri)
        // Construct an exact URI grant without probing MediaStore or opening
        // original bytes before the user selects a share target.
        clipData = ClipData.newRawUri("xDrive local media", asset.uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

internal fun nativeDispatchLocalPhotoShare(
    context: Context, asset: NativeLocalMedia,
): Boolean {
    val send = nativeLocalPhotoShareIntent(asset) ?: return false
    return runCatching {
        val chooser = Intent.createChooser(send, "分享本机原件").apply {
            clipData = send.clipData
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(chooser)
        true
    }.getOrDefault(false)
}

/**
 * Android's native photo/video editor handoff. This is an explicit ACTION_EDIT
 * request for the same current canonical MediaStore URI shown in the Viewer.
 * Grant read access only: the external editor owns its save/copy workflow and
 * xDrive does not claim in-place modification, successful save, or backup.
 */
internal fun nativeLocalPhotoEditIntent(asset: NativeLocalMedia): Intent? {
    if (!nativeLocalPhotoShareEligible(asset)) return null
    return Intent(Intent.ACTION_EDIT).apply {
        setDataAndType(asset.uri, if (asset.isVideo) "video/*" else "image/*")
        clipData = ClipData.newRawUri("xDrive local edit source", asset.uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

internal fun nativeDispatchLocalPhotoEdit(
    context: Context, asset: NativeLocalMedia,
): Boolean {
    val edit = nativeLocalPhotoEditIntent(asset) ?: return false
    return runCatching {
        val chooser = Intent.createChooser(edit, "使用系统编辑器（由编辑应用负责保存）").apply {
            clipData = edit.clipData
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(chooser)
        true
    }.getOrDefault(false)
}

/** Accessible L3 native Viewer actions. Both require an explicit tap and
 * neither automatically saves, modifies, shares or backs up the original. */
@Composable
internal fun NativeLocalPhotoShareAction(
    asset: NativeLocalMedia,
    onShare: ((NativeLocalMedia) -> Boolean)? = null,
    onEdit: ((NativeLocalMedia) -> Boolean)? = null,
) {
    val context = LocalContext.current
    val itemKey = NativeLocalVideoSourceKey(asset.viewerReturnKey(), asset.uri.toString())
    var shareFailed by remember(itemKey) { mutableStateOf(false) }
    var editFailed by remember(itemKey) { mutableStateOf(false) }
    val permitted = nativeLocalPhotoShareEligible(asset)
    Row(Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(
            enabled = permitted,
            onClick = {
                shareFailed = !(onShare?.invoke(asset)
                    ?: nativeDispatchLocalPhotoShare(context, asset))
            },
            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                .testTag("native-local-viewer-share"),
        ) { Text("分享本机原件", maxLines = 1) }
        TextButton(
            enabled = permitted,
            onClick = {
                editFailed = !(onEdit?.invoke(asset)
                    ?: nativeDispatchLocalPhotoEdit(context, asset))
            },
            modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                .testTag("native-local-viewer-edit"),
        ) { Text("使用系统编辑器", maxLines = 1) }
    }
    if (shareFailed) Text(
        "无法打开系统分享面板，请检查照片权限或可用的分享应用。",
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("native-local-viewer-share-error"),
        style = MaterialTheme.typography.bodySmall,
    )
    if (editFailed) Text(
        "无法打开系统编辑器，请检查照片权限或设备是否安装了编辑应用。",
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("native-local-viewer-edit-error"),
        style = MaterialTheme.typography.bodySmall,
    )
}
