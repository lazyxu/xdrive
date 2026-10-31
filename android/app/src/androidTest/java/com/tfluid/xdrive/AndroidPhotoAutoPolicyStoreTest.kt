package com.tfluid.xdrive

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.ServerAddress
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Tests real Android preference commits, not a fake WorkManager result. */
class AndroidPhotoAutoPolicyStoreTest {
    private val app = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "test-photo-auto-policy-" + System.nanoTime()
    private val owner = NativePhotoBackupOwner(
        ServerAddress.parse("https://drive.example").url,
        "instance-A", 19, "owner", 1, 2, "device-A")
    private fun store() = AndroidPhotoAutoPolicyStore(app, name)

    @After fun cleanup() { app.deleteSharedPreferences(name) }

    @Test fun optInRequiresExactInstanceOwnerDeviceAndEpoch() {
        val saved = store().enable(owner)
        assertTrue(store().matches(owner, saved.epoch))
        assertTrue(store().matches(owner.copy(rootRevision = 90), saved.epoch))
        assertFalse(store().matches(owner.copy(ownerId = 21), saved.epoch))
        assertFalse(store().matches(owner.copy(deviceId = "device-B"), saved.epoch))
        assertFalse(store().matches(owner.copy(instanceId = "instance-B"), saved.epoch))
        assertFalse(store().matches(owner.copy(serverOrigin =
            ServerAddress.parse("https://different.example").url), saved.epoch))
        assertFalse(store().matches(owner, "00000000-0000-4000-8000-000000000001"))
        assertEquals(saved.scopeHash, store().snapshot()?.scopeHash)
        assertTrue(store().updateIfCurrent(owner, saved.epoch,
            AndroidPhotoAutoPolicyStore.STATUS_SCANNED))
        assertEquals(AndroidPhotoAutoPolicyStore.STATUS_SCANNED,
            store().snapshot()?.status)
    }

    @Test fun logoutRevocationFencesAlreadyRunningWorkerAndDoesNotLeakScope() {
        val previous = store().enable(owner)
        assertTrue(store().updateIfCurrent(owner, previous.epoch,
            AndroidPhotoAutoPolicyStore.STATUS_RUNNING))
        val raw = app.getSharedPreferences(name, Context.MODE_PRIVATE)
            .getString("consent-v1", "")!!
        assertFalse(raw.contains("drive.example"))
        assertFalse(raw.contains("owner"))
        assertFalse(raw.contains("device-A"))
        store().disable()
        assertNull(store().snapshot())
        assertFalse(store().matches(owner, previous.epoch))
        assertFalse(store().updateBySnapshot(previous,
            AndroidPhotoAutoPolicyStore.STATUS_SCANNED))
        val next = store().enable(owner)
        assertNotEquals(previous.epoch, next.epoch)
        assertFalse(store().matches(owner, previous.epoch))
    }

    @Test fun unreadableConsentMustNotBecomeImplicitApproval() {
        store().enable(owner)
        assertTrue(app.getSharedPreferences(name, Context.MODE_PRIVATE)
            .edit().putString("consent-v1", "bad").commit())
        assertThrows(IllegalStateException::class.java) { store().snapshot() }
        assertThrows(IllegalStateException::class.java) {
            store().matches(owner, "00000000-0000-4000-8000-000000000001")
        }
        store().disable()
        assertNull(store().snapshot())
    }

    @Test fun ownerChangeCannotReclassifyAnotherOwnersUnconfirmedUpload() {
        val old = store().enable(owner)
        val replacement = store().enable(owner.copy(ownerId = 44))
        assertFalse(store().updateBySnapshot(old,
            AndroidPhotoAutoPolicyStore.STATUS_SCANNED))
        assertFalse(store().updateIfCurrent(owner, old.epoch,
            AndroidPhotoAutoPolicyStore.STATUS_SCANNED))
        assertEquals(replacement.scopeHash, store().snapshot()?.scopeHash)
        assertEquals(AndroidPhotoAutoPolicyStore.STATUS_WAITING,
            store().snapshot()?.status)
    }
}
