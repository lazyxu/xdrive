package com.tfluid.xdrive

import android.content.Context
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.NativeAndroidDeviceEnrollment
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.ServerAddress
import com.tfluid.xdrive.core.AuthSession
import com.tfluid.xdrive.core.NativeServerOwnerIdentity
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.NodeRange
import com.tfluid.xdrive.core.XDriveService
import kotlinx.coroutines.runBlocking
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

    private class OwnerVerifier(
        var identity: NativeServerOwnerIdentity =
            NativeServerOwnerIdentity(42, "owner", "user", "server-instance-A"),
        val onSelf: () -> Unit = {},
    ) : XDriveService {
        var reads = 0
        override suspend fun login(username: String, password: String): AuthSession =
            error("not used")
        override suspend fun refresh(refreshToken: String): AuthSession = error("not used")
        override suspend fun logout(refreshToken: String): Unit = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String
        ): AuthSession = error("not used")
        override suspend fun verifiedOwnerIdentity(accessToken: String): NativeServerOwnerIdentity {
            check(accessToken == "owner-bearer")
            return identity
        }
        override suspend fun root(accessToken: String): DriveNode =
            DriveNode(1, null, "", "dir", revision = 7)
        override suspend fun children(
            accessToken: String, parentId: Long, offset: Int,
        ): NodeRange = error("not used")
        override suspend fun verifyNativeAndroidDevice(
            accessToken: String, enrolled: NativeAndroidDeviceEnrollment,
        ) {
            check(accessToken == "owner-bearer")
            assertEquals("00000000-0000-4000-8000-000000000120", enrolled.deviceId)
            reads++
            onSelf()
        }
    }

    @Test fun savedIdentityRequiresFreshOwnerAndReadOnlySelfProof(): Unit = runBlocking {
        val s = store()
        // No saved registration must not make a device request or enroll.
        val api = OwnerVerifier()
        assertNull(s.verifyExisting(api, scope.origin, "owner-bearer", "owner") { true })
        assertEquals(0, api.reads)
        s.saveVerified(scope, device)
        val result = s.verifyExisting(api, scope.origin, "owner-bearer", "owner") { true }
        assertEquals(device, result?.second)
        assertEquals(1, api.reads)
        val foreign = OwnerVerifier(identity =
            NativeServerOwnerIdentity(42, "other", "user", "server-instance-A"))
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                s.verifyExisting(foreign, scope.origin, "owner-bearer", "owner") { true }
            }
        }
        assertEquals(0, foreign.reads)
        val changedServer = OwnerVerifier(identity =
            NativeServerOwnerIdentity(42, "owner", "user", "server-instance-B"))
        assertNull(s.verifyExisting(changedServer, scope.origin, "owner-bearer", "owner") { true })
        assertEquals(0, changedServer.reads)
        var sessionActive = true
        val logout = OwnerVerifier(onSelf = { sessionActive = false })
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                s.verifyExisting(logout, scope.origin, "owner-bearer", "owner") { sessionActive }
            }
        }
        assertEquals(1, logout.reads)
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
