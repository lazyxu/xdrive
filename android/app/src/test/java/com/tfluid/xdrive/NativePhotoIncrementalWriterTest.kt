package com.tfluid.xdrive

import com.tfluid.xdrive.core.AuthSession
import com.tfluid.xdrive.core.DriveNode
import com.tfluid.xdrive.core.NativePhotoBackupScope
import com.tfluid.xdrive.core.NodeRange
import com.tfluid.xdrive.core.ServerAddress
import com.tfluid.xdrive.core.XDriveService
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** Real staged bytes + a fake Go UploadSession and a durable in-memory checkpoint. */
class NativePhotoIncrementalWriterTest {
    private val scope = NativePhotoBackupScope(
        ServerAddress.parse("https://drive.example").url, "instance-A", 42L, "owner", 1L, 1L)
    private val root = DriveNode(1, null, "", "dir", revision = 1)
    private val deviceId = "00000000-0000-4000-8000-000000000120"

    private class Journal : NativePhotoBackupIntentStore {
        var rows: List<NativePhotoBackupIntent> = emptyList()
        override fun read(): List<NativePhotoBackupIntent> = rows.toList()
        override fun write(entries: List<NativePhotoBackupIntent>) {
            rows = entries.toList() // Simulated durable restart, not a fake ACK.
        }
    }

    private class Index : NativePhotoVerifiedReceiptIndex {
        private val rows = mutableMapOf<String, NativePhotoBackupIntent>()
        var failNextCommit = false
        override fun recordVerified(intent: NativePhotoBackupIntent) {
            require(intent.phase == NativePhotoBackupPhase.VERIFIED)
            if (failNextCommit) {
                failNextCommit = false
                throw IOException("SQLite unavailable after finalized receipt")
            }
            rows[intent.assetKey + ":" + intent.resource.name] = intent
        }
        override fun findVerified(
            owner: NativePhotoBackupOwner, assetKey: String, versionKey: String,
            resource: NativePhotoBackupResource, sha256: String, sizeBytes: Long,
        ): NativePhotoIndexedReceipt? {
            val row = rows[assetKey + ":" + resource.name] ?: return null
            return if (row.owner.copy(rootRevision = owner.rootRevision) == owner &&
                row.versionKey == versionKey && row.originalSha256 == sha256 &&
                row.sizeBytes == sizeBytes) NativePhotoIndexedReceipt(
                    requireNotNull(row.verifiedNodeId),
                    requireNotNull(row.verifiedNodeRevision))
            else null
        }
    }

    private class UploadService : XDriveService {
        var calls = 0
        var timeoutAfterSend = false
        var invalidReceipt = false
        var resumeKeyUsed: String? = null
        var recoveredNode: DriveNode? = null
        var lookups = 0
        override suspend fun login(username: String, password: String): AuthSession =
            error("not used")
        override suspend fun refresh(refreshToken: String): AuthSession =
            error("not used")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String,
        ): AuthSession = error("not used")
        override suspend fun root(accessToken: String) =
            DriveNode(1, null, "", "dir", revision = 1)
        override suspend fun children(
            accessToken: String, parentId: Long, offset: Int,
        ): NodeRange = error("not used")
        override suspend fun uploadNativePhotoOriginal(
            accessToken: String, parent: DriveNode, name: String, size: Long,
            originalSha256: String, resumeKey: String,
            openSource: () -> InputStream, onProgress: (Long) -> Unit,
        ): DriveNode {
            assertTrue(originalSha256.matches(Regex("[0-9a-f]{64}")))
            assertTrue(resumeKey.matches(Regex("and_[0-9a-f]{64}")))
            resumeKeyUsed = resumeKey
            return uploadFile(accessToken, parent, name, size, openSource, onProgress)
        }
        override suspend fun inspectNativePhotoUpload(
            accessToken: String, parentId: Long, name: String, size: Long,
            originalSha256: String, resumeKey: String,
        ): DriveNode? {
            check(accessToken == "owner-token" && parentId == 1L)
            assertEquals(resumeKeyUsed, resumeKey)
            assertEquals(6L, size)
            assertTrue(originalSha256.matches(Regex("[0-9a-f]{64}")))
            lookups++
            return recoveredNode
        }

