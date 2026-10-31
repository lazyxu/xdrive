package com.tfluid.xdrive

import android.content.Context
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.NativePhotoOwnerPreflight
import com.tfluid.xdrive.core.XDriveService
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** One explicit foreground session, never an automatic WorkManager grant. */
internal data class NativePhotoForegroundBatchResult(
    val scanned: Int,
    val uploaded: Int,
    val alreadyVerified: Int,
    val nextAfterId: Long,
    val inventoryExhausted: Boolean,
)

/**
 * First real, bounded MediaStore-to-Go incremental foreground batch:
 *
 * 1. Reject partial Android 14 photo-only permission for whole-library reads.
 * 2. Authenticate the exact same Owner/Root and registered Android device by
 *    live /me, /nodes/root and read-only /devices/self; never enroll silently.
 * 3. Read up to one bounded MediaStore page at a time, stage+hash each original
 *    under the current grant, then reverify the same Owner/Root.
 * 4. Reuse NativePhotoIncrementalWriter and the existing global UploadSession
 *    writer supplied by the caller; skip only verified receipts.
 *
 * This class is deliberately not self-scheduling. The Activity/Controller must
 * first obtain explicit foreground consent and exclude its other upload writer.
 * Owner switch/logout, lost ACK, unknown ledger state, stale root or unreadable
 * media all stop the batch instead of retrying or reporting a false completion.
 */
internal class NativePhotoForegroundBatch(
    context: Context,
    private val credentials: AndroidPhotoDeviceCredentialStore,
    journal: NativePhotoBackupIntentStore,
    index: NativePhotoVerifiedReceiptIndex,
) {
    private val app = context.applicationContext
    private val writer = NativePhotoIncrementalWriter(journal, index)

    suspend fun run(
        service: XDriveService,
        token: String,
        origin: String,
        expectedUsername: String,
        currentSession: () -> Boolean,
        startAfterId: Long = 0,
        maxScanned: Int = 128,
        maxUploads: Int = 8,
        onProgress: (NativePhotoForegroundBatchResult) -> Unit = {},
    ): NativePhotoForegroundBatchResult {
        require(startAfterId >= 0 && maxScanned in 1..1024 &&
            maxUploads in 1..16 && maxUploads <= maxScanned)
        check(hasNativeFullPhotoVideoReadGrant(app)) {
            "Full Android photo AND video grant is required for this batch"
        }
        require(token.isNotBlank() && expectedUsername.isNotBlank())
        val (initial, device) = credentials.verifyExisting(
            service, origin, token, expectedUsername, currentSession)
            ?: throw IllegalStateException("Register this Android device explicitly before backup")
        checkActive(currentSession)
        var scanned = 0
        var uploaded = 0
        var already = 0
        var after = startAfterId
        var exhausted = false

        while (scanned < maxScanned && uploaded < maxUploads) {
            checkActive(currentSession)
            check(hasNativeFullPhotoVideoReadGrant(app)) {
                "Photo or video grant changed during incremental backup"
            }
            val limit = minOf(NativePhotoMediaStoreInventory.PAGE_SIZE, maxScanned - scanned)
            val page = NativePhotoMediaStoreInventory.next(app, after, limit)
            if (page.candidates.isEmpty()) {
                exhausted = true
                break
            }
            for (candidate in page.candidates) {
                checkActive(currentSession)
                // stageOriginal checks the exact canonical URI, size, timestamp,
                // visibility and current MediaStore permission before AND after
                // writing a disposable private source snapshot.
                NativePhotoMediaStoreInventory.stageOriginal(app, candidate).use { staged ->
                    val fresh = NativePhotoOwnerPreflight.verify(
                        service, origin, token, expectedUsername, currentSession)
                    check(sameRootIdentity(initial, fresh)) {
                        "Owner installation or Root changed during photo backup"
                    }
                    checkActive(currentSession)
                    val root = service.root(token)
                    check(root.id == fresh.rootId && root.revision == fresh.rootRevision &&
                        root.parentId == null && root.isDirectory) {
                        "Photo destination root revision changed before UploadSession"
                    }
                    val source = NativePhotoIncrementalSourceKey.fromOriginal(
                        device.deviceId, candidate.localId, candidate.isVideo,
                        candidate.mimeType, candidate.modifiedAtSeconds, staged)
                    when (writer.uploadOne(
                        service, token, fresh, device.deviceId, root, source,
                        staged, currentSession,
                    )) {
                        NativePhotoIncrementalOutcome.ALREADY_VERIFIED -> already++
                        NativePhotoIncrementalOutcome.UPLOADED -> uploaded++
                    }
                }
                scanned++
                after = candidate.localId
                onProgress(NativePhotoForegroundBatchResult(
                    scanned, uploaded, already, after, false))
                if (uploaded >= maxUploads) break
            }
            // A fully consumed short page is the only verified end-of-inventory.
            if (page.candidates.size < limit &&
                after == page.candidates.last().localId) {
                exhausted = true
                break
            }
        }
        checkActive(currentSession)
        return NativePhotoForegroundBatchResult(
            scanned, uploaded, already, after, exhausted)
    }

    private suspend fun checkActive(currentSession: () -> Boolean) {
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Native photo backup session changed" }
    }

    private fun sameRootIdentity(
        a: NativePhotoBackupScope, b: NativePhotoBackupScope,
    ): Boolean = a.origin == b.origin &&
        a.serverInstanceId == b.serverInstanceId &&
        a.ownerId == b.ownerId && a.username == b.username &&
        a.rootId == b.rootId
    // Root revision must evolve after successful original uploads.
}
