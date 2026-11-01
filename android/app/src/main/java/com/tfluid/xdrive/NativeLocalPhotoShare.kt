package com.tfluid.xdrive

import android.content.ClipData
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import androidx.compose.foundation.layout.heightIn
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
internal fun nativeLocalPhotoShareIntent(
    context: Context, asset: NativeLocalMedia,
): Intent? {
    if (!nativeLocalPhotoShareEligible(asset)) return null
    return Intent(Intent.ACTION_SEND).apply {
        type = if (asset.isVideo) "video/*" else "image/*"
        putExtra(Intent.EXTRA_STREAM, asset.uri)
        clipData = ClipData.newUri(context.contentResolver,
            "xDrive local media", asset.uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

internal fun nativeDispatchLocalPhotoShare(
    context: Context, asset: NativeLocalMedia,
): Boolean {
    val send = nativeLocalPhotoShareIntent(context, asset) ?: return false
    return runCatching {
        val chooser = Intent.createChooser(send, "分享本机原件").apply {
            clipData = send.clipData
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(chooser)
        true
    }.getOrDefault(false)
}

/** Accessible L3 Viewer action. Sharing is never automatic; it requires
 * an explicit tap, and it does not mark a photo backed up in xDrive.
 */
@Composable
internal fun NativeLocalPhotoShareAction(
    asset: NativeLocalMedia,
    onShare: ((NativeLocalMedia) -> Boolean)? = null,
) {
    val context = LocalContext.current
    var failed by remember(asset.viewerReturnKey()) { mutableStateOf(false) }
    TextButton(
        enabled = nativeLocalPhotoShareEligible(asset),
        onClick = {
            failed = !(onShare?.invoke(asset) ?: nativeDispatchLocalPhotoShare(context, asset))
        },
        modifier = Modifier.heightIn(min = 48.dp)
            .testTag("native-local-viewer-share"),
    ) { Text("分享本机原件") }
    if (failed) Text(
        "无法打开系统分享面板，请检查照片权限或可用的分享应用。",
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.testTag("native-local-viewer-share-error"),
        style = MaterialTheme.typography.bodySmall,
    )
}
