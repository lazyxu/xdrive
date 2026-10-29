package com.tfluid.xdrive

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** No filename, provider Uri, token, byte count or resumable source survives
 * process death. Entries are readable only after matching Owner login. */
data class NativeInterruptedTransfer(
    val id: String,
    val kind: NativeTransferKind,
    val startedAtUnixMillis: Long,
)

/** Host-injected persistence capability. JVM Controller tests can provide an
 * in-memory implementation; Android provides one encrypted Keystore ledger.
 * The caller must await begin() before ANY SAF/UploadSession network or I/O.
 */
interface DriveTransferRecoveryBridge {
    suspend fun begin(server: String, username: String, kind: NativeTransferKind): String?
    suspend fun acknowledgeVerified(server: String, username: String, id: String): Boolean
    suspend fun pending(server: String, username: String): List<NativeInterruptedTransfer>
}

/** A preflight failure means no transfer bytes/session have been sent yet. */
internal class NativeTransferCheckpointFailure : IllegalStateException(
    "Encrypted transfer checkpoint unavailable",
)

/** The only Android encrypted implementation; delegates to the merged #2965
 * bounded journal, not to a second transfer queue, index or UploadSession. */
internal class AndroidDriveTransferRecoveryBridge(context: Context) :
    DriveTransferRecoveryBridge {
    private val ledger = NativeTransferRecoveryLedger(
        AndroidTransferRecoveryStore(context.applicationContext),
    )

    override suspend fun begin(
        server: String, username: String, kind: NativeTransferKind,
    ): String? = withContext(Dispatchers.IO) {
        // Manual opt-in cleartext HTTP cannot have durable credentials. It
        // retains the old foreground-only behavior, never false resume claims.
        if (!server.startsWith("https://")) return@withContext null
        ledger.begin(TransferRecoveryOwner(server, username),
            TransferRecoveryKind.valueOf(kind.name)).id
    }

    override suspend fun acknowledgeVerified(
        server: String, username: String, id: String,
    ): Boolean = withContext(Dispatchers.IO) {
        if (!server.startsWith("https://")) return@withContext false
        ledger.acknowledgeVerified(TransferRecoveryOwner(server, username), id)
    }

    override suspend fun pending(
        server: String, username: String,
    ): List<NativeInterruptedTransfer> = withContext(Dispatchers.IO) {
        if (!server.startsWith("https://")) return@withContext emptyList()
        ledger.notices(TransferRecoveryOwner(server, username)).map {
            NativeInterruptedTransfer(it.id, NativeTransferKind.valueOf(it.kind.name),
                it.startedAtUnixMillis)
        }.sortedByDescending { it.startedAtUnixMillis }
    }
}
