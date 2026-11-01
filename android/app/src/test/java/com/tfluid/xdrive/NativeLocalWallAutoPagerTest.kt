package com.tfluid.xdrive

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure native gallery paging gate; MediaStore cursor/permission reads remain unchanged. */
class NativeLocalWallAutoPagerTest {
    private val first = NativeLocalPageKey(200, 100)
    private val older = NativeLocalPageKey(199, 999)

    private fun viewport(
        gesture: Boolean = true,
        last: Int = 60,
        count: Int = 64,
        cursor: NativeLocalPageKey? = first,
        ready: Boolean = true,
    ) = NativeLocalWallPageViewport(gesture, last, count, cursor, ready)

    @Test fun shortGridAndRestoredViewportDoNotImplicitlyWalkTheLibrary() {
        val pager = NativeLocalWallAutoPager()
        assertFalse(pager.shouldRequest(viewport(gesture = false, last = 64)))
        assertFalse(pager.shouldRequest(viewport(gesture = false, last = 200, count = 201)))
        assertFalse(pager.shouldRequest(viewport(last = -1)))
        assertFalse(pager.shouldRequest(viewport(last = 10)))
        assertTrue(pager.shouldRequest(viewport(last = 52)))
        assertFalse(pager.shouldRequest(viewport(last = 63)))
    }

    @Test fun onlyOneAutomaticRequestForEachStableKeysetCursor() {
        val pager = NativeLocalWallAutoPager()
        assertTrue(pager.shouldRequest(viewport()))
        assertFalse(pager.shouldRequest(viewport(ready = false)))
        assertFalse(pager.shouldRequest(viewport()))
        assertFalse(pager.shouldRequest(viewport(count = 128, last = 70, cursor = older)))
        assertTrue(pager.shouldRequest(viewport(count = 128, last = 120, cursor = older)))
        assertFalse(pager.shouldRequest(viewport(count = 128, last = 127, cursor = older)))
    }

    @Test fun pendingFailedExhaustedOrRevokedPagesNeverRequest() {
        val pager = NativeLocalWallAutoPager()
        assertFalse(pager.shouldRequest(viewport(ready = false)))
        assertFalse(pager.shouldRequest(viewport(cursor = null)))
        assertFalse(pager.shouldRequest(viewport(count = 0)))
        assertTrue(pager.shouldRequest(viewport()))
    }

    @Test fun newAuthorizedSourceStartsDisarmedWithoutOldCursorLease() {
        val previous = NativeLocalWallAutoPager()
        assertTrue(previous.shouldRequest(viewport()))
        val nextSource = NativeLocalWallAutoPager()
        assertFalse(nextSource.shouldRequest(viewport(gesture = false)))
        assertTrue(nextSource.shouldRequest(viewport()))
    }
}
