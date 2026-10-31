package com.tfluid.xdrive

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.ServerAddress
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Real SharedPreferences persistence; no local original bytes or URI. */
class AndroidPhotoScanCursorStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val pref = "test-native-photo-cursor-" + System.nanoTime()
    private val owner = NativePhotoBackupOwner(
        ServerAddress.parse("https://drive.example").url, "instance-A",
        51, "owner", 1, 2, "device-A",
    )
    private fun cursor() = AndroidPhotoScanCursorStore(context, pref)

    @After fun cleanup() {
        context.deleteSharedPreferences(pref)
    }

    @Test fun committedVerifiedCursorResumesOnlySameOwnerAndDevice() {
        assertEquals(0L, cursor().readFor(owner))
        cursor().advanceVerified(owner, 0, 12)
        cursor().advanceVerified(owner.copy(rootRevision = 77), 12, 29)
        assertEquals(29L, cursor().readFor(owner))
        assertEquals(29L, cursor().readFor(owner.copy(rootRevision = 999)))
        assertEquals(0L, cursor().readFor(owner.copy(ownerId = 52)))
        assertEquals(0L, cursor().readFor(owner.copy(serverOrigin =
            ServerAddress.parse("https://other.example").url)))
        assertEquals(0L, cursor().readFor(owner.copy(instanceId = "instance-B")))
        assertEquals(0L, cursor().readFor(owner.copy(deviceId = "device-B")))
        assertEquals(0L, cursor().readFor(owner.copy(rootNodeId = 4)))

        val body = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
            .getString("scan-v1", null)!!
        assertFalse(body.contains("drive.example"))
        assertFalse(body.contains("owner"))
        assertFalse(body.contains("device-A"))
    }

    @Test fun rewindOnlyAfterExactVerifiedSweepAndAvoidStaleUpdates() {
        cursor().advanceVerified(owner, 0, 31)
        assertThrows(IllegalStateException::class.java) {
            cursor().advanceVerified(owner, 0, 32)
        }
        assertThrows(IllegalArgumentException::class.java) {
            cursor().advanceVerified(owner, 31, 30)
        }
        assertThrows(IllegalStateException::class.java) {
            cursor().finishSweep(owner, 29)
        }
        assertEquals(31L, cursor().readFor(owner))
        cursor().finishSweep(owner, 31)
        assertEquals(0L, cursor().readFor(owner))
        cursor().advanceVerified(owner, 0, 90)
        assertEquals(90L, cursor().readFor(owner))
    }

    @Test fun corruptCursorFailsClosedInsteadOfPretendingFreshScan() {
        cursor().advanceVerified(owner, 0, 15)
        val prefs = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
        assertTrue(prefs.edit().putString("scan-v1", "{malformed").commit())
        assertThrows(IllegalStateException::class.java) { cursor().readFor(owner) }
        assertEquals("{malformed", prefs.getString("scan-v1", null))
    }
}
