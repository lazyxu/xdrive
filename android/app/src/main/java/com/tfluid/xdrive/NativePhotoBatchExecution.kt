package com.tfluid.xdrive

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * One process-wide Android photo *batch* admission. This is distinct from
 * the lower-level NativeUploadAdmission used by ALL SAF/manual photo uploads.
 * A scheduled worker yields if an explicit foreground batch already owns the
 * checkpoint; it never races read/modify/write of the photo intent journal.
 */
internal object NativePhotoBatchExecution {
    private val lock = Mutex()

    suspend fun <T> foreground(block: suspend () -> T): T =
        lock.withLock { block() }

    /** A busy foreground session is a skipped schedule, not backup success. */
    suspend fun <T> backgroundOrSkip(block: suspend () -> T): T? {
        if (!lock.tryLock()) return null
        return try { block() } finally { lock.unlock() }
    }
}
