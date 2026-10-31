package com.tfluid.xdrive

import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.XDriveService
import com.tfluid.xdrive.core.validDriveNodeName
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.security.MessageDigest

/**
 * Durable *verified-only* receipt index. This abstraction makes the real
 * SQLite index testable without replacing the production database or uploader.
 */
internal interface NativePhotoVerifiedReceiptIndex {
    fun findVerified(
        owner: NativePhotoBackupOwner,
        assetKey: String,
        versionKey: String,
        resource: NativePhotoBackupResource,
        sha256: String,
        sizeBytes: Long,
    ): NativePhotoIndexedReceipt?

    fun recordVerified(intent: NativePhotoBackupIntent)
}

internal data class NativePhotoIncrementalSource(
    val assetKey: String,
    val versionKey: String,
    val resource: NativePhotoBackupResource,
    val destinationName: String,
) {
    init {
        require(nativeBackupHex(assetKey) && nativeBackupHex(versionKey))
        require(resource == NativePhotoBackupResource.STILL ||
            resource == NativePhotoBackupResource.VIDEO)
        require(validDriveNodeName(destinationName))
    }
}

/** Metadata is used only to establish a stable identity; the version also
 * includes the *staged original* SHA-256, never only MediaStore timestamps.
 * Names are deterministic, legal Go filenames, and never overwrite originals.
 */
internal object NativePhotoIncrementalSourceKey {
    fun fromOriginal(
        verifiedDeviceId: String,
        mediaId: Long,
        isVideo: Boolean,
        mimeType: String,
        modifiedAtSeconds: Long,
        staged: NativePhotoStagedOriginal,
    ): NativePhotoIncrementalSource {
        require(verifiedDeviceId.isNotBlank() && verifiedDeviceId.length <= 256 &&
            mediaId > 0 && modifiedAtSeconds >= 0 &&
            staged.bytes > 0 && nativeBackupHex(staged.sha256))
        val extension = when (mimeType) {
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/heic" -> "heic"
            "image/heif" -> "heif"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/avif" -> "avif"
            "video/mp4" -> "mp4"
            "video/quicktime" -> "mov"
            "video/3gpp" -> "3gp"
            "video/webm" -> "webm"
            "video/x-matroska" -> "mkv"
            else -> throw IllegalArgumentException("Unsupported original media type")
        }
        require(mimeType.startsWith(if (isVideo) "video/" else "image/"))
        // Keys are never raw local IDs, filenames, album names or content URIs.
        val asset = digest("android-original-asset-v1", verifiedDeviceId,
            mediaId.toString(), if (isVideo) "video" else "still")
        val version = digest("android-original-version-v1", asset,
            modifiedAtSeconds.toString(), staged.bytes.toString(), staged.sha256)
        val kind = if (isVideo) NativePhotoBackupResource.VIDEO
            else NativePhotoBackupResource.STILL
        val name = "xdrive-" + (if (isVideo) "video" else "photo") + "-" +
            asset.take(20) + "-" + version.take(20) + "." + extension
        return NativePhotoIncrementalSource(asset, version, kind, name)
    }

    private fun digest(vararg parts: String): String {
        val hash = MessageDigest.getInstance("SHA-256")
        parts.forEach { part ->
            val bytes = part.toByteArray(Charsets.UTF_8)
            require(bytes.size <= 4096)
            hash.update(byteArrayOf(
                (bytes.size ushr 24).toByte(), (bytes.size ushr 16).toByte(),
                (bytes.size ushr 8).toByte(), bytes.size.toByte()))
            hash.update(bytes)
        }
        return hash.digest().joinToString("") { byte ->
            "%02x".format(byte.toInt() and 0xff)
        }
    }
}

internal enum class NativePhotoIncrementalOutcome { ALREADY_VERIFIED, UPLOADED }

/**
 * The missing real incremental writer integration:
 *
 * - A fresh Owner+Root/identity proof and one already-staged authorized photo
 *   are required by the caller; this object does NOT schedule work or enroll.
 * - Verified index and durable intent journal are checked *before* any write.
 * - A MAY_HAVE_SENT checkpoint commits before the existing UploadSession.
 * - Lost/cancelled ACK never triggers a second POST. A valid Go finalize
 *   receipt first commits VERIFIED to the ledger, then to SQLite.
 * - Crash between ledger receipt and SQLite is safely repaired on next entry.
 *
 * Only one caller may own the existing global upload writer; do not create a
 * second HTTP writer, independent task queue or speculative retry.
 */
