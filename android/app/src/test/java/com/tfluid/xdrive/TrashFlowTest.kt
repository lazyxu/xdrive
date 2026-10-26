package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TrashFlowTest {
    private class Service : XDriveService {
        val deleted = (1..101).map { index ->
            TrashEntry(DriveNode((index + 10).toLong(), 1, "file-$index.txt", "file",
                revision = 5), "2026-10-26T00:00:00Z")
        }.toMutableList()
        val offsets = mutableListOf<Int>()
        var restores = 0
        var lostAck = false
        override suspend fun login(username: String, password: String) =
            AuthSession("access", "refresh", username)
        override suspend fun refresh(refreshToken: String) =
            AuthSession("new-access", "new-refresh", "owner")
        override suspend fun logout(refreshToken: String) {}
        override suspend fun changePassword(accessToken: String, currentPassword: String,
            newPassword: String) = AuthSession("changed", "refresh", "owner")
        override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
        override suspend fun children(accessToken: String, parentId: Long, offset: Int) =
            NodeRange(emptyList(), 0, offset)
        override suspend fun trashPage(accessToken: String, offset: Int): TrashPage {
            offsets += offset
            return TrashPage(deleted.drop(offset).take(100), deleted.size.toLong(), offset)
        }
        override suspend fun restoreTrash(accessToken: String, original: DriveNode): DriveNode {
            restores++
            deleted.removeAll { it.node.id == original.id }
            if (lostAck) throw ApiException(0, "lost reply")
            return original.copy(revision = original.revision + 1)
        }
    }
    private fun open(scope: CoroutineScope, service: Service) =
        DriveController(scope, { service }).also {
            it.connect("https://drive.example", false)
            it.login("owner", "synthetic-password")
        }

    @Test fun `Trash reads two pages and restores once before refreshing`() = runTest {
        val service = Service()
        val c = open(this, service)
        runCurrent()
        c.openTrash()
        runCurrent()
        assertEquals(Screen.TRASH, c.state.value.screen)
        assertEquals(100, c.state.value.trashItems.size)
        assertEquals(101L, c.state.value.trashTotal)
        c.loadMoreTrash()
        runCurrent()
        assertEquals(101, c.state.value.trashItems.size)
        assertEquals(listOf(0, 100), service.offsets)
        val item = c.state.value.trashItems.last()
        c.restoreTrashItem(item)
        runCurrent()
        assertEquals(1, service.restores)
        assertEquals(100L, c.state.value.trashTotal)
        assertTrue(c.state.value.trashLoaded)
        assertFalse(c.state.value.trashItems.any { it.node.id == item.node.id })
        assertEquals(listOf(0, 100, 0), service.offsets)
        c.closeTrash()
        runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertTrue(c.state.value.trashItems.isEmpty())
        c.close()
    }

    @Test fun `Lost restore acknowledgement prevents duplicate POST until refreshed GET`() = runTest {
        val service = Service()
        val c = open(this, service)
        runCurrent()
        c.openTrash()
        runCurrent()
        val item = c.state.value.trashItems.first()
        service.lostAck = true
        c.restoreTrashItem(item)
        runCurrent()
        assertEquals(1, service.restores)
        assertTrue(c.state.value.trashRestoreAttempted)
        assertFalse(c.state.value.trashLoaded)
        c.restoreTrashItem(item)
        runCurrent()
        assertEquals(1, service.restores)
        c.refreshTrash()
        runCurrent()
        assertTrue(c.state.value.trashLoaded)
        assertFalse(c.state.value.trashRestoreAttempted)
        assertFalse(c.state.value.trashItems.any { it.node.id == item.node.id })
        c.close()
    }

    @Test fun `Delayed Trash response cannot repopulate a logged-out Owner`() = runTest {
        val delayed = CompletableDeferred<Unit>()
        val service = object : XDriveService {
            override suspend fun login(username: String, password: String) =
                AuthSession("access", "refresh", username)
            override suspend fun refresh(refreshToken: String) =
                AuthSession("access2", "refresh2", "owner")
            override suspend fun logout(refreshToken: String) {}
            override suspend fun changePassword(accessToken: String, currentPassword: String,
                newPassword: String) = AuthSession("access", "refresh", "owner")
            override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
            override suspend fun children(accessToken: String, parentId: Long, offset: Int) =
                NodeRange(emptyList(), 0, offset)
            override suspend fun trashPage(accessToken: String, offset: Int): TrashPage {
                withContext(NonCancellable) { delayed.await() }
                return TrashPage(listOf(TrashEntry(
                    DriveNode(42, 1, "private.txt", "file", revision = 1),
                    "2026-10-26T00:00:00Z")), 1, 0)
            }
        }
        val c = DriveController(this, { service })
        c.connect("https://drive.example", false)
        c.login("owner", "synthetic-password")
        runCurrent()
        c.openTrash()
        runCurrent()
        c.logout()
        runCurrent()
        delayed.complete(Unit)
        runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.trashItems.isEmpty())
        c.close()
    }
}
