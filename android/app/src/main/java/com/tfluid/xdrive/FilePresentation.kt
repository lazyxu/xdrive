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

@Composable
fun XDriveFileIcon(node: DriveNode, modifier: Modifier = Modifier) {
    val kind = fileKind(node.name, node.isDirectory)
    if (kind == "folder") {
        Box(modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Image(painterResource(R.drawable.xd_folder), contentDescription = null,
                modifier = Modifier.size(width = 38.dp, height = (38f * 54f / 64f).dp))
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
    Box(modifier.size(40.dp), contentAlignment = Alignment.Center) {
        Icon(painterResource(resource), contentDescription = null, modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
