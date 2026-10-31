package com.tfluid.xdrive

import com.tfluid.xdrive.core.ServerAddress
import org.junit.Assert.*
import org.junit.Test

/** Verified receipts alone may leave the 128-entry durable intent checkpoint. */
class NativePhotoIntentCompactionTest {
    private val owner = NativePhotoBackupOwner(
        ServerAddress.parse("https://drive.example").url, "instance-A",
        42, "owner", 1, 1, "android-device-A",
    )
    private val otherOwner = owner.copy(ownerId = 43, username = "other")
    private val sha = "a".repeat(64)
    private val version = "b".repeat(64)

    private class Journal : NativePhotoBackupIntentStore {
        var rows: List<NativePhotoBackupIntent> = emptyList()
        var failNextWrite = false
        override fun read() = rows.toList()
        override fun write(entries: List<NativePhotoBackupIntent>) {
            if (failNextWrite) {
                failNextWrite = false
                throw IllegalStateException("The private journal commit failed")
            }
            rows = entries.toList()
        }
    }

    private fun create(
        ledger: NativePhotoBackupLedger,
        asset: String,
        who: NativePhotoBackupOwner = owner,
        verified: Boolean = true,
    ): NativePhotoBackupIntent {
        val intent = ledger.plan(
            who, asset, version, NativePhotoBackupResource.STILL, sha, 100,
        )
        ledger.beginAttempt(who, intent.id, sha, 100)
        if (!verified) {
            ledger.markUnknownAck(who, intent.id)
            return intent
        }
        ledger.acknowledgeVerified(who, intent.id,
            NativePhotoBackupVerifiedReceipt(who, 200 + asset[0].code.toLong(),
                2, 100, sha))
        return intent
    }

    @Test fun onlyExactDurableIndexedVerifiedRowsCanBePruned() {
        val store = Journal()
        val ledger = NativePhotoBackupLedger(store)
        val a = create(ledger, "1".repeat(64))
        val b = create(ledger, "2".repeat(64), otherOwner)
        val pending = create(ledger, "3".repeat(64), verified = false)

        assertEquals(0, ledger.compactIndexedVerified { false })
        assertEquals(3, store.rows.size)
        val cleared = ledger.compactIndexedVerified { row ->
            row.id == a.id && row.phase == NativePhotoBackupPhase.VERIFIED
        }
        assertEquals(1, cleared)
        assertEquals(2, store.rows.size)
        assertTrue(store.rows.any { it.id == b.id &&
            it.phase == NativePhotoBackupPhase.VERIFIED })
        assertTrue(store.rows.any { it.id == pending.id &&
            it.phase == NativePhotoBackupPhase.UNKNOWN_ACK })

        assertEquals(1, ledger.compactIndexedVerified { true /* pending is excluded */ })
        assertEquals(1, store.rows.size)
        assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK, store.rows.single().phase)
    }

    @Test fun corruptIndexOrFailedJournalCommitDoesNotDiscardReceipt(): Unit {
        val store = Journal()
        val ledger = NativePhotoBackupLedger(store)
        val a = create(ledger, "4".repeat(64))
        assertThrows(IllegalStateException::class.java) {
            ledger.compactIndexedVerified { throw IllegalStateException("Unreadable index") }
        }
        assertEquals(a.id, store.rows.single().id)
        store.failNextWrite = true
        assertThrows(IllegalStateException::class.java) {
            ledger.compactIndexedVerified { true }
        }
        assertEquals(a.id, store.rows.single().id)
        assertEquals(NativePhotoBackupPhase.VERIFIED, store.rows.single().phase)
    }

    @Test fun moreThan128ConfirmedOriginalsDoNotExhaustTheCheckpoint(): Unit {
        val store = Journal()
        val ledger = NativePhotoBackupLedger(store)
        repeat(140) { i ->
            val asset = i.toString(16).padStart(64, '0')
            val row = create(ledger, asset)
            assertEquals(1, ledger.compactIndexedVerified { it.id == row.id })
            assertTrue(store.rows.isEmpty())
        }
    }
}