        override suspend fun uploadFile(
            accessToken: String, parent: DriveNode, name: String, size: Long,
            openSource: () -> InputStream, onProgress: (Long) -> Unit,
        ): DriveNode {
            check(accessToken == "owner-token" && parent.id == 1L)
            val read = openSource().use { it.readBytes() }
            assertEquals(size, read.size.toLong())
            calls++
            onProgress(size)
            if (timeoutAfterSend) throw IOException("Lost finalize ACK")
            return DriveNode(200 + calls.toLong(), parent.id,
                if (invalidReceipt) "wrong-owner.jpg" else name,
                "file", size, revision = 10 + calls.toLong())
        }
    }

    private fun staged(): NativePhotoStagedOriginal {
        val bytes = byteArrayOf(1, 2, 3, 4, 5, 6)
        val file = File.createTempFile("xdrive-incremental-", ".original")
        file.writeBytes(bytes)
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return NativePhotoStagedOriginal(file, bytes.size.toLong(), hash)
    }

    private fun source(original: NativePhotoStagedOriginal, id: Long = 29L) =
        NativePhotoIncrementalSourceKey.fromOriginal(
            deviceId, id, false, "image/jpeg", 1000L, original)

    @Test fun firstUploadPersistsRealReceiptAndNextRunSkipsNetwork(): Unit = runBlocking {
        val journal = Journal()
        val index = Index()
        val service = UploadService()
        val writer = NativePhotoIncrementalWriter(journal, index)
        staged().use { original ->
            val identity = source(original)
            assertEquals(NativePhotoBackupResource.STILL, identity.resource)
            assertTrue(identity.destinationName.endsWith(".jpg"))
            assertEquals(NativePhotoIncrementalOutcome.UPLOADED, writer.uploadOne(
                service, "owner-token", scope, deviceId, root, identity, original, { true }))
            assertEquals(1, service.calls)
            // Journal entries are pruned only after SQLite stores the matching
            // finalized Go Node ID/revision, Owner, SHA and version.
            assertTrue(journal.rows.isEmpty())
            val owner = NativePhotoBackupOwner(scope.origin, scope.serverInstanceId,
                scope.ownerId, scope.username, scope.rootId, scope.rootRevision, deviceId)
            assertNotNull(index.findVerified(owner, identity.assetKey,
                identity.versionKey, identity.resource, original.sha256, original.bytes))
            assertEquals(NativePhotoIncrementalOutcome.ALREADY_VERIFIED, writer.uploadOne(
                service, "owner-token", scope, deviceId, root, identity, original, { true }))
            assertEquals(1, service.calls)
        }
    }

    @Test fun lostFinalizeAckPersistsUnknownAndCannotIssueSecondUpload(): Unit = runBlocking {
        val journal = Journal()
        val service = UploadService().apply { timeoutAfterSend = true }
        val writer = NativePhotoIncrementalWriter(journal, Index())
        staged().use { original ->
            val identity = source(original)
            assertThrows(IOException::class.java) {
                runBlocking { writer.uploadOne(service, "owner-token", scope, deviceId,
                    root, identity, original, { true }) }
            }
            assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK, journal.rows.single().phase)
            service.timeoutAfterSend = false
            assertThrows(IllegalStateException::class.java) {
                runBlocking { writer.uploadOne(service, "owner-token", scope, deviceId,
                    root, identity, original, { true }) }
            }
            assertEquals(1, service.calls)
            // Root revisions are mutable; they MUST NOT let uncertain uploads replay.
            val moved = scope.copy(rootRevision = 5)
            val newRoot = root.copy(revision = 5)
            assertThrows(IllegalStateException::class.java) {
                runBlocking { writer.uploadOne(service, "owner-token", moved, deviceId,
                    newRoot, identity, original, { true }) }
            }
            assertEquals(1, service.calls)
        }
    }

    @Test fun validAckThenIndexFailureRepairsFromJournalWithoutReupload(): Unit = runBlocking {
        val journal = Journal()
        val index = Index().apply { failNextCommit = true }
        val service = UploadService()
        val writer = NativePhotoIncrementalWriter(journal, index)
        staged().use { original ->
            val identity = source(original)
            assertThrows(IOException::class.java) {
                runBlocking { writer.uploadOne(service, "owner-token", scope, deviceId,
                    root, identity, original, { true }) }
            }
            assertEquals(1, service.calls)
            assertEquals(NativePhotoBackupPhase.VERIFIED, journal.rows.single().phase)
            assertEquals(NativePhotoIncrementalOutcome.ALREADY_VERIFIED, writer.uploadOne(
                service, "owner-token", scope, deviceId, root, identity, original, { true }))
            assertEquals(1, service.calls)
            assertTrue(journal.rows.isEmpty())
        }
    }

    @Test fun maliciousFinalizeReceiptNeverBecomesVerified(): Unit = runBlocking {
        val journal = Journal()
        val service = UploadService().apply { invalidReceipt = true }
        staged().use { original ->
            val identity = source(original)
            assertThrows(IllegalStateException::class.java) {
                runBlocking {
                    NativePhotoIncrementalWriter(journal, Index()).uploadOne(
                        service, "owner-token", scope, deviceId,
                        root, identity, original, { true })
                }
            }
            assertEquals(1, service.calls)
            assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK, journal.rows.single().phase)
        }
    }

    @Test fun identityKeysAreStableWithoutRawMediaIdAndRejectUnsupportedMime(): Unit {
        staged().use { original ->
            val first = source(original)
            assertEquals(first, source(original))
            assertNotEquals(first.assetKey, source(original, 30L).assetKey)
            assertEquals(64, first.versionKey.length)
            assertFalse(first.destinationName.contains(deviceId))
            assertFalse(first.destinationName.contains("-29-"))
            assertThrows(IllegalArgumentException::class.java) {
                NativePhotoIncrementalSourceKey.fromOriginal(
                    deviceId, 29, false, "application/pdf", 100, original)
            }
            assertThrows(IllegalArgumentException::class.java) {
                NativePhotoIncrementalSourceKey.fromOriginal(
                    deviceId, 29, true, "image/jpeg", 100, original)
            }
        }
    }

    @Test fun wrongRootOrExpiredOwnerSessionNeverBeginsUpload(): Unit = runBlocking {
        val journal = Journal()
        val service = UploadService()
        staged().use { original ->
            val identity = source(original)
            assertThrows(IllegalStateException::class.java) {
                runBlocking { NativePhotoIncrementalWriter(journal, Index()).uploadOne(
                    service, "owner-token", scope, deviceId,
                    root.copy(revision = 99), identity, original, { true }) }
            }
            assertThrows(IllegalStateException::class.java) {
                runBlocking { NativePhotoIncrementalWriter(journal, Index()).uploadOne(
                    service, "owner-token", scope, deviceId, root, identity, original,
                    { false }) }
            }
            assertEquals(0, service.calls)
            assertTrue(journal.rows.isEmpty())
        }
    }
    @Test fun unknownFinalizeAckResolvedByExactReadOnlyOwnerReceiptNeverReuploaded(): Unit =
        runBlocking {
            val journal = Journal()
            val index = Index()
            val service = UploadService().apply { timeoutAfterSend = true }
            val writer = NativePhotoIncrementalWriter(journal, index)
            staged().use { original ->
                val source = source(original)
                assertThrows(IOException::class.java) {
                    runBlocking { writer.uploadOne(
                        service, "owner-token", scope, deviceId,
                        root, source, original, { true }) }
                }
                val unresolved = journal.rows.single()
                assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK, unresolved.phase)
                assertEquals(source.destinationName, unresolved.destinationName)
                assertEquals(NativePhotoResumeKey.forIntent(unresolved), service.resumeKeyUsed)
                service.timeoutAfterSend = false
                // ACTIVE does NOT prove the write was finalized.
                assertThrows(IllegalStateException::class.java) {
                    runBlocking { writer.reconcileUncertain(
                        service, "owner-token", scope, deviceId, { true }) }
                }
                assertEquals(1, service.lookups)
                assertEquals(1, service.calls)
                assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK, journal.rows.single().phase)
                // This node represents an exact Go GET finalized proof; neither
                // a filename match nor an unverified byte counter is sufficient.
                service.recoveredNode = DriveNode(201, 1, source.destinationName,
                    "file", original.bytes, revision = 11)
                assertEquals(1, writer.reconcileUncertain(
                    service, "owner-token", scope, deviceId, { true }))
                assertEquals(1, service.calls)
                assertTrue(journal.rows.isEmpty()) // SQLite receipt then compaction.
                assertEquals(NativePhotoIncrementalOutcome.ALREADY_VERIFIED,
                    writer.uploadOne(service, "owner-token", scope, deviceId,
                        root, source, original, { true }))
                assertEquals(1, service.calls)
                assertEquals(2, service.lookups)
            }
        }

    @Test fun forgedOrMissingUnknownReceiptCannotClearJournal(): Unit = runBlocking {
        val journal = Journal()
        val service = UploadService().apply { timeoutAfterSend = true }
        val writer = NativePhotoIncrementalWriter(journal, Index())
        staged().use { original ->
            val source = source(original)
            assertThrows(IOException::class.java) {
                runBlocking { writer.uploadOne(
                    service, "owner-token", scope, deviceId,
                    root, source, original, { true }) }
            }
            service.recoveredNode = DriveNode(400, 1, "another-photo.jpg",
                "file", original.bytes, revision = 1)
            assertThrows(IllegalStateException::class.java) {
                runBlocking { writer.reconcileUncertain(
                    service, "owner-token", scope, deviceId, { true }) }
            }
            assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK, journal.rows.single().phase)
            assertEquals(1, service.calls)
            assertThrows(IllegalStateException::class.java) {
                runBlocking { writer.reconcileUncertain(
                    service, "owner-token", scope, deviceId, { false }) }
            }
            assertEquals(1, service.calls)
        }
    }

    @Test fun sameIntentKeySurvivesRootRevisionButChangesWithOwnerAndAsset() {
        staged().use { original ->
            val source = source(original)
            val owner = NativePhotoBackupOwner(
                scope.origin, scope.serverInstanceId, scope.ownerId,
                scope.username, scope.rootId, scope.rootRevision, deviceId)
            val journal = Journal()
            val item = NativePhotoBackupLedger(journal).plan(
                owner, source.assetKey, source.versionKey, source.resource,
                original.sha256, original.bytes, source.destinationName)
            val key = NativePhotoResumeKey.forIntent(item)
            assertTrue(key.matches(Regex("and_[0-9a-f]{64}")))
            assertEquals(key, NativePhotoResumeKey.forIntent(item.copy(
                owner = owner.copy(rootRevision = 99))))
            assertNotEquals(key, NativePhotoResumeKey.forIntent(item.copy(
                owner = owner.copy(ownerId = owner.ownerId + 1))))
            assertNotEquals(key, NativePhotoResumeKey.forIntent(item.copy(
                assetKey = "d".repeat(64))))
        }
    }

}
