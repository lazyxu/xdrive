package com.tfluid.xdrive

import com.tfluid.xdrive.core.ServerAddress
import java.util.UUID

/** Deliberately contains NO file name, source URI, token, byte count, remote
 * session ID or resumption promise. The encrypted journal only records that
 * the previous foreground operation may have had external side effects. */
internal data class TransferRecoveryOwner(val server: String, val username: String) {
    init {
        require(server.startsWith("https://") &&
            ServerAddress.parse(server).url == server) {
            "Only one canonical verified HTTPS Server may own a durable marker"
        }
        require(username.isNotBlank() && username == username.trim() &&
            username.length <= 256 && username.none { it.isISOControl() }) {
            "Invalid transfer Owner"
        }
    }

    override fun toString(): String = "TransferRecoveryOwner([redacted])"
}

internal enum class TransferRecoveryKind { UPLOAD, DOWNLOAD }
internal enum class TransferRecoveryRisk {
    /** Finalize/ACK could have been committed by Go; verify destination. */
    UPLOAD_RESULT_UNCONFIRMED,
    /** A SAF destination may be partially written, never report as saved. */
    DOWNLOAD_INCOMPLETE,
}

internal data class TransferRecoveryMarker(
    val id: String,
    val owner: TransferRecoveryOwner,
    val kind: TransferRecoveryKind,
    val startedAtUnixMillis: Long,
) {
    init {
        require(runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false)) {
            "Invalid local transfer marker identity"
        }
        require(startedAtUnixMillis > 0L)
    }

    /** Conservatively classify process death; never synthesize success. */
    val risk: TransferRecoveryRisk get() = when (kind) {
        TransferRecoveryKind.UPLOAD -> TransferRecoveryRisk.UPLOAD_RESULT_UNCONFIRMED
        TransferRecoveryKind.DOWNLOAD -> TransferRecoveryRisk.DOWNLOAD_INCOMPLETE
    }

    override fun toString() = "TransferRecoveryMarker(id=$id, kind=$kind, " +
        "risk=$risk, Owner=[redacted])"
}

internal interface TransferRecoveryStore {
    /** A missing journal is empty. Corruption, keystore loss or unreadability
     * MUST throw, not return an empty success-looking history. */
    fun read(): List<TransferRecoveryMarker>
    /** Must commit all entries durably or throw before caller starts any I/O. */
    fun write(entries: List<TransferRecoveryMarker>)
}

/** Pure, testable, bounded process-death safety ledger.
 *
 * This is NOT a WorkManager queue. No task runs after process death and no
 * source URI is retained. Only an authenticated matching Owner may review and
 * explicitly acknowledge the unknown previous external result.
 *
 * One app process owns writes. Reconciliation is fail-closed: begin persists
 * BEFORE any UploadSession/network or SAF output work; end removes only after
 * an actual verified terminal ACK or user-verified destination inspection. */
internal class NativeTransferRecoveryLedger(
    private val store: TransferRecoveryStore,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    @Synchronized
    fun begin(owner: TransferRecoveryOwner, kind: TransferRecoveryKind): TransferRecoveryMarker {
        val entries = readValidated()
        check(entries.size < MAX_UNCONFIRMED_TRANSFERS) {
            "Transfer recovery history needs Owner verification before another task"
        }
        val marker = TransferRecoveryMarker(newId(), owner, kind, now())
        check(entries.none { it.id == marker.id }) { "Duplicate transfer recovery ID" }
        store.write(entries + marker)
        // Caller is allowed to open its existing transport ONLY after commit.
        return marker
    }

    @Synchronized
    fun notices(owner: TransferRecoveryOwner): List<TransferRecoveryMarker> =
        readValidated().filter { it.owner == owner }

    /** A confirmed ACK, or a deliberate human confirmation after independent
     * destination GET. A timeout, cancelled upload and lost finalize ACK must
     * NOT invoke this method and must stay UNCONFIRMED on restart. */
    @Synchronized
    fun acknowledgeVerified(owner: TransferRecoveryOwner, id: String): Boolean {
        val previous = readValidated()
        val exists = previous.any { it.id == id && it.owner == owner }
        if (!exists) return false
        store.write(previous.filterNot { it.id == id && it.owner == owner })
        return true
    }

    private fun readValidated(): List<TransferRecoveryMarker> {
        val entries = store.read()
        check(entries.size <= MAX_UNCONFIRMED_TRANSFERS &&
            entries.map { it.id }.toSet().size == entries.size) {
            "Invalid transfer recovery journal"
        }
        return entries
    }

    internal companion object {
        const val MAX_UNCONFIRMED_TRANSFERS = 20
    }
}
