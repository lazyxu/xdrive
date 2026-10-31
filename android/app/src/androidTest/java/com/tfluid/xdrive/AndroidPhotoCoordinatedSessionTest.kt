package com.tfluid.xdrive

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.AuthSession
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.NodeRange
import com.tfluid.xdrive.core.ServerAddress
import com.tfluid.xdrive.core.XDriveService
import java.security.KeyStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.supervisorScope
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Real keystore/prefs + two UI/Worker clients share one refresh rotation. */
class AndroidPhotoCoordinatedSessionTest {
    private val app = InstrumentationRegistry.getInstrumentation().targetContext
    private val suffix = System.nanoTime().toString()
    private val pref = "test-auto-refresh-$suffix"
    private val alias = "test-auto-key-$suffix"
    private val origin = ServerAddress.parse("https://drive.example").url
    private fun store() = AndroidSessionStore(app, pref, alias)

    @After fun cleanup() {
        app.deleteSharedPreferences(pref)
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (keys.containsAlias(alias)) keys.deleteEntry(alias)
    }

    private class Rotate(
        private val gateStart: CompletableDeferred<Unit>? = null,
        private val gateRelease: CompletableDeferred<Unit>? = null,
        private val mustChange: Boolean = false,
    ) : XDriveService {
        val seen = mutableListOf<String>()
        override suspend fun login(username: String, password: String): AuthSession =
            error("Login must never be called by automatic backup")
        override suspend fun refresh(refreshToken: String): AuthSession {
            seen += refreshToken
            gateStart?.complete(Unit)
            gateRelease?.await()
            return AuthSession("access-${seen.size}",
                "refresh-${seen.size}", "owner", mustChangePassword = mustChange)
        }
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String,
        ): AuthSession = error("unused")
        override suspend fun root(accessToken: String): DriveNode =
            error("No Owner request in token persistence unit test")
        override suspend fun children(
            accessToken: String, parentId: Long, offset: Int,
        ): NodeRange = error("No file scan in token persistence unit test")
    }

    @Test fun twoRefreshCallersConsumeLatestPersistedTokenInOrder(): Unit = runBlocking {
        store().save(origin, AuthSession("initial", "refresh-0", "owner"))
        val backend = Rotate()
        val ui = async(start = CoroutineStart.UNDISPATCHED) {
            store().coordinatedRefresh(backend, origin, "owner")
        }
        val worker = async(start = CoroutineStart.UNDISPATCHED) {
            store().coordinatedRefresh(backend, origin, "owner")
        }
        ui.await(); worker.await()
        assertEquals(listOf("refresh-0", "refresh-1"), backend.seen)
        assertEquals("refresh-2", store().load()?.refreshToken)
    }

    @Test fun logoutDuringNetworkRefreshCannotResurrectOldOwner(): Unit = runBlocking {
        // Expected async authentication rejection must not cancel the parent.
        supervisorScope {
        store().save(origin, AuthSession("initial", "refresh-0", "owner"))
        val started = CompletableDeferred<Unit>()
        val allowed = CompletableDeferred<Unit>()
        val backend = Rotate(started, allowed)
        val pending = async(start = CoroutineStart.UNDISPATCHED) {
            store().coordinatedRefresh(backend, origin, "owner")
        }
        started.await()
        store().clear()
        allowed.complete(Unit)
        assertNotNull(runCatching { pending.await() }.exceptionOrNull())
        assertNull(store().load())
        assertEquals(listOf("refresh-0"), backend.seen)
        }
    }

    @Test fun newOwnerLoginCannotBeOverwrittenByLateWorkerRefresh(): Unit = runBlocking {
        // Expected async authentication rejection must not cancel the parent.
        supervisorScope {
        store().save(origin, AuthSession("initial", "refresh-0", "owner"))
        val started = CompletableDeferred<Unit>()
        val allowed = CompletableDeferred<Unit>()
        val pending = async(start = CoroutineStart.UNDISPATCHED) {
            store().coordinatedRefresh(Rotate(started, allowed), origin, "owner")
        }
        started.await()
        store().save(origin, AuthSession("b", "owner-b-refresh", "other"))
        allowed.complete(Unit)
        assertNotNull(runCatching { pending.await() }.exceptionOrNull())
        assertEquals("other", store().load()?.username)
        assertEquals("owner-b-refresh", store().load()?.refreshToken)
        }
    }

    @Test fun mandatoryPasswordRotationIsPreservedForForegroundUi(): Unit = runBlocking {
        store().save(origin, AuthSession("initial", "refresh-0", "owner"))
        val renewed = store().coordinatedRefresh(
            Rotate(mustChange = true), origin, "owner")
        assertTrue(renewed.mustChangePassword)
        assertEquals("refresh-1", store().load()?.refreshToken)
    }
}
