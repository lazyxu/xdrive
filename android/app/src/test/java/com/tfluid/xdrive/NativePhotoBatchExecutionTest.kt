package com.tfluid.xdrive

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** Foreground batch ownership is independent of the shared Go HTTP writer. */
class NativePhotoBatchExecutionTest {
    @Test fun queuedWorkManagerTickSkipsWhileForegroundBatchOwnsLedger(): Unit = runBlocking {
        val release = CompletableDeferred<Unit>()
        val foreground = async(start = CoroutineStart.UNDISPATCHED) {
            NativePhotoBatchExecution.foreground { release.await() }
        }
        var backgroundRan = false
        val skipped = NativePhotoBatchExecution.backgroundOrSkip {
            backgroundRan = true
            1
        }
        assertNull(skipped)
        assertFalse(backgroundRan)
        release.complete(Unit)
        foreground.await()
        assertEquals(2, NativePhotoBatchExecution.backgroundOrSkip { 2 })
    }

    @Test fun cancellationReleasesBatchBeforeAnotherOwnerCanStart(): Unit = runBlocking {
        val parked = CompletableDeferred<Unit>()
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            NativePhotoBatchExecution.foreground { parked.await() }
        }
        assertNull(NativePhotoBatchExecution.backgroundOrSkip { "must not run" })
        first.cancelAndJoin()
        assertEquals("can run", NativePhotoBatchExecution.backgroundOrSkip { "can run" })
    }

    @Test fun exceptionNeverMakesSecondWorkerBelieveItAlreadyUploaded(): Unit = runBlocking {
        var caught = false
        try {
            NativePhotoBatchExecution.backgroundOrSkip<Int> {
                throw IllegalStateException("UploadSession ACK unknown")
            }
        } catch (_: IllegalStateException) { caught = true }
        assertTrue(caught)
        assertEquals(10, NativePhotoBatchExecution.backgroundOrSkip { 10 })
    }
}
