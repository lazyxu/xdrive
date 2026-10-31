package com.tfluid.xdrive

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * One persisted WorkManager schedule, never one WorkData token/photo/URI.
 * The caller has to verify current Owner, root, Android device, full media
 * permission and remembered HTTPS session BEFORE invoking enable().
 */
internal object AndroidPhotoAutoBackupScheduler {
    const val WORK_NAME = "xdrive-android-photo-original-incremental-v1"

    fun enable(context: Context, owner: NativePhotoBackupOwner) {
        val app = context.applicationContext
        val policy = AndroidPhotoAutoPolicyStore(app)
        policy.enable(owner)
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(true).build()
            val request = PeriodicWorkRequestBuilder<AndroidPhotoAutoBackupWorker>(
                15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .addTag(WORK_NAME)
                .build()
            WorkManager.getInstance(app).enqueueUniquePeriodicWork(
                WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        } catch (failure: Exception) {
            // A persisted 'enabled' badge without a scheduled WorkManager job
            // would be false. This is a pre-write failure; never fake success.
            policy.disable()
            throw failure
        }
    }

    fun disable(context: Context) {
        val app = context.applicationContext
        // Revoke first; an in-flight task's session callback checks this
        // synchronously before additional chunks or final ACK processing.
        AndroidPhotoAutoPolicyStore(app).disable()
        WorkManager.getInstance(app).cancelUniqueWork(WORK_NAME)
    }
}
