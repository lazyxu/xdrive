package com.tfluid.xdrive.core

import kotlinx.coroutines.sync.Mutex

/**
 * Exactly one Android app-process Go UploadSession writer across all XDriveApi
 * instances: Files SAF, one-original Gallery, bounded photo batches and any
 * future WorkManager worker must use the same transport admission.
 *
 * This suspends (rather than starting a concurrent POST) while another upload
 * owns the writer. A cancelled waiter NEVER starts a new UploadSession, and
 * cancellation/failure of the owner releases the permit in finally.
 *
 * No device credentials, media IDs, files or backup task state are persisted.
 * A future multi-process Worker must additionally hold a cross-process lease;
 * the default Android WorkManager deployment runs in the app process.
 */
internal object NativeUploadAdmission {
    private val uploadMutex = Mutex()

    suspend fun <T> withWriter(block: suspend () -> T): T {
        // The waiting coroutine is cancellable before it owns the permit.
        uploadMutex.lock()
        return try {
            block()
        } finally {
            // A lost/cancelled Go finalize cannot strand the app writer.
            uploadMutex.unlock()
        }
    }
}
