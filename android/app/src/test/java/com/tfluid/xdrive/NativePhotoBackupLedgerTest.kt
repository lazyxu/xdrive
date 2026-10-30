package com.tfluid.xdrive

import com.tfluid.xdrive.core.ServerAddress
import org.junit.Assert.*
import org.junit.Test

class NativePhotoBackupLedgerTest {
    private val origin = ServerAddress.parse("https://drive.example").url
    private val owner = NativePhotoBackupOwner(
        origin, "postgres-instance-A", 51L, "owner", 1L, 4L, "android-device-A")
    private val otherOwner = owner.copy(ownerId = 52L, username = "other")
    private val changedInstance = owner.copy(instanceId = "postgres-instance-B")
    private val firstSha = "a".repeat(64)
    private val firstAsset = "b".repeat(64)
    private val firstVersion = "c".repeat(64)
    private val id = "00000000-0000-4000-8000-000000000091"

    private class Store : NativePhotoBackupIntentStore {
        var entries: List<NativePhotoBackupIntent> = emptyList()
        var rejectWrites = false
        var rejectReads = false
        var writes = 0

        override fun read(): List<NativePhotoBackupIntent> {
            if (rejectReads) error("unreadable")
            return entries
        }
        override fun write(entries: List<NativePhotoBackupIntent>) {
            if (rejectWrites) error("write failure")
            this.entries = entries.toList()
            writes++
        }
    }

    private fun ledger(store: Store, uuid: String = id) = NativePhotoBackupLedger(
        store, now = { 1_800_000_000_000L }, nextId = { uuid })
    private fun planned(store: Store) =
        ledger(store).plan(owner, firstAsset, firstVersion, NativePhotoBackupResource.STILL,
            firstSha, 4096L)
    private fun receipt(scope: NativePhotoBackupOwner = owner,
        hash: String = firstSha, size: Long = 4096L) =
        NativePhotoBackupVerifiedReceipt(scope, 103L, 7L, size, hash)

    @Test fun startRequiresCurrentOriginalAndDurableCheckpointBeforeNetwork() {
        val store = Store()
        val start = planned(store)
        assertTrue(start.eligibleForFirstAttempt)
        assertEquals(NativePhotoBackupPhase.PLANNED, store.entries.single().phase)
        assertThrows(IllegalStateException::class.java) {
            ledger(store).beginAttempt(owner, id, "e".repeat(64), 4096L)
        }
        assertThrows(IllegalStateException::class.java) {
            ledger(store).beginAttempt(owner, id, firstSha, 4095L)
        }
        store.rejectWrites = true
        assertThrows(IllegalStateException::class.java) {
            ledger(store).beginAttempt(owner, id, firstSha, 4096L)
        }
        assertEquals(NativePhotoBackupPhase.PLANNED, store.entries.single().phase)
        store.rejectWrites = false
        val marked = ledger(store).beginAttempt(owner, id, firstSha, 4096L)
        assertEquals(NativePhotoBackupPhase.MAY_HAVE_SENT, marked.phase)
        assertTrue(marked.requiresReadOnlyReconciliation)
        assertFalse(marked.eligibleForFirstAttempt)
    }

