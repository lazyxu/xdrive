package com.tfluid.xdrive.core

/**
 * Owner Clipboard SSE v1: only 20-second Owner-authenticated invalidation
 * frames, never ciphertext or user clipboard bytes. The cursor is ephemeral;
 * every stream reconnection begins with an authoritative GET /items.
 */
class XDriveClipboardSSECursor(after: Long = 0L) {
    init { require(after >= 0L) }
    var cursor: Long = after
        private set
    private var event: String? = null
    private var nextId: Long? = null
    private var dataSeen = false

    /** Feed a complete UTF-8 line without CR/LF. Returns true for a new invalidation. */
    fun acceptLine(line: String): Boolean {
        require(line.length <= 4096 && '\u0000' !in line) { "Invalid Clipboard SSE line" }
        if (line.isEmpty()) {
            val shouldLoad = dataSeen && when (event) {
                "sync" -> nextId == null
                "change" -> nextId != null && nextId!! > cursor
                else -> false
            }
            if (shouldLoad && event == "change") cursor = requireNotNull(nextId)
            event = null
            nextId = null
            dataSeen = false
            return shouldLoad
        }
        if (line.startsWith(":")) return false // Bounded heartbeat, no state change.
        val colon = line.indexOf(':')
        require(colon > 0) { "Invalid Clipboard SSE field" }
        val field = line.substring(0, colon)
        val value = line.substring(colon + 1).removePrefix(" ")
        when (field) {
            "event" -> {
                require(value == "sync" || value == "change")
                event = value
            }
            "id" -> {
                require(value.isNotEmpty() && value.all(Char::isDigit))
                nextId = value.toLongOrNull()?.takeIf { it > 0 }
                    ?: throw IllegalArgumentException("Invalid Clipboard event cursor")
            }
            "data" -> {
                require(value == "{}") { "Clipboard SSE may not carry content" }
                dataSeen = true
            }
            "retry" -> require(value.toIntOrNull()?.let { it in 0..60_000 } == true)
            else -> throw IllegalArgumentException("Unknown Clipboard SSE field")
        }
        return false
    }
}
