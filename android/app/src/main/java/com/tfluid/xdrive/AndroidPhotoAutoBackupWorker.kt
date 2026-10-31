package com.tfluid.xdrive

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.tfluid.xdrive.core.ConnectionRoute
import com.tfluid.xdrive.core.ConnectionRouteSelector
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.ServerAddress
import com.tfluid.xdrive.core.XDriveApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Periodic, explicitly approved Android original incremental batch.
 *
 * WorkData never carries a token, device secret, media ID, raw filename or
 * even a server URL. A remembered HTTPS Owner session is refreshed through
 * the SAME rotation gate as the UI, then live /me, /nodes/root and
 * /devices/self are checked before accessing a single original. This worker
 * cannot register an Android device or switch Owners.
 *
 * Each periodic invocation scans at most 128 MediaStore rows / uploads at
 * most 8 new originals. A verified-only cursor advances per confirmed row;
 * a lost finalize ACK blocks further writes until manual reconciliation.
 */
internal class AndroidPhotoAutoBackupWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        val policy = AndroidPhotoAutoPolicyStore(app)
        val consent = policy.snapshot() ?: return Result.success()
        if (!consent.enabled ||
            consent.status == AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW)
            return Result.success()

        if (!hasNativeFullPhotoVideoReadGrant(app)) {
            // Android 14 selected-only is NOT full library authorization.
            markStatus(consent, AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_PERMISSION)
            return Result.success()
        }

        val vault = AndroidSessionStore(app)
        val saved = vault.load()
        if (saved == null || !saved.server.startsWith("https://")) {
            markStatus(consent, AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION)
            return Result.success()
        }

        // A Worker never trusts WorkData or a saved username as proof of the
        // current Go Owner. No independent login/password or device enrollment.
        var verifiedOwner: NativePhotoBackupOwner? = null
        try {
            currentCoroutineContext().ensureActive()
            val origin = ServerAddress.parse(saved.server)
            val preference = app.getSharedPreferences("connection", Context.MODE_PRIVATE)
            val route = ConnectionRoute(
                lanIp = preference.getString("route.lan:${saved.server}", "").orEmpty())
            val resolver = deviceRouteDns(app.mainExecutor)
            val ip = ConnectionRouteSelector(resolve = resolver::lookup)
                .select(origin, route)
            XDriveApi(origin, connectionIp = ip).use { service ->
                currentCoroutineContext().ensureActive()
                // Shared AndroidSessionStore gate prevents the Worker and UI
                // from racing to consume one rotating refresh credential.
                val session = vault.coordinatedRefresh(
                    service, saved.server, saved.username)
                if (session.mustChangePassword) {
                    markStatus(consent,
                        AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION)
                    return Result.success()
                }
                val stillApproved = {
                    !isStopped && currentPolicyMatchesEpoch(policy, consent) &&
                        hasNativeFullPhotoVideoReadGrant(app)
                }
                val exact = AndroidPhotoDeviceCredentialStore(app).verifyExisting(
                    service, saved.server, session.accessToken, saved.username,
                    stillApproved)
                if (exact == null) {
                    markStatus(consent,
                        AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION)
                    return Result.success()
                }
                val owner = ownerWithDevice(exact.first, exact.second.deviceId)
                verifiedOwner = owner
                if (!policy.matches(owner, consent.epoch) ||
                    !stillApproved()) return Result.success()

                // The foreground Gallery batch has priority. Skipping a
                // competing schedule is NOT evidence of a completed backup.
                val page = NativePhotoBatchExecution.backgroundOrSkip {
                    if (!policy.updateIfCurrent(owner, consent.epoch,
                            AndroidPhotoAutoPolicyStore.STATUS_RUNNING))
                        return@backgroundOrSkip null
                    AndroidPhotoVerifiedIndex(app).use { index ->
                        NativePhotoForegroundBatch(
                            app, AndroidPhotoDeviceCredentialStore(app),
                            AndroidPhotoBackupIntentStore(app), index)
                            .run(service, session.accessToken, saved.server,
                                saved.username, stillApproved,
                                maxScanned = 128, maxUploads = 8)
                    }
                }
                if (page == null) return Result.success()
                if (!policy.updateIfCurrent(owner, consent.epoch,
                        AndroidPhotoAutoPolicyStore.STATUS_SCANNED))
                    return Result.success()
                return Result.success() // Only the page was scanned, not the whole library.
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            val owner = verifiedOwner
            if (owner != null) {
                // Any uncertain chunk/finalize result is kept in the journal.
                // This prevents WorkManager from ever turning a retry into
                // another POST before an authorized exact read-only receipt.
                policy.updateIfCurrent(owner, consent.epoch,
                    AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW)
            } else markStatus(consent,
                AndroidPhotoAutoPolicyStore.STATUS_REQUIRES_SESSION)
            return Result.failure()
        }
    }

    private fun ownerWithDevice(
        scope: NativePhotoBackupScope, deviceId: String,
    ) = NativePhotoBackupOwner(
        scope.origin, scope.serverInstanceId, scope.ownerId, scope.username,
        scope.rootId, scope.rootRevision, deviceId)

    private fun currentPolicyMatchesEpoch(
        policy: AndroidPhotoAutoPolicyStore,
        captured: AndroidPhotoAutoPolicyStore.Consent,
    ): Boolean {
        val now = policy.snapshot() ?: return false
        return now.enabled && now.scopeHash == captured.scopeHash &&
            now.epoch == captured.epoch &&
            now.status != AndroidPhotoAutoPolicyStore.STATUS_NEEDS_REVIEW
    }

    private fun markStatus(
        captured: AndroidPhotoAutoPolicyStore.Consent,
        status: String,
    ) {
        // Before live Owner proof there is no trusted NativePhotoBackupOwner.
        // Do not mutate another Owner's policy based on a stale snapshot.
        AndroidPhotoAutoPolicyStore(applicationContext)
            .updateBySnapshot(captured, status)
    }
}
