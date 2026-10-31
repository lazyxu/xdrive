package com.tfluid.xdrive

import com.tfluid.xdrive.core.ServerAddress
import com.tfluid.xdrive.core.validDriveNodeName
import java.util.UUID

/**
 * Authenticated server-side facts required BEFORE a native photo backup can
 * be admitted. A username, local Android account or Files breadcrumb alone
 * must never be used as proof of a Server Owner.
 *
 * A future Owner verifier must read /me and /nodes/root using the actual
 * native bearer session, and reject missing Server instance identity.
 */
internal data class NativePhotoBackupOwner(
    val serverOrigin: String,
    val instanceId: String,
    val ownerId: Long,
    val username: String,
    val rootNodeId: Long,
    val rootRevision: Long,
    val deviceId: String,
) {
    init {
        require(serverOrigin.startsWith("https://") &&
            ServerAddress.parse(serverOrigin).url == serverOrigin) {
            "Photo backup requires canonical HTTPS origin"
        }
        require(instanceId.length in 1..256 && instanceId.none { it.isISOControl() })
        require(ownerId > 0 && rootNodeId > 0 && rootRevision > 0)
        require(username.isNotBlank() && username == username.trim() &&
            username.length <= 256 && username.none { it.isISOControl() })
        require(deviceId.length in 1..256 && deviceId.none { it.isISOControl() })
    }

    override fun toString() = "NativePhotoBackupOwner([redacted])"
}

internal enum class NativePhotoBackupResource {
    STILL,
    VIDEO,
    MOTION_STILL,
    MOTION_VIDEO,
}

internal enum class NativePhotoBackupPhase {
    /** Staged resource was hashed; NO Server write may have started. */
    PLANNED,
    /** Durably checkpointed BEFORE issuing any UploadSession request. */
    MAY_HAVE_SENT,
    /** Lost/cancelled/timed-out ACK: only a read-only exact GET may settle it. */
    UNKNOWN_ACK,
    /** Actual Owner receipt matched the original resource, not byte progress. */
    VERIFIED,
}

/** Only data proven by a real Go finalized ACK or an authorized exact GET. */
internal data class NativePhotoBackupVerifiedReceipt(
    val owner: NativePhotoBackupOwner,
    val nodeId: Long,
    val nodeRevision: Long,
    val sizeBytes: Long,
    val originalSha256: String,
) {
    init {
        require(nodeId > 0 && nodeRevision > 0 && sizeBytes > 0)
        require(nativeBackupHex(originalSha256))
    }
    override fun toString() = "NativePhotoBackupVerifiedReceipt([redacted])"
}

/**
 * Encrypted checkpoint metadata. NO raw MediaStore/SAF URI, filename, secret,
 * preview bytes, staged path or bearer token is permitted.
 *
 * assetKey and versionKey are keyed, irreversible SHA-256 digests generated
 * by a future native inventory adapter; neither is a raw MediaStore ID.
 */
internal data class NativePhotoBackupIntent(
    val id: String,
    val owner: NativePhotoBackupOwner,
    val assetKey: String,
    val versionKey: String,
    val resource: NativePhotoBackupResource,
    val originalSha256: String,
    val sizeBytes: Long,
    val phase: NativePhotoBackupPhase,
    val createdAtMillis: Long,
    /** Exact new original destination for an Owner-scoped, read-only ACK lookup.
     * Old journal rows omit it and stay blocked rather than guessing a filename. */
    val destinationName: String? = null,
    val verifiedNodeId: Long? = null,
    val verifiedNodeRevision: Long? = null,
) {
    init {
        require(runCatching { UUID.fromString(id).toString() == id }.getOrDefault(false))
        require(nativeBackupHex(assetKey) && nativeBackupHex(versionKey) &&
            nativeBackupHex(originalSha256))
        require(sizeBytes > 0 && createdAtMillis > 0)
        require(destinationName == null || validDriveNodeName(destinationName))
        require((verifiedNodeId == null) == (verifiedNodeRevision == null))
        if (phase == NativePhotoBackupPhase.VERIFIED) {
            require(verifiedNodeId != null && verifiedNodeId > 0 &&
                verifiedNodeRevision != null && verifiedNodeRevision > 0)
        } else require(verifiedNodeId == null && verifiedNodeRevision == null)
    }

    val requiresReadOnlyReconciliation get() =
        phase == NativePhotoBackupPhase.MAY_HAVE_SENT ||
            phase == NativePhotoBackupPhase.UNKNOWN_ACK
    val eligibleForFirstAttempt get() = phase == NativePhotoBackupPhase.PLANNED

    override fun toString() = "NativePhotoBackupIntent(id=$id, phase=$phase, [redacted])"
}