internal class NativePhotoIncrementalWriter(
    private val journal: NativePhotoBackupIntentStore,
    private val completed: NativePhotoVerifiedReceiptIndex,
    private val ledger: NativePhotoBackupLedger = NativePhotoBackupLedger(journal),
) {
    suspend fun uploadOne(
        service: XDriveService,
        token: String,
        scope: NativePhotoBackupScope,
        verifiedDeviceId: String,
        root: DriveNode,
        source: NativePhotoIncrementalSource,
        original: NativePhotoStagedOriginal,
        currentSession: () -> Boolean,
        onProgress: (Long) -> Unit = {},
    ): NativePhotoIncrementalOutcome {
        require(token.isNotBlank() && verifiedDeviceId.isNotBlank() &&
            original.bytes > 0 && nativeBackupHex(original.sha256))
        check(root.id == scope.rootId && root.revision == scope.rootRevision &&
            root.isDirectory && root.parentId == null)
        val owner = NativePhotoBackupOwner(
            scope.origin, scope.serverInstanceId, scope.ownerId, scope.username,
            scope.rootId, scope.rootRevision, verifiedDeviceId,
        )
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Native photo Owner session changed" }

        // A root revision changes after normal uploads. An unresolved intent
        // from the *same stable Owner/device* must remain blocking even if
        // the current directory revision is different.
        compactConfirmedReceipts()
        val relevant = journal.read().filter { sameStableOwner(it.owner, owner) }
        check(relevant.none { it.requiresReadOnlyReconciliation }) {
            "An uncertain native original needs read-only Owner reconciliation"
        }
        val prior = relevant.firstOrNull {
            it.assetKey == source.assetKey && it.versionKey == source.versionKey &&
                it.resource == source.resource
        }
        if (prior != null) {
            check(prior.originalSha256 == original.sha256 &&
                prior.sizeBytes == original.bytes &&
                prior.destinationName == source.destinationName) {
                "Original version or destination changed"
            }
            if (prior.phase == NativePhotoBackupPhase.VERIFIED) {
                completed.recordVerified(prior)
                compactConfirmedReceipts()
                return NativePhotoIncrementalOutcome.ALREADY_VERIFIED
            }
            // A planned record with a different root revision must be
            // reverified explicitly; never create a second intent for it.
            check(prior.phase == NativePhotoBackupPhase.PLANNED && prior.owner == owner) {
                "Existing original intent needs explicit reconciliation"
            }
        }

        if (completed.findVerified(owner, source.assetKey, source.versionKey,
                source.resource, original.sha256, original.bytes) != null) {
            return NativePhotoIncrementalOutcome.ALREADY_VERIFIED
        }

        // Re-hash the *already staged* immutable source before recording a
        // possible network attempt. A changed MediaStore source was rejected
        // by the staging adapter before reaching this writer.
        check(original.verifyBeforeWrite()) { "Staged original changed" }
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Owner session changed before upload" }
        val intent = prior ?: ledger.plan(owner, source.assetKey, source.versionKey,
            source.resource, original.sha256, original.bytes, source.destinationName)
        check(intent.destinationName == source.destinationName) {
            "Photo upload needs an exact original destination for recovery"
        }

        // Exactly one durable MAY_HAVE_SENT prior to the first write.
        ledger.beginAttempt(owner, intent.id, original.sha256, original.bytes)
        var mayHaveSent = true
        try {
            val node = NativePhotoOneShotUploader.upload(
                service, token, scope, root, source.destinationName,
                original, currentSession, onProgress,
                resumeKey = NativePhotoResumeKey.forIntent(intent),
            )
            currentCoroutineContext().ensureActive()
            check(currentSession()) { "Owner session changed after Go finalize" }
            val receipt = NativePhotoBackupVerifiedReceipt(
                owner, node.id, node.revision, original.bytes, original.sha256)
            val verified = ledger.acknowledgeVerified(owner, intent.id, receipt)
            mayHaveSent = false
            // If this write fails, VERIFIED remains in the journal. Next
            // invocation repairs SQLite from the same checked Go receipt.
            completed.recordVerified(verified)
            compactConfirmedReceipts()
            return NativePhotoIncrementalOutcome.UPLOADED
        } catch (failure: Throwable) {
            if (mayHaveSent) {
                try {
                    ledger.markUnknownAck(owner, intent.id)
                } catch (storeError: Throwable) {
                    failure.addSuppressed(storeError)
                }
            }
            throw failure
        }
    }


    /**
     * Read-only exact Go lookup for uploads that MAY have reached the Server.
     * No POST /uploads, chunk, finalize, retry, network cleanup or inferred
     * success from absence of a record. Only a fresh Owner bearer + same
     * registered Android device can call this method (verified by caller).
     *
     * Sessions from older v1 journals lacking destinationName remain blocked;
     * the user must review them manually instead of guessing a name.
     */
    suspend fun reconcileUncertain(
        service: XDriveService,
        token: String,
        scope: NativePhotoBackupScope,
        verifiedDeviceId: String,
        currentSession: () -> Boolean,
        maxChecks: Int = 16,
    ): Int {
        require(token.isNotBlank() && verifiedDeviceId.isNotBlank() &&
            maxChecks in 1..NativePhotoBackupLedger.MAX_ENTRIES)
        val owner = NativePhotoBackupOwner(
            scope.origin, scope.serverInstanceId, scope.ownerId,
            scope.username, scope.rootId, scope.rootRevision, verifiedDeviceId)
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Photo Owner session changed before receipt review" }
        val waiting = journal.read().filter {
            sameStableOwner(it.owner, owner) && it.requiresReadOnlyReconciliation
        }
        check(waiting.size <= maxChecks) { "Too many unknown photo receipts to inspect" }
        var recovered = 0
        for (entry in waiting) {
            currentCoroutineContext().ensureActive()
            check(currentSession()) { "Owner session changed during read-only review" }
            val exactName = entry.destinationName
                ?: throw IllegalStateException("Legacy uncertain photo requires manual review")
            val result = service.inspectNativePhotoUpload(
                token, entry.owner.rootNodeId, exactName, entry.sizeBytes,
                entry.originalSha256, NativePhotoResumeKey.forIntent(entry))
            // ACTIVE is not a terminal ACK. 404/410/409 also remain unknown.
            if (result == null) continue
            check(result.id > 0 && result.parentId == entry.owner.rootNodeId &&
                result.name == exactName && result.type == "file" &&
                result.size == entry.sizeBytes && result.revision > 0) {
                "Read-only Owner upload result was not an exact original receipt"
            }
            currentCoroutineContext().ensureActive()
            check(currentSession()) { "Owner session changed after read-only review" }
            val verified = ledger.acknowledgeVerified(
                entry.owner, entry.id, NativePhotoBackupVerifiedReceipt(
                    entry.owner, result.id, result.revision,
                    entry.sizeBytes, entry.originalSha256))
            completed.recordVerified(verified)
            recovered++
        }
        compactConfirmedReceipts()
        // An ACTIVE or missing record is never permission for a new POST.
        check(journal.read().none {
            sameStableOwner(it.owner, owner) && it.requiresReadOnlyReconciliation
        }) { "Native original upload still needs explicit receipt review" }
        return recovered
    }

    /**
     * Every discarded VERIFIED intent already has the identical committed
     * SQLite receipt. This also safely prunes older Owners' verified entries
     * without revealing their inventory or touching their unknown attempts.
     */
    private fun compactConfirmedReceipts() {
        ledger.compactIndexedVerified { intent ->
            val receipt = completed.findVerified(
                intent.owner, intent.assetKey, intent.versionKey,
                intent.resource, intent.originalSha256, intent.sizeBytes,
            )
            receipt?.nodeId == intent.verifiedNodeId &&
                receipt?.nodeRevision == intent.verifiedNodeRevision
        }
    }

    private fun sameStableOwner(a: NativePhotoBackupOwner, b: NativePhotoBackupOwner): Boolean =
        a.copy(rootRevision = b.rootRevision) == b
}
