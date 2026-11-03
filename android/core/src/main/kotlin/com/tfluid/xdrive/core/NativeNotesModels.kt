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

internal fun validNotesUUID(value: String): Boolean =
    value.matches(Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))

fun validNotesInput(title: String, markdown: String): Boolean =
    title.isNotBlank() && title.toByteArray(Charsets.UTF_8).size <= 255 &&
        title.none { it.isISOControl() } &&
        markdown.toByteArray(Charsets.UTF_8).size <= 1_048_576 &&
        markdown.none { it == '\u0000' }