internal fun nativeBackupHex(value: String): Boolean =
    value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }

internal interface NativePhotoBackupIntentStore {
    /** Missing storage may mean a new install. Unreadable/corrupt MUST throw. */
    fun read(): List<NativePhotoBackupIntent>
    /** Must commit atomically before allowing any write to Go Server. */
    fun write(entries: List<NativePhotoBackupIntent>)
}

/**
 * Pure, Owner-fenced, bounded native backup intent state machine.
 *
 * NOT a second uploader, a background worker, a complete 100k ledger, nor
 * permission to replay UploadSession. No caller has permission to send bytes
 * until beginAttempt() returns after a durable encrypted checkpoint.
 * Process death during MAY_HAVE_SENT is ALWAYS an UNKNOWN outcome.
 */
internal class NativePhotoBackupLedger(
    private val store: NativePhotoBackupIntentStore,
    private val now: () -> Long = System::currentTimeMillis,
    private val nextId: () -> String = { UUID.randomUUID().toString() },
) {
    @Synchronized
    fun plan(
        owner: NativePhotoBackupOwner,
        assetKey: String,
        versionKey: String,
        resource: NativePhotoBackupResource,
        originalSha256: String,
        sizeBytes: Long,
        destinationName: String? = null,
    ): NativePhotoBackupIntent {
        val previous = validated()
        require(nativeBackupHex(assetKey) && nativeBackupHex(versionKey) &&
            nativeBackupHex(originalSha256) && sizeBytes > 0)
        val existing = previous.firstOrNull {
            it.owner == owner && it.assetKey == assetKey &&
                it.versionKey == versionKey && it.resource == resource
        }
        if (existing != null) {
            // One asset/resource/version cannot change content under our feet.
            check(existing.originalSha256 == originalSha256 &&
                existing.sizeBytes == sizeBytes &&
                (destinationName == null || existing.destinationName == destinationName)) {
                "Original changed: new verified version required"
            }
            return existing
        }
        check(previous.size < MAX_ENTRIES) { "Photo backup journal full; reconcile before adding" }
        val intent = NativePhotoBackupIntent(
            nextId(), owner, assetKey, versionKey, resource, originalSha256,
            sizeBytes, NativePhotoBackupPhase.PLANNED, now(),
            destinationName = destinationName)
        check(previous.none { it.id == intent.id })
        store.write(previous + intent)
        return intent
    }

    /**
     * Source must be re-resolved under CURRENT Android permission and hashed
     * again before this call. Caller must already own the shared global writer.
     * The MAY_HAVE_SENT record is durably saved BEFORE any network I/O.
     */
    @Synchronized
    fun beginAttempt(
        owner: NativePhotoBackupOwner, id: String,
        currentSha256: String, currentSizeBytes: Long,
    ): NativePhotoBackupIntent {
        val previous = validated()
        val original = previous.firstOrNull { it.owner == owner && it.id == id }
            ?: throw IllegalStateException("Photo backup intent not in current Owner scope")
        check(original.eligibleForFirstAttempt) { "Unconfirmed upload cannot be replayed" }
        check(nativeBackupHex(currentSha256) &&
            currentSha256 == original.originalSha256 &&
            currentSizeBytes == original.sizeBytes) { "Original changed before upload" }
        check(previous.none { it.phase == NativePhotoBackupPhase.MAY_HAVE_SENT }) {
            "Another photo upload still needs an exact terminal result"
        }
        val marked = original.copy(phase = NativePhotoBackupPhase.MAY_HAVE_SENT)
        store.write(previous.map { if (it.id == id) marked else it })
        return marked
    }

    /** Never converts an uncertain final ACK into a retryable failure. */
    @Synchronized
    fun markUnknownAck(owner: NativePhotoBackupOwner, id: String) {
        val previous = validated()
        val original = previous.firstOrNull { it.owner == owner && it.id == id }
            ?: throw IllegalStateException("Photo backup intent not in current Owner scope")
        check(original.phase == NativePhotoBackupPhase.MAY_HAVE_SENT ||
            original.phase == NativePhotoBackupPhase.UNKNOWN_ACK)
        if (original.phase == NativePhotoBackupPhase.UNKNOWN_ACK) return
        store.write(previous.map {
            if (it.id == id) original.copy(phase = NativePhotoBackupPhase.UNKNOWN_ACK) else it
        })
    }

    /**
     * Caller must independently validate a Go finalize response or a fresh
     * Owner-authorized exact remote GET; a filename or progress event is NOT a
     * receipt. Never infer success from absence of an error.
     */
    @Synchronized
    fun acknowledgeVerified(
        owner: NativePhotoBackupOwner,
        id: String,
        receipt: NativePhotoBackupVerifiedReceipt,
    ): NativePhotoBackupIntent {
        val previous = validated()
        val original = previous.firstOrNull { it.owner == owner && it.id == id }
            ?: throw IllegalStateException("Photo backup intent not in current Owner scope")
        check(receipt.owner == owner &&
            receipt.originalSha256 == original.originalSha256 &&
            receipt.sizeBytes == original.sizeBytes) { "Go receipt does not match original Owner resource" }
        check(original.phase == NativePhotoBackupPhase.MAY_HAVE_SENT ||
            original.phase == NativePhotoBackupPhase.UNKNOWN_ACK ||
            (original.phase == NativePhotoBackupPhase.VERIFIED &&
                original.verifiedNodeId == receipt.nodeId &&
                original.verifiedNodeRevision == receipt.nodeRevision)) {
            "No valid outstanding upload for supplied receipt"
        }
        if (original.phase == NativePhotoBackupPhase.VERIFIED) return original
        val completed = original.copy(
            phase = NativePhotoBackupPhase.VERIFIED,
            verifiedNodeId = receipt.nodeId,
            verifiedNodeRevision = receipt.nodeRevision,
        )
        store.write(previous.map { if (it.id == id) completed else it })
        return completed
    }

    /**
     * Bounded journal capacity must not stop a 100k-photo incremental scan.
     * A VERIFIED intent can be discarded ONLY after the caller confirms its
     * exact matching Node ID/revision, original hash/bytes, Owner/device and
     * resource/version in the durable verified receipt index.
     *
     * PLANNED / MAY_HAVE_SENT / UNKNOWN_ACK are never pruned. A failed index
     * lookup or failed durable write leaves the original journal untouched.
     * Caller must not infer Go success from this cleanup operation.
     */
    @Synchronized
    fun compactIndexedVerified(
        exactIndexedReceiptMatches: (NativePhotoBackupIntent) -> Boolean,
    ): Int {
        val original = validated()
        if (original.none { it.phase == NativePhotoBackupPhase.VERIFIED }) return 0
        val kept = original.filterNot { entry ->
            entry.phase == NativePhotoBackupPhase.VERIFIED &&
                exactIndexedReceiptMatches(entry)
        }
        val removed = original.size - kept.size
        if (removed > 0) store.write(kept)
        return removed
    }

    /** No resume/retry operations here. Records survive Owner switches. */
    @Synchronized
    fun inspect(owner: NativePhotoBackupOwner): List<NativePhotoBackupIntent> =
        validated().filter { it.owner == owner }

    /** Whole-journal corruption, invalid Owner fields, and duplicate keys fail closed. */
    private fun validated(): List<NativePhotoBackupIntent> = store.read().also { entries ->
        check(entries.size <= MAX_ENTRIES &&
            entries.map { it.id }.toSet().size == entries.size &&
            entries.map {
                listOf(it.owner, it.assetKey, it.versionKey, it.resource)
            }.toSet().size == entries.size &&
            entries.count { it.phase == NativePhotoBackupPhase.MAY_HAVE_SENT } <= 1
        ) { "Photo backup intent journal invalid" }
    }

    internal companion object {
        const val MAX_ENTRIES = 128
    }
}
