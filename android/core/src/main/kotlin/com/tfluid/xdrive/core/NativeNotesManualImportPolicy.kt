package com.tfluid.xdrive.core

import java.util.Locale

/**
 * Pure bounded policy for explicit Markdown + local image imports.
 * Never fetch Markdown image URLs or infer native Apple Notes identities.
 */
object NativeNotesManualImportPolicy {
    const val maxImages = 32
    const val maxImageBytes = 20 * 1_048_576

    /** Bind a file-picker result to the Owner and read-only archive active
     * when the picker was opened. A later account/source switch cancels it. */
    fun isCurrentOwnerImportSession(
        capturedOwnerEpoch: Long?, currentOwnerEpoch: Long, source: String,
    ): Boolean = capturedOwnerEpoch != null &&
        capturedOwnerEpoch == currentOwnerEpoch && source == "ios_notes"
    private val supportedExtensions = setOf("png", "jpg", "jpeg", "gif", "webp", "heic")
    private val imagePattern = Regex("""!\[[^\]\r\n]{0,180}\]\(([^)\r\n]{1,512})\)""")

    fun localImageFilename(path: String): String {
        require(path.isNotEmpty() && !path.startsWith("/") && !path.startsWith("~") &&
            !path.contains('\\') && !path.contains('%') && !path.contains('?') &&
            !path.contains('#') && !path.contains(':') &&
            path.none { it.code < 32 || it.code == 127 }) {
            "Markdown 中包含远程、绝对或不安全的图片路径。"
        }
        require(!path.contains("//") && !path.endsWith("/")) {
            "Markdown 图片路径无效。"
        }
        val parts = path.split('/')
        require(parts.isNotEmpty() && parts.all { it.isNotEmpty() && it != "." && it != ".." }) {
            "Markdown 图片路径不能包含目录穿越。"
        }
        val name = parts.last()
        require(name.length <= 255) { "图片文件名过长。" }
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        require(extension in supportedExtensions) { "Markdown 引用了不支持的图片格式。" }
        return name
    }

    fun references(markdown: String): List<String> {
        val pathsByName = linkedMapOf<String, String>()
        imagePattern.findAll(markdown).forEach { match ->
            val path = match.groupValues[1]
            val filename = localImageFilename(path)
            val previous = pathsByName[filename]
            require(previous == null || previous == path) {
                "Markdown 中不同目录引用了同名图片，无法安全匹配所选文件。"
            }
            pathsByName[filename] = path
        }
        return pathsByName.keys.toList()
    }

    fun selectedImages(requiredNames: List<String>, availableNames: List<String>): List<String> {
        require(availableNames.size <= maxImages) { "一次最多选择 1 份 Markdown 和 32 张图片。" }
        require(availableNames.toSet().size == availableNames.size) {
            "多个图片文件重名，请先调整文件名。"
        }
        require(requiredNames.all { it in availableNames }) {
            "Markdown 引用的图片未被同时选择，不能声称完成图片导入。"
        }
        return requiredNames
    }

    fun replacing(markdown: String, filename: String, verifiedAssetPath: String, noteId: String): String {
        require(validNotesImagePath(noteId, verifiedAssetPath)) {
            "服务器返回的图片相对路径无效。"
        }
        val matches = imagePattern.findAll(markdown).toList()
        val replacements = matches.asReversed().fold(markdown) { current, match ->
            val path = match.groupValues[1]
            if (localImageFilename(path) == filename) {
                current.replaceRange(match.groups[1]!!.range, verifiedAssetPath)
            } else current
        }
        return replacements
    }
}
