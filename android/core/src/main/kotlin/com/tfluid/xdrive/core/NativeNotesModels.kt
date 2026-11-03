package com.tfluid.xdrive.core

/** Native Notes is a second view of real Owner File/CAS nodes, not a new
 * Android database, WebView or a bearer-token cache. */
data class OwnerNoteRow(
    val id: String,
    val source: String,
    val title: String,
    val nodeId: Long,
    val revision: Long,
    val sha256: String,
    val bytes: Long,
    val updatedAt: String,
) {
    val writable: Boolean get() = source == "mine"
}

data class OwnerNoteDetail(
    val row: OwnerNoteRow,
    val markdown: String,
)

data class OwnerNotesPage(
    val items: List<OwnerNoteRow>,
    val nextOffset: Int,
)

data class OwnerNoteVersion(
    val id: Long,
    val revision: Long,
    val sha256: String,
    val bytes: Long,
)

/** Server-issued immutable image receipt for one writable Owner note. */
data class OwnerNoteImageReceipt(
    val nodeId: Long,
    val relativePath: String,
    val sha256: String,
    val bytes: Long,
    val contentType: String,
)

/** Only same-note, immutable CAS image paths may be fetched by the native UI.
 * Never resolve remote URLs or file:// paths from Markdown. */
fun validNotesImagePath(noteId: String, path: String): Boolean {
    if (!validNotesUUID(noteId) || path.length > 160) return false
    val uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"
    val pattern = Regex("^_assets/($uuid)/($uuid\\.(?:png|jpg|gif|webp|heic))$", RegexOption.IGNORE_CASE)
    val match = pattern.matchEntire(path) ?: return false
    return match.groupValues[1].equals(noteId, ignoreCase = true)
}

/** Make a server-relative link, not an authenticated remote URL. The upload
 * is a separate, explicitly initiated action; this only modifies the draft. */
fun appendNotesImageMarkdown(markdown: String, noteId: String, path: String): String {
    require(validNotesImagePath(noteId, path))
    val prefix = if (markdown.isBlank()) "" else markdown.trimEnd() + "\n\n"
    val appended = prefix + "![图片](" + path + ")\n"
    require(appended.toByteArray(Charsets.UTF_8).size <= 1_048_576)
    return appended
}

internal fun validNotesUUID(value: String): Boolean =
    value.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))

fun validNotesInput(title: String, markdown: String): Boolean =
    title.isNotBlank() && title.toByteArray(Charsets.UTF_8).size <= 255 &&
        title.none { it.isISOControl() } &&
        markdown.toByteArray(Charsets.UTF_8).size <= 1_048_576 &&
        markdown.none { it == '\u0000' }
