package com.tfluid.xdrive

import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Test

/** PDF is a disposable foreground read, never a durable transfer worker.
 * This policy is checked before every lifecycle-gated resource acquisition. */
class NativePdfForegroundLifecycleTest {
    @Test fun stalePreviousPageCannotPublishAfterNavigation() {
        assertTrue(nativePdfRenderMayPublish(
            requestedPage = 0, visiblePage = 0, ticket = 11, activeTicket = 11,
            leaseCurrent = true, viewerCurrent = true))
        assertFalse(nativePdfRenderMayPublish(
            requestedPage = 0, visiblePage = 1, ticket = 11, activeTicket = 12,
            leaseCurrent = true, viewerCurrent = true))
        assertTrue(nativePdfRenderMayPublish(
            requestedPage = 1, visiblePage = 1, ticket = 12, activeTicket = 12,
            leaseCurrent = true, viewerCurrent = true))
    }

    @Test fun rapidPageAtoBtoARejectsOldACompletion() {
        // The page is numerically the same again, but its first renderer
        // still belongs to an obsolete generation. This includes late
        // cancellation/finally blocks trying to clear the new loading state.
        assertFalse(nativePdfRenderMayComplete(
            requestedPage = 0, visiblePage = 0, ticket = 1, activeTicket = 3))
        assertFalse(nativePdfRenderMayPublish(
            requestedPage = 0, visiblePage = 0, ticket = 1, activeTicket = 3,
            leaseCurrent = true, viewerCurrent = true))
        assertTrue(nativePdfRenderMayComplete(
            requestedPage = 0, visiblePage = 0, ticket = 3, activeTicket = 3))
    }

    @Test fun staleOrClosedLeaseNeverPublishesPageOrPageError() {
        assertFalse(nativePdfRenderMayPublish(
            requestedPage = 2, visiblePage = 2, ticket = 8, activeTicket = 8,
            leaseCurrent = false, viewerCurrent = true))
        assertFalse(nativePdfRenderMayPublish(
            requestedPage = 2, visiblePage = 2, ticket = 8, activeTicket = 8,
            leaseCurrent = true, viewerCurrent = false))
        assertFalse(nativePdfRenderMayComplete(
            requestedPage = 2, visiblePage = 1, ticket = 8, activeTicket = 8))
    }

    @Test fun noPdfOwnerReadOrRenderBeforeFirstStart() {
        assertFalse(nativePdfForegroundPermitted(Lifecycle.State.INITIALIZED))
        assertFalse(nativePdfForegroundPermitted(Lifecycle.State.CREATED))
    }

    @Test fun onlyVisibleStartedOrResumedActivityMayOwnPdfRenderer() {
        assertTrue(nativePdfForegroundPermitted(Lifecycle.State.STARTED))
        assertTrue(nativePdfForegroundPermitted(Lifecycle.State.RESUMED))
    }

    @Test fun stoppedOrDestroyedActivityMustReleasePrivateLease() {
        // Android lifecycle returns to CREATED on STOP. A later START is
        // a *new* foreground session; no old temp PDF is authorized.
        assertTrue(nativePdfForegroundPermitted(Lifecycle.State.RESUMED))
        assertFalse(nativePdfForegroundPermitted(Lifecycle.State.CREATED))
        assertFalse(nativePdfForegroundPermitted(Lifecycle.State.DESTROYED))
        assertTrue(nativePdfForegroundPermitted(Lifecycle.State.STARTED))
    }
}
