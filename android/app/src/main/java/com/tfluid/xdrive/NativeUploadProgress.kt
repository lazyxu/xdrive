package com.tfluid.xdrive

/**
 * The native Files/Gallery surfaces display only genuinely acknowledged or written SAF bytes.
 * Reaching the declared file size is NOT a durable finalize receipt: the
 * HTTP response may still be in flight or lost. Reserve 100% exclusively for
 * a confirmed completed transfer in the existing Transfer Center.
 *
 * A zero-byte upload has no meaningful fraction and stays indeterminate until
 * the real Server ACK. This helper does not inspect or retain any Owner bytes.
 */
internal fun nativePendingSafTransferProgress(
    acknowledgedBytes: Long,
    declaredBytes: Long,
): Float? {
    if (declaredBytes <= 0L) return null
    val bounded = acknowledgedBytes.coerceIn(0L, declaredBytes)
    return (bounded.toDouble() / declaredBytes.toDouble())
        .toFloat().coerceIn(0f, 0.999f)
}

/** Upload byte ACK must still await server finalize. */
internal fun nativePendingUploadProgress(
    acknowledgedBytes: Long, declaredBytes: Long,
): Float? = nativePendingSafTransferProgress(acknowledgedBytes, declaredBytes)

/** SAF download byte writes must still await exact output close/verification. */
internal fun nativePendingDownloadProgress(
    acknowledgedBytes: Long, declaredBytes: Long,
): Float? = nativePendingSafTransferProgress(acknowledgedBytes, declaredBytes)

internal fun nativeDownloadAwaitingFinalReceipt(
    active: Boolean, writtenBytes: Long, declaredBytes: Long,
): Boolean = active && declaredBytes > 0L && writtenBytes >= declaredBytes

/** Inform users that full byte acknowledgment is awaiting final commit. */
internal fun nativeUploadAwaitingFinalReceipt(
    active: Boolean,
    acknowledgedBytes: Long,
    declaredBytes: Long,
): Boolean =
    active && declaredBytes > 0L && acknowledgedBytes >= declaredBytes
