package com.tfluid.xdrive.core

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** The same process-wide permit guards all Android XDriveApi upload instances. */
class NativeUploadAdmissionTest {
    @Test fun secondWriterCannotBeginUntilFirstFinalizesAndDisposes(): Unit = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val complete = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            NativeUploadAdmission.withWriter {
                order += "first-start"
                entered.complete(Unit)
                complete.await()
                order += "first-finish"
            }
        }
        entered.await()
        val second = async(start = CoroutineStart.UNDISPATCHED) {
            NativeUploadAdmission.withWriter {
                order += "second-start"
            }
        }
        assertFalse(second.isCompleted)
        assertEquals(listOf("first-start"), order)
        complete.complete(Unit)
        first.await()
        second.await()
        assertEquals(listOf("first-start", "first-finish", "second-start"), order)
    }

    @Test fun cancellingQueuedWorkerNeverStartsAnotherUpload(): Unit = runBlocking {
        val release = CompletableDeferred<Unit>()
        var otherEntered = false
        val first = async(start = CoroutineStart.UNDISPATCHED) {
            NativeUploadAdmission.withWriter { release.await() }
        }
        val queued = async(start = CoroutineStart.UNDISPATCHED) {
            NativeUploadAdmission.withWriter { otherEntered = true }
        }
        assertFalse(otherEntered)
        queued.cancelAndJoin()
        release.complete(Unit)
        first.await()
        assertFalse(otherEntered)
        NativeUploadAdmission.withWriter { assertFalse(otherEntered) }
    }

    @Test fun exceptionStillReleasesWriterAndNeverFakesSuccess(): Unit = runBlocking {
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                NativeUploadAdmission.withWriter<Unit> {
                    throw IllegalStateException("Go finalize did not confirm")
                }
            }
        }
        var acquired = false
        NativeUploadAdmission.withWriter { acquired = true }
        assertTrue(acquired)
    }
}
