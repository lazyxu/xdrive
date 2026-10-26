package com.tfluid.xdrive

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import com.tfluid.xdrive.core.DriveNode
import java.util.Locale

fun fileKind(name: String, directory: Boolean): String {
    if (directory) return "folder"
    val dot = name.lastIndexOf('.')
    val extension = if (dot <= 0 || dot == name.length - 1) "" else name.substring(dot + 1).lowercase(Locale.ROOT)
    return when (extension) {
        in SharedVisuals.imageExtensions -> "image"
        in SharedVisuals.videoExtensions -> "video"
        in SharedVisuals.audioExtensions -> "audio"
        "pdf" -> "pdf"
        in SharedVisuals.documentExtensions -> "document"
        in SharedVisuals.spreadsheetExtensions -> "spreadsheet"
        in SharedVisuals.presentationExtensions -> "presentation"
        in SharedVisuals.archiveExtensions -> "archive"
        in SharedVisuals.codeExtensions -> "code"
        in SharedVisuals.textExtensions -> "text"
        else -> "file"
    }
}

/** A fixed MIME allowlist for native SAF CreateDocument, not a client permission
 * decision. Unknown, compound or extensionless names stay octet-stream.
 * Do not infer a more privileged media type from remote server content.
 */
internal fun exportMimeType(fileName: String): String {
    val dot = fileName.lastIndexOf('.')
    if (dot <= 0 || dot == fileName.lastIndex) return "application/octet-stream"
    return when (fileName.substring(dot + 1).lowercase(Locale.ROOT)) {
        "jpg", "jpeg", "jpe" -> "image/jpeg"
        "png" -> "image/png"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "heic" -> "image/heic"
        "heif" -> "image/heif"
        "avif" -> "image/avif"
        "bmp" -> "image/bmp"
        "tif", "tiff" -> "image/tiff"
        "mp4", "m4v" -> "video/mp4"
        "mov" -> "video/quicktime"
        "webm" -> "video/webm"
        "mkv" -> "video/x-matroska"
        "3gp" -> "video/3gpp"
        "avi" -> "video/x-msvideo"
        "pdf" -> "application/pdf"
        "txt", "md", "log" -> "text/plain"
        "csv" -> "text/csv"
        "json" -> "application/json"
        else -> "application/octet-stream"
    }
}

@Composable
fun XDriveFileIcon(node: DriveNode, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val kind = fileKind(node.name, node.isDirectory)
    if (kind == "folder") {
        Box(modifier.size(size), contentAlignment = Alignment.Center) {
            Image(painterResource(R.drawable.xd_folder), contentDescription = null,
                modifier = Modifier.size(width = size * (38f / 40f), height = size * (38f / 40f) * (54f / 64f)))
        }
        return
    }
    val resource = when (kind) {
        "image" -> R.drawable.xd_image
        "video" -> R.drawable.xd_movie
        "audio" -> R.drawable.xd_audio_file
        "pdf" -> R.drawable.xd_picture_as_pdf
        "spreadsheet" -> R.drawable.xd_table_chart
        "presentation" -> R.drawable.xd_view_carousel
        "archive" -> R.drawable.xd_folder_zip
        "document", "text" -> R.drawable.xd_description
        "code" -> R.drawable.xd_code
        else -> R.drawable.xd_insert_drive_file
    }
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Icon(painterResource(resource), contentDescription = null, modifier = Modifier.size(size * 0.6f),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
