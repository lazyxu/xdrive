package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** Real Controller lifecycle and service contract; only host transport and
 * durable checkpoint filesystem are replaceable JVM fakes. */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveTransferRecoveryIntegrationTest {
    private val file = DriveNode(2L, 1L, "source.txt", "file", 3L, revision = 1)
    private val root = DriveNode(1L, name = "", type = "dir", revision = 1)

    private class Recovery : DriveTransferRecoveryBridge {
        val events = mutableListOf<String>()
        var failBegin = false
        var failClear = false
        var finishGate: CompletableDeferred<Unit>? = null
        var index = 0
        val entries = mutableListOf<NativeInterruptedTransfer>()
        override suspend fun begin(
            server: String, username: String, kind: NativeTransferKind,
        ): String {
            assertEquals("https://drive.example/", server)
            assertEquals("owner", username)
            events += "begin:${kind.name}"
            if (failBegin) throw IllegalStateException("synthetic storage failure")
            index++
            val item = NativeInterruptedTransfer("ticket-$index", kind,
                1_000L + index)
            entries += item
            return item.id
        }
        override suspend fun acknowledgeVerified(
            server: String, username: String, id: String,
        ): Boolean {
            assertEquals("https://drive.example/", server)
            assertEquals("owner", username)
            finishGate?.await()
            events += "verified"
            if (failClear) return false
            return entries.removeAll { it.id == id }
        }
        override suspend fun pending(
            server: String, username: String,
        ): List<NativeInterruptedTransfer> {
            assertEquals("https://drive.example/", server)
            assertEquals("owner", username)
            return entries.toList()
        }
    }

    private class Vault(val bridge: Recovery) : DriveSessionPersistence {
        override fun load(): SavedDriveSession? = null
        override fun save(server: String, session: AuthSession) = Unit
        override fun clear() = Unit
        override fun transferRecovery(): DriveTransferRecoveryBridge = bridge
    }

    private inner class Service(private val events: MutableList<String>) :
        XDriveService {
        var uploadFailure: Exception? = null
        var uploadCalls = 0
        var downloadCalls = 0
        override suspend fun login(username: String, password: String) =
            AuthSession("access", "refresh", username)
        override suspend fun refresh(refreshToken: String) =
            AuthSession("access", "refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(accessToken: String,
            currentPassword: String, newPassword: String) =
            AuthSession("access", "refresh", "owner")
        override suspend fun root(accessToken: String) = root
        override suspend fun children(
            accessToken: String, parentId: Long, offset: Int,
        ) = NodeRange(if (offset == 0) listOf(file) else emptyList(), 1L, offset)
        override suspend fun uploadFile(
            accessToken: String, parent: DriveNode, name: String, size: Long,
            openSource: () -> InputStream, onProgress: (Long) -> Unit,
        ): DriveNode {
            events += "upload"
            uploadCalls++
            uploadFailure?.let { throw it }
            openSource().use { it.readBytes() }
            onProgress(size)
            return DriveNode(8L, parent.id, name, "file", size, revision = 1)
        }
        override suspend fun downloadFile(
            accessToken: String, node: DriveNode,
            openDestination: () -> OutputStream, onProgress: (Long) -> Unit,
        ): Long {
            events += "download"
            downloadCalls++
            openDestination().use { it.write(byteArrayOf(97, 98, 99)) }
            onProgress(3L)
            return 3L
        }
    }

    @Test fun beginIsDurableBeforeUploadAndVerifiedOnlyAfterServerAck() = runTest {
        val recovery = Recovery()
        val events = recovery.events
        val service = Service(events)
        val c = DriveController(this, { service }, sessionPersistence = Vault(recovery))
        c.connectAndLogin("https://drive.example", false, "", "owner", "pw", true)
        runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3L) {
            events += "source"
            ByteArrayInputStream("abc".toByteArray())
        }
        runCurrent()
        assertEquals(listOf("begin:UPLOAD", "upload", "source", "verified"), events)
        assertEquals(1, service.uploadCalls)
        assertTrue(c.state.value.fileUploadCommitted)
        assertEquals(NativeTransferStatus.COMPLETED,
            c.state.value.nativeTransfers.first().status)
        assertTrue(recovery.entries.isEmpty())
        c.close()
    }

    @Test fun unwritableJournalFailsClosedBeforeReadingProviderOrSendingAnyBytes() = runTest {
        val recovery = Recovery().apply { failBegin = true }
        val service = Service(recovery.events)
        val c = DriveController(this, { service }, sessionPersistence = Vault(recovery))
        c.connectAndLogin("https://drive.example", false, "", "owner", "pw", true)
        runCurrent()
        assertTrue(c.prepareFileUpload())
        var opened = 0
        c.acceptFileUpload("new.txt", 3L) {
            opened++
            ByteArrayInputStream(byteArrayOf(1, 2, 3))
        }
        runCurrent()
        assertEquals(listOf("begin:UPLOAD"), recovery.events)
        assertEquals(0, service.uploadCalls)
        assertEquals(0, opened)
        assertFalse(c.state.value.fileUploadActive)
        assertTrue(c.state.value.error?.contains("尚未开始传输") == true)
        assertTrue(c.state.value.transferRecoveryIssue)
        c.close()
    }

    @Test fun lostUploadAckStaysUnconfirmedUntilExplicitOwnerReview() = runTest {
        val recovery = Recovery()
        val service = Service(recovery.events).apply {
            uploadFailure = ApiException(0, "synthetic lost finalize ACK")
        }
        val c = DriveController(this, { service }, sessionPersistence = Vault(recovery))
        c.connectAndLogin("https://drive.example", false, "", "owner", "pw", true)
        runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3L) {
            ByteArrayInputStream("abc".toByteArray())
        }
        runCurrent()
        assertEquals(listOf("begin:UPLOAD", "upload"), recovery.events)
        assertEquals(NativeTransferStatus.UNCONFIRMED,
            c.state.value.nativeTransfers.first().status)
        assertEquals(1, recovery.entries.size)
        c.refreshTransferRecoveryNotices()
        runCurrent()
        assertEquals(1, c.state.value.interruptedNativeTransfers.size)
        val id = c.state.value.interruptedNativeTransfers.single().id
        c.acknowledgeVerifiedInterruptedTransfer(id)
        runCurrent()
        assertTrue(recovery.entries.isEmpty())
        assertTrue(c.state.value.interruptedNativeTransfers.isEmpty())
        c.close()
    }

    @Test fun downloadRecordsBeforeSafOutputAndClearsOnVerifiedWrite() = runTest {
        val recovery = Recovery()
        val service = Service(recovery.events)
        val c = DriveController(this, { service }, sessionPersistence = Vault(recovery))
        c.connectAndLogin("https://drive.example", false, "", "owner", "pw", true)
        runCurrent()
        assertTrue(c.prepareFileExport(file))
        val output = ByteArrayOutputStream()
        var discarded = 0
        c.saveFileExport({ recovery.events += "output"; output }, { discarded++ })
        runCurrent()
        assertEquals(listOf("begin:DOWNLOAD", "download", "output", "verified"),
            recovery.events)
        assertEquals(1, service.downloadCalls)
        assertEquals(0, discarded)
        assertTrue(c.state.value.fileDownloadSaved)
        assertTrue(recovery.entries.isEmpty())
        c.close()
    }

    @Test fun cleanupFailureDoesNotUndoTrueAckButLeavesWarningAndMarker() = runTest {
        val recovery = Recovery().apply { failClear = true }
        val service = Service(recovery.events)
        val c = DriveController(this, { service }, sessionPersistence = Vault(recovery))
        c.connectAndLogin("https://drive.example", false, "", "owner", "pw", true)
        runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3L) {
            ByteArrayInputStream("abc".toByteArray())
        }
        runCurrent()
        assertEquals(1, service.uploadCalls)
        assertTrue(c.state.value.fileUploadCommitted)
        assertTrue(c.state.value.transferRecoveryIssue)
        assertEquals(1, recovery.entries.size)
        c.refreshTransferRecoveryNotices()
        runCurrent()
        assertEquals(1, c.state.value.interruptedNativeTransfers.size)
        c.close()
    }

    @Test fun verifiedCleanupCannotResurrectAnOldOwnerAfterLogout() = runTest {
        val gate = CompletableDeferred<Unit>()
        val recovery = Recovery().apply { finishGate = gate }
        val service = Service(recovery.events)
        val c = DriveController(this, { service }, sessionPersistence = Vault(recovery))
        c.connectAndLogin("https://drive.example", false, "", "owner", "pw", true)
        runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3L) {
            ByteArrayInputStream("abc".toByteArray())
        }
        runCurrent()
        // The original Server ACK is already verified, but the old
        // non-cancellable local Keystore cleanup is still waiting.
        assertEquals(1, service.uploadCalls)
        assertEquals(1, recovery.entries.size)
        c.logout()
        runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertEquals("", c.state.value.username)
        gate.complete(Unit)
        runCurrent()
        assertTrue(recovery.entries.isEmpty()) // safe exact-Owner cleanup
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertFalse(c.state.value.fileUploadCommitted)
        assertTrue(c.state.value.items.isEmpty())
        assertTrue(c.state.value.nativeTransfers.isEmpty())
        c.close()
    }
}
