package com.tfluid.xdrive

import android.content.Context
import com.tfluid.xdrive.core.NativeAndroidPhotoRunCounts
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.NativePhotoOwnerPreflight
import com.tfluid.xdrive.core.XDriveService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

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
        runTrigger: String = "manual",
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
        // A native scheduled or foreground pass may read the existing Source,
        // but never silently create a new one or fall back to Owner root.
        // An explicitly configured destination is required for any new write.
        val managedDestination = service.nativeAndroidPhotoDestination(token, device)
        checkActive(currentSession)
        // Existing UNKNOWN_ACK/MAY_HAVE_SENT has priority over new scans.
        // One exact, current Owner /devices/self proof already occurred.
        // The read-only receipt query never starts a second UploadSession;
        // active, missing or expired sessions keep the journal write-blocked.
        writer.reconcileUncertain(
            service, token, initial, device.deviceId, currentSession,
            managedDevice = device,
            managedDestination = managedDestination)
        checkActive(currentSession)
        check(managedDestination.configured &&
            managedDestination.deviceId == device.deviceId &&
            managedDestination.sourceId != null &&
            managedDestination.sourceRevision != null &&
            managedDestination.targetNodeId != null) {
            "Configure this Android Device's managed photo destination before backup"
        }
        val scope = NativePhotoBackupOwner(
            initial.origin, initial.serverInstanceId, initial.ownerId,
            initial.username, initial.rootId, initial.rootRevision, device.deviceId,
            managedSourceId = requireNotNull(managedDestination.sourceId),
            managedTargetNodeId = requireNotNull(managedDestination.targetNodeId))
        val cursor = AndroidPhotoScanCursorStore(app)
        val durableAfter = cursor.readFor(scope)
        check(startAfterId == 0L || startAfterId == durableAfter) {
            "Photo cursor changed; reopen a verified Owner scan"
        }
        var scanned = 0
        var uploaded = 0
        var already = 0
        var after = if (startAfterId == 0L) durableAfter else startAfterId
        var exhausted = false

        // A real Server SourceRun now fences the managed target for the WHOLE
        // foreground/scheduled batch, including MediaStore staging gaps before
        // an UploadSession exists. A failed begin cannot fall back to Owner root.
        val sourceRun = service.beginNativeAndroidPhotoSourceRun(
            token, device, managedDestination, UUID.randomUUID().toString(), runTrigger)
        val heartbeatFailure = AtomicReference<Throwable?>(null)
        val parentJob = currentCoroutineContext()[Job]
        val heartbeat = CoroutineScope(
            currentCoroutineContext() + kotlinx.coroutines.SupervisorJob(parentJob)).launch {
            while (isActive) {
                delay(20_000)
                try {
                    service.heartbeatNativeAndroidPhotoSourceRun(
                        token, device, managedDestination, sourceRun)
                } catch (failure: Throwable) {
                    if (failure is CancellationException) throw failure
                    heartbeatFailure.set(failure)
                    break
                }
            }
        }
        fun verifyHeartbeat() {
            check(heartbeatFailure.get() == null) { "Android SourceRun heartbeat failed" }
        }
        fun runCounts(failed: Int = 0) = NativeAndroidPhotoRunCounts(
            scanned = scanned, uploaded = uploaded, alreadyVerified = already, failed = failed)
        var settled = false
        try {
        while (scanned < maxScanned && uploaded < maxUploads) {
            verifyHeartbeat()
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
                verifyHeartbeat()
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
                        onProgress = { verifyHeartbeat() },
                        managedDevice = device, managedDestination = managedDestination,
                    )) {
                        NativePhotoIncrementalOutcome.ALREADY_VERIFIED -> already++
                        NativePhotoIncrementalOutcome.UPLOADED -> uploaded++
                    }
                }
                // The writer returned only after a matched Go finalize receipt
                // was durably indexed, or an already-verified exact SQLite hit.
                // An exception/unknown ACK never advances this checkpoint.
                cursor.advanceVerified(scope, after, candidate.localId)
                scanned++
                after = candidate.localId
                verifyHeartbeat()
                // All counters are receipt-backed and cumulative. Failure to
                // persist SourceRun progress blocks the next original.
                service.progressNativeAndroidPhotoSourceRun(
                    token, device, managedDestination, sourceRun, runCounts())
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
        verifyHeartbeat()
        checkActive(currentSession)
        if (exhausted) {
            cursor.finishSweep(scope, after)
        }
        heartbeat.cancelAndJoin()
        service.finishNativeAndroidPhotoSourceRun(
            token, device, managedDestination, sourceRun, runCounts(), "completed")
        settled = true
        return NativePhotoForegroundBatchResult(
            scanned, uploaded, already, after, exhausted)
        } catch (failure: Throwable) {
            heartbeat.cancel()
            if (!settled) {
                // A cancellation, unknown CAS ACK or SourceRun network failure
                // NEVER becomes a successful batch. Terminal reporting is
                // best effort; durable real original receipts remain unchanged.
                withContext(NonCancellable) {
                    try {
                        service.finishNativeAndroidPhotoSourceRun(
                            token, device, managedDestination, sourceRun,
                            runCounts(), if (failure is CancellationException)
                                "cancelled" else "failed")
                    } catch (reportError: Throwable) {
                        if (reportError !== failure) failure.addSuppressed(reportError)
                    }
                }
            }
            throw failure
        } finally {
            withContext(NonCancellable) { heartbeat.cancelAndJoin() }
        }
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
