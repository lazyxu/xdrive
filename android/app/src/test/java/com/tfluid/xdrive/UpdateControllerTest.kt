package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class UpdateControllerTest {
    private val update = AndroidUpdate(3, "0.1.2", "https://github.com/lazyxu/xdrive/releases/download/snapshot/xdrive-android-3-0.1.2.apk", true)
    private class Service(var action: suspend (UpdateSource, Long) -> AndroidUpdate? = { _, _ -> null }) : AndroidUpdateService {
        override suspend fun check(source: UpdateSource, installedCode: Long) = action(source, installedCode)
    }
    @Test fun noLoginOrServerNeededAndSourcePreferenceIsPersisted() = runTest {
        var saved: UpdateSource? = null
        val service = Service { source, installed -> assertEquals(UpdateSource.GITLAB, source); assertEquals(2L, installed); update }
        val c = UpdateController(this, 2, "0.1.1", service, saveSource = { saved = it })
        c.show(); c.selectSource(UpdateSource.GITLAB); c.check(); runCurrent()
        assertEquals(UpdateSource.GITLAB, saved)
        assertEquals(update, c.state.value.result); assertTrue(c.state.value.visible)
        assertTrue(c.state.value.checked); assertFalse(c.state.value.checking)
        c.close()
    }
    @Test fun switchingSourceOrClosingRejectsLateResults() = runTest {
        for (close in listOf(false, true)) {
            val late = CompletableDeferred<AndroidUpdate?>()
            val c = UpdateController(this, 2, "0.1.1", Service { _, _ -> withContext(NonCancellable) { late.await() } })
            c.show(); c.check(); runCurrent()
            if (close) c.close() else c.selectSource(UpdateSource.GITLAB)
            late.complete(update); runCurrent()
            assertNull(c.state.value.result); assertFalse(c.state.value.checking)
            c.close()
        }
    }
    @Test fun dismissCancelsAndReopeningCannotShowStaleResult() = runTest {
        val late = CompletableDeferred<AndroidUpdate?>()
        val c = UpdateController(this, 2, "0.1.1", Service { _, _ -> withContext(NonCancellable) { late.await() } })
        c.show(); c.check(); runCurrent(); c.dismiss(); c.show()
        late.complete(update); runCurrent()
        assertTrue(c.state.value.visible); assertFalse(c.state.value.checked); assertNull(c.state.value.result)
        c.close()
    }
    @Test fun errorsAreSafeRetryableAndNotReportedAsCurrent() = runTest {
        val service = Service { _, _ -> throw java.io.IOException("private-fixture") }
        val c = UpdateController(this, 2, "0.1.1", service)
        c.show(); c.check(); runCurrent()
        assertNotNull(c.state.value.error); assertFalse(c.state.value.error!!.contains("private-fixture"))
        assertFalse(c.state.value.checked)
        service.action = { _, _ -> null }; c.check(); runCurrent()
        assertNull(c.state.value.error); assertTrue(c.state.value.checked); assertNull(c.state.value.result)
        c.close()
    }
    @Test fun browserFailureRetainsUpdateAndCanRetry() = runTest {
        val c = UpdateController(this, 2, "0.1.1", Service { _, _ -> update })
        c.show(); c.check(); runCurrent(); c.browserUnavailable()
        assertEquals(update, c.state.value.result); assertNotNull(c.state.value.error)
        c.close()
    }
}
