package com.tfluid.xdrive

import androidx.lifecycle.Lifecycle
import org.junit.Assert.*
import org.junit.Test

/** PDF is a disposable foreground read, never a durable transfer worker.
 * This policy is checked before every lifecycle-gated resource acquisition. */
class NativePdfForegroundLifecycleTest {
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
