package com.tfluid.xdrive

import android.content.Context
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.NativeAndroidDeviceEnrollment
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.ServerAddress
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Real Android Keystore and committed private preferences; not a mock cipher. */
class AndroidPhotoDeviceCredentialStoreTest {
    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext
    private val suffix = System.nanoTime().toString()
    private val pref = "test-photo-device-pref-$suffix"
    private val alias = "test-photo-device-key-$suffix"
    private val scope = NativePhotoBackupScope(
        ServerAddress.parse("https://drive.example").url,
        "server-instance-A", 42L, "owner", 1L, 3L,
    )
    private val device = NativeAndroidDeviceEnrollment(
        "00000000-0000-4000-8000-000000000120",
        "A".repeat(43), "Android Photos", "0.1",
    )
    private fun store() = AndroidPhotoDeviceCredentialStore(context, pref, alias)

    @After fun cleanup(): Unit {
        context.deleteSharedPreferences(pref)
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keys.containsAlias(alias)) keys.deleteEntry(alias)
    }

    @Test fun oneTimeDeviceCredentialIsSealedAndScopedAcrossRestarts(): Unit {
        store().saveVerified(scope, device)
        val raw = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
            .getString("sealed-v1", null)
        assertNotNull(raw)
        assertFalse(raw!!.contains(device.deviceToken))
        assertFalse(raw.contains("drive.example"))
        assertTrue(Base64.decode(raw, Base64.NO_WRAP).size > 28)
        // Reopen a new store after Activity/process reconstruction.
        assertEquals(device, store().readFor(scope.copy(rootRevision = 99)))
        assertNull(store().readFor(scope.copy(ownerId = 43L)))
        assertNull(store().readFor(scope.copy(serverInstanceId = "server-instance-B")))
        assertNull(store().readFor(scope.copy(rootId = 9L)))
        assertFalse(device.toString().contains(device.deviceToken))
        assertFalse(device.toString().contains(device.deviceId))
    }

    @Test fun existingEnrollmentRequiresExplicitResetNotSilentReplacement(): Unit {
        val s = store()
        s.saveVerified(scope, device)
        s.saveVerified(scope.copy(rootRevision = 7), device)
        assertThrows(IllegalStateException::class.java) {
            s.saveVerified(scope.copy(ownerId = 43L), device)
        }
        assertThrows(IllegalStateException::class.java) {
            s.saveVerified(scope, device.copy(deviceToken = "B".repeat(43)))
        }
        assertEquals(device, s.readFor(scope))
        s.clearByUser()
        assertNull(s.readFor(scope))
        s.saveVerified(scope.copy(ownerId = 43L), device.copy(
            deviceId = "00000000-0000-4000-8000-000000000121"))
        assertNull(s.readFor(scope))
    }

    @Test fun tamperingOrKeystoreLossCannotLookLikeNoEnrollment(): Unit {
        val s = store()
        s.saveVerified(scope, device)
        val prefs = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
        val sealed = prefs.getString("sealed-v1", null)!!
        assertTrue(prefs.edit().putString("sealed-v1", "invalid").commit())
        assertThrows(IllegalStateException::class.java) { s.readFor(scope) }
        assertEquals("invalid", prefs.getString("sealed-v1", null))
        assertTrue(prefs.edit().putString("sealed-v1", sealed).commit())
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        keys.deleteEntry(alias)
        assertThrows(IllegalStateException::class.java) { s.readFor(scope) }
        assertEquals(sealed, prefs.getString("sealed-v1", null))
    }
}