    @Test fun restartAndLostAckNeverAuthorizeBlindReplay() {
        val store = Store()
        planned(store)
        ledger(store).beginAttempt(owner, id, firstSha, 4096L)
        // New ledger represents process restart. MAY_HAVE_SENT is not retryable.
        val afterRestart = NativePhotoBackupLedger(store)
        assertTrue(afterRestart.inspect(owner).single().requiresReadOnlyReconciliation)
        assertThrows(IllegalStateException::class.java) {
            afterRestart.beginAttempt(owner, id, firstSha, 4096L)
        }
        afterRestart.markUnknownAck(owner, id)
        assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK,
            afterRestart.inspect(owner).single().phase)
        assertThrows(IllegalStateException::class.java) {
            afterRestart.beginAttempt(owner, id, firstSha, 4096L)
        }
        val verified = afterRestart.acknowledgeVerified(owner, id, receipt())
        assertEquals(NativePhotoBackupPhase.VERIFIED, verified.phase)
        assertEquals(103L, verified.verifiedNodeId)
        assertEquals(7L, verified.verifiedNodeRevision)
        assertFalse(verified.requiresReadOnlyReconciliation)
        assertEquals(verified, afterRestart.acknowledgeVerified(owner, id, receipt()))
        assertThrows(IllegalStateException::class.java) {
            afterRestart.beginAttempt(owner, id, firstSha, 4096L)
        }
    }

    @Test fun wrongOwnerInstanceAndResourceReceiptCannotFinalize() {
        val store = Store()
        planned(store)
        ledger(store).beginAttempt(owner, id, firstSha, 4096L)
        for (invalid in listOf(receipt(otherOwner), receipt(changedInstance),
            receipt(owner, "d".repeat(64)), receipt(owner, firstSha, 4097L))) {
            assertThrows(IllegalStateException::class.java) {
                ledger(store).acknowledgeVerified(owner, id, invalid)
            }
        }
        assertThrows(IllegalStateException::class.java) {
            ledger(store).markUnknownAck(otherOwner, id)
        }
        assertTrue(ledger(store).inspect(otherOwner).isEmpty())
        assertTrue(ledger(store).inspect(changedInstance).isEmpty())
        assertEquals(NativePhotoBackupPhase.MAY_HAVE_SENT,
            ledger(store).inspect(owner).single().phase)
    }

    @Test fun cannotClaimSuccessWithoutAnAttemptAndDuplicateVersionCannotChangeBytes() {
        val store = Store()
        val first = planned(store)
        val count = store.writes
        assertEquals(first, planned(store))
        assertEquals(count, store.writes)
        assertThrows(IllegalStateException::class.java) {
            ledger(store).plan(owner, firstAsset, firstVersion,
                NativePhotoBackupResource.STILL, "d".repeat(64), 4096L)
        }
        assertThrows(IllegalStateException::class.java) {
            ledger(store).acknowledgeVerified(owner, id, receipt())
        }
        assertEquals(NativePhotoBackupPhase.PLANNED, store.entries.single().phase)
    }

    @Test fun oneInFlightAndDifferentResourcesRemainIndependent() {
        val store = Store()
        planned(store)
        val secondId = "00000000-0000-4000-8000-000000000092"
        ledger(store, secondId).plan(owner, firstAsset, firstVersion,
            NativePhotoBackupResource.MOTION_VIDEO, "d".repeat(64), 2048L)
        ledger(store).beginAttempt(owner, id, firstSha, 4096L)
        assertThrows(IllegalStateException::class.java) {
            ledger(store).beginAttempt(owner, secondId, "d".repeat(64), 2048L)
        }
        ledger(store).markUnknownAck(owner, id)
        val next = ledger(store).beginAttempt(owner, secondId, "d".repeat(64), 2048L)
        assertEquals(NativePhotoBackupPhase.MAY_HAVE_SENT, next.phase)
        assertEquals(2, ledger(store).inspect(owner).size)
    }

    @Test fun malformedScopeAndCorruptStoreFailClosedWithoutReset() {
        assertThrows(IllegalArgumentException::class.java) {
            owner.copy(serverOrigin = "http://drive.example/")
        }
        assertThrows(IllegalArgumentException::class.java) {
            owner.copy(instanceId = "")
        }
        assertThrows(IllegalArgumentException::class.java) {
            owner.copy(rootNodeId = 0L)
        }
        val store = Store()
        planned(store)
        store.rejectReads = true
        assertThrows(IllegalStateException::class.java) {
            ledger(store).plan(owner, "f".repeat(64), firstVersion,
                NativePhotoBackupResource.VIDEO, firstSha, 100L)
        }
        assertEquals(1, store.entries.size)
        assertFalse(owner.toString().contains("drive.example"))
        assertFalse(store.entries.single().toString().contains(firstSha))
    }

    @Test fun hardCapacityFailsRatherThanDroppingUnreconciledRecords() {
        val store = Store()
        val ledger = NativePhotoBackupLedger(store, now = { 1_800_000_000_000L },
            nextId = { java.util.UUID.randomUUID().toString() })
        repeat(NativePhotoBackupLedger.MAX_ENTRIES) { i ->
            ledger.plan(owner, i.toString(16).padStart(64, '0'), firstVersion,
                NativePhotoBackupResource.VIDEO, firstSha, 1024L)
        }
        assertEquals(NativePhotoBackupLedger.MAX_ENTRIES, store.entries.size)
        assertThrows(IllegalStateException::class.java) {
            ledger.plan(owner, "f".repeat(64), firstVersion,
                NativePhotoBackupResource.VIDEO, firstSha, 1024L)
        }
        assertEquals(NativePhotoBackupLedger.MAX_ENTRIES, store.entries.size)
    }
}
