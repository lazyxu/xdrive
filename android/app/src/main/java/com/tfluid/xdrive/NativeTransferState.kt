package com.tfluid.xdrive

/** Session-only, Owner-scoped snapshot of an actual SAF transfer.
 * The UI must never persist the filename, URI, private bytes or credentials.
 * Only one upload/download can run in the existing DriveController at a time.
 */
enum class NativeTransferKind { UPLOAD, DOWNLOAD }
enum class NativeTransferStatus {
    RUNNING, COMPLETED, CANCELLED, FAILED, UNCONFIRMED,
}

data class NativeTransferEntry(
    val id: Long,
    val kind: NativeTransferKind,
    val fileName: String,
    val totalBytes: Long,
    val transferredBytes: Long = 0L,
    val status: NativeTransferStatus = NativeTransferStatus.RUNNING,
    val startedAtMillis: Long,
    val updatedAtMillis: Long = startedAtMillis,
) {
    init {
        require(id > 0 && totalBytes >= 0 && transferredBytes >= 0)
    }

    fun withConfirmedBytes(bytes: Long, nowMillis: Long): NativeTransferEntry {
        if (status != NativeTransferStatus.RUNNING) return this
        // Upload bytes mean Server ACK. Download bytes mean written to SAF.
        // A stale callback is never allowed to decrease a progress counter.
        val next = maxOf(transferredBytes, bytes.coerceIn(0L, totalBytes))
        return copy(transferredBytes = next,
            updatedAtMillis = maxOf(updatedAtMillis, nowMillis))
    }

    fun finish(
        outcome: NativeTransferStatus,
        nowMillis: Long,
        finalBytes: Long? = null,
    ): NativeTransferEntry {
        if (status != NativeTransferStatus.RUNNING ||
            outcome == NativeTransferStatus.RUNNING) return this
        val completed = finalBytes?.coerceIn(0L, totalBytes)
        return copy(
            status = outcome,
            transferredBytes = maxOf(transferredBytes,
                if (outcome == NativeTransferStatus.COMPLETED)
                    completed ?: totalBytes else transferredBytes),
            updatedAtMillis = maxOf(updatedAtMillis, nowMillis),
        )
    }

    fun elapsedMillis(nowMillis: Long = updatedAtMillis): Long =
        (maxOf(updatedAtMillis, nowMillis) - startedAtMillis).coerceAtLeast(0L)

    /** Session mean, not a fabricated instantaneous wire rate. */
    fun averageBytesPerSecond(nowMillis: Long = updatedAtMillis): Double? {
        val elapsed = elapsedMillis(nowMillis)
        if (transferredBytes == 0L || elapsed < 100L) return null
        return transferredBytes.toDouble() * 1000.0 / elapsed.toDouble()
    }

    fun remainingMillis(nowMillis: Long = updatedAtMillis): Long? {
        if (status != NativeTransferStatus.RUNNING ||
            totalBytes <= 0 || transferredBytes >= totalBytes) return null
        val speed = averageBytesPerSecond(nowMillis) ?: return null
        if (speed <= 0.0 || !speed.isFinite()) return null
        val value = (totalBytes - transferredBytes).toDouble() * 1000.0 / speed
        if (!value.isFinite() || value > Long.MAX_VALUE.toDouble()) return null
        return value.toLong().coerceAtLeast(0L)
    }

    /**
     * Confirmed chunk/SAF bytes are not proof of a durable final ACK. Even
     * when all bytes arrived, an in-flight or uncertain transfer may not be
     * called 100% complete. Use an upper bound below 1.0 until COMPLETED.
     */
    fun progressFraction(): Float? = when {
        totalBytes <= 0L -> null
        status == NativeTransferStatus.COMPLETED -> 1f
        else -> (transferredBytes.toDouble() / totalBytes.toDouble())
            .toFloat().coerceIn(0f, 0.999f)
    }

    /** Integer display percentage, never a rounded false 100% before ACK. */
    fun confirmedPercent(): Int? = when {
        status == NativeTransferStatus.COMPLETED -> 100
        totalBytes <= 0L -> null
        else -> (100.0 * transferredBytes.toDouble() / totalBytes.toDouble())
            .toInt().coerceIn(0, 99)
    }

    /** All declared bytes are accounted for; finalization may still fail. */
    fun awaitingCompletionAck(): Boolean =
        status == NativeTransferStatus.RUNNING && totalBytes > 0L &&
            transferredBytes >= totalBytes
}

internal const val MAX_SESSION_TRANSFERS = 20

internal fun List<NativeTransferEntry>.withStartedTransfer(item: NativeTransferEntry) =
    (listOf(item) + this.filterNot { it.id == item.id }).take(MAX_SESSION_TRANSFERS)

internal fun List<NativeTransferEntry>.updateTransfer(
    id: Long, transform: (NativeTransferEntry) -> NativeTransferEntry,
): List<NativeTransferEntry> = map { if (it.id == id) transform(it) else it }
