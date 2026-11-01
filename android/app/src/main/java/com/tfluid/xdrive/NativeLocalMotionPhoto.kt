package com.tfluid.xdrive

import android.content.Context
import android.media.ExifInterface
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * The Android Motion Photo 1.0 XMP directory identifies one appended video
 * via a positive byte length. A marker is only a CANDIDATE: editors can strip
 * the actual video while leaving XMP behind. Media3 must still decode video.
 *
 * This first native MVP accepts genuine new-format Container metadata only.
 * Legacy MicroVideoOffset and OEM private sidecars remain unimplemented.
 */
internal fun nativeLocalMotionXmpCandidate(xmp: ByteArray?): Boolean {
    if (xmp == null || xmp.isEmpty() || xmp.size > 256 * 1024) return false
    val xml = xmp.toString(Charsets.UTF_8)
    val enabled = Regex("""(?:GCamera|Camera):MotionPhoto\s*=\s*["']1["']""")
        .containsMatchIn(xml)
    if (!enabled) return false
    val itemTags = Regex("""<(?:GContainer|Container):Item\b[^>]*>""")
        .findAll(xml)
    fun attribute(tag: String, name: String): String? =
        Regex("""\b""" + Regex.escape(name) + """\s*=\s*["']([^"']*)["']""")
            .find(tag)?.groupValues?.getOrNull(1)
    return itemTags.any { match ->
        val tag = match.value
        attribute(tag, "Item:Semantic") == "MotionPhoto" &&
            attribute(tag, "Item:Mime") in setOf("video/mp4", "video/quicktime") &&
            (attribute(tag, "Item:Length")?.toLongOrNull() ?: 0L) in 1L..(512L * 1024 * 1024)
    }
}

/** Read only XMP for the exact currently visible, authorized content:// still. */
internal suspend fun nativeLocalHasMotionPhotoCandidate(
    context: Context, asset: NativeLocalMedia,
): Boolean = withContext(Dispatchers.IO) {
    if (asset.isVideo || asset.uri.scheme != "content") return@withContext false
    try {
        currentCoroutineContext().ensureActive()
        val xmp = context.contentResolver.openFileDescriptor(asset.uri, "r")?.use { fd ->
            ExifInterface(fd.fileDescriptor).getAttributeBytes(ExifInterface.TAG_XMP)
        }
        currentCoroutineContext().ensureActive()
        nativeLocalMotionXmpCandidate(xmp)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // Permission revocation/unsupported EXIF means no advertised motion
        // action. It never changes the still-image Viewer or uploads anything.
        false
    }
}

/** Motion is explicitly requested; an XMP marker is never a success badge. */
@Composable
internal fun NativeLocalMotionControl(
    candidate: Boolean, playing: Boolean, onToggle: () -> Unit,
) {
    if (!candidate) return
    TextButton(
        onClick = onToggle,
        modifier = Modifier.heightIn(min = 48.dp)
            .testTag("native-local-motion-toggle"),
    ) {
        Text(if (playing) "返回静态照片" else "尝试播放动态片段（也可长按照片）")
    }
}
