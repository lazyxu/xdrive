package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DriveControllerTest {
    private val root = DriveNode(1, name = "", type = "dir")
    private val folder = DriveNode(2, 1, "照片", "dir")
    private val file = DriveNode(3, 1, "readme.txt", "file", 42)

    private open inner class Service : XDriveService {
        val calls = mutableListOf<Pair<Long, Int>>()
        var required = false
        var failure: Exception? = null
        var refreshed = 0
        var refreshFailure: Exception? = null
        var loggedOut = false
        var listing: suspend (Long, Int) -> NodeRange = { _, offset ->
            NodeRange(if (offset == 0) listOf(folder, file) else listOf(file), 101, offset)
        }
        override suspend fun login(username: String, password: String) = AuthSession("access", "refresh", username, required)
        override suspend fun refresh(refreshToken: String): AuthSession { refreshed++; refreshFailure?.let { throw it }; return AuthSession("new", "rotated", "owner") }
        override suspend fun logout(refreshToken: String) { loggedOut = true }
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String) = AuthSession("changed", "refresh", "owner")
        override suspend fun root(accessToken: String) = root
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange {
            calls += parentId to offset
            failure?.let { failure = null; throw it }
            return listing(parentId, offset)
        }
    }

    private fun controller(scope: CoroutineScope, api: Service) = DriveController(scope, { api }).also {
        it.connect("https://drive.example", false)
    }

    @Test fun loginNavigatesAndPagesReplaceRows() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(listOf(folder, file), c.state.value.items)
        c.nextPage(); runCurrent()
        assertEquals(100, c.state.value.offset)
        assertEquals(listOf(file), c.state.value.items)
        c.nextPage(); runCurrent()
        assertEquals(2, api.calls.size)
        c.previousPage(); runCurrent()
        assertEquals(0, c.state.value.offset)
    }

    @Test fun failedFolderNavigationKeepsPathAndRetriesIntendedFolder() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.failure = ApiException(500, "safe")
        c.open(folder); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
        assertNotNull(c.state.value.error)
        c.retry(); runCurrent()
        assertEquals(listOf(root, folder), c.state.value.path)
        c.back(); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
    }

    @Test fun logoutCancelsRequestAndRejectsLateCompletion() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        var cancelled = false
        api.listing = { _, _ ->
            try { awaitCancellation() } finally {
                cancelled = true
                withContext(NonCancellable) { late.await() }
            }
        }
        c.open(folder); runCurrent()
        c.logout(); runCurrent()
        assertTrue(cancelled)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        late.complete(NodeRange(listOf(file), 1, 0)); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertTrue(api.loggedOut)
    }

    @Test fun newNavigationRejectsNonCooperativeOldResponse() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        api.listing = { id, offset -> if (id == folder.id) withContext(NonCancellable) { late.await() } else NodeRange(listOf(file), 1, offset) }
        c.open(folder); runCurrent()
        c.refresh(); runCurrent()
        late.complete(NodeRange(listOf(folder), 1, 0)); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
        assertEquals(listOf(file), c.state.value.items)
    }

    @Test fun passwordChangeIsRequiredBeforeAnyFileRead() = runTest {
        val api = Service().apply { required = true }; val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.PASSWORD, c.state.value.screen)
        assertTrue(api.calls.isEmpty())
        c.changePassword("old", "new-password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(1, api.calls.size)
    }

    @Test fun wrongCurrentPasswordStaysOnFormWithoutRefreshAndCanRetry() = runTest {
        var attempts = 0
        val api = object : Service() {
            override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String): AuthSession {
                attempts++
                if (attempts == 1) {
                    throw ApiException(401, "Server request failed", ApiFailureReason.CURRENT_PASSWORD_INCORRECT)
                }
                assertEquals("access", accessToken)
                assertEquals("correct", currentPassword)
                return AuthSession("changed", "refresh", "owner")
            }
        }.apply { required = true }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changePassword("incorrect", "replacement"); runCurrent()
        assertEquals(Screen.PASSWORD, c.state.value.screen)
        assertEquals(0, api.refreshed)
        assertFalse(api.loggedOut)
        assertTrue(api.calls.isEmpty())
        assertFalse(c.state.value.loading)
        assertEquals("当前密码不正确，请重新输入。", c.state.value.error)
        c.changePassword("correct", "replacement"); runCurrent()
        assertEquals(2, attempts)
        assertEquals(Screen.FILES, c.state.value.screen)
        assertNull(c.state.value.error)
        c.close()
    }

    @Test fun expiredAccessRefreshesOnceAndRetries() = runTest {
        val api = Service().apply { failure = ApiException(401, "expired") }; val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(1, api.refreshed)
        assertEquals(2, api.calls.size)
        assertNull(c.state.value.error)
    }

    @Test fun changeServerImmediatelyClearsOwnerRowsAndSession() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeServer(); runCurrent()
        assertEquals(Screen.CONNECT, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertTrue(c.state.value.path.isEmpty())
        assertEquals("", c.state.value.username)
    }

    @Test fun revokedRefreshClearsExistingRowsAndRequiresLogin() = runTest {
        for (failure in listOf(ApiException(401, "revoked"), ApiException(403, "disabled"),
            java.io.IOException("lost ACK"), ApiException(0, "malformed response"))) {
            val api = Service(); val c = controller(this, api)
            c.login("owner", "password"); runCurrent()
            api.failure = ApiException(401, "expired")
            api.refreshFailure = failure
            c.refresh(); runCurrent()
            assertEquals(Screen.LOGIN, c.state.value.screen)
            assertTrue(c.state.value.items.isEmpty())
            assertTrue(c.state.value.path.isEmpty())
            assertEquals(1, api.refreshed)
            c.close()
        }
    }

    @Test fun firstPageFailureIsNotAnEmptyFolderAndRetryLoadsRoot() = runTest {
        val api = Service().apply { failure = ApiException(503, "failure") }; val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertFalse(c.state.value.loaded)
        assertNotNull(c.state.value.error)
        c.retry(); runCurrent()
        assertTrue(c.state.value.loaded)
        assertNull(c.state.value.error)
        assertEquals(listOf(root), c.state.value.path)
    }

    @Test fun oldLoginResponseCannotSignInAfterChangingServer() = runTest {
        val late = CompletableDeferred<AuthSession>()
        val api = object : Service() {
            override suspend fun login(username: String, password: String) = withContext(NonCancellable) { late.await() }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeServer(); runCurrent()
        late.complete(AuthSession("secret", "refresh", "old-owner")); runCurrent()
        assertEquals(Screen.CONNECT, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertEquals("", c.state.value.username)
        assertTrue(api.calls.isEmpty())
    }
}
