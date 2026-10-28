package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativeTransferRecoveryTest {
    private val ownerA = TransferRecoveryOwner("https://drive.example", "alice")
    private val ownerB = TransferRecoveryOwner("https://drive.example", "bob")

    private class MemoryStore : TransferRecoveryStore {
        var saved: List<TransferRecoveryMarker> = emptyList()
        var failSave = false
        var failRead = false
        var writes = 0
        override fun read(): List<TransferRecoveryMarker> {
            if (failRead) throw IllegalStateException("corrupt keystore")
            return saved.toList()
        }
        override fun write(entries: List<TransferRecoveryMarker>) {
            if (failSave) throw IllegalStateException("storage unavailable")
            saved = entries.toList()
            writes++
        }
    }
    private fun ledger(store: MemoryStore) = NativeTransferRecoveryLedger(
        store, now = { 1_800_000_000_000L },
        newId = { "00000000-0000-4000-8000-000000000001" },
    )

    @Test fun uploadAndDownloadRestartAreNeverInventedAsCompleted() {
        val store = MemoryStore()
        val first = ledger(store).begin(ownerA, TransferRecoveryKind.UPLOAD)
        val another = NativeTransferRecoveryLedger(
            store, now = { 1_800_000_000_001L },
            newId = { "00000000-0000-4000-8000-000000000002" },
        ).begin(ownerA, TransferRecoveryKind.DOWNLOAD)
        // Simulate a completely new process with only the durable store.
        val recovered = ledger(store).notices(ownerA)
        assertEquals(listOf(first.id, another.id), recovered.map { it.id })
        assertEquals(listOf(
            TransferRecoveryRisk.UPLOAD_RESULT_UNCONFIRMED,
            TransferRecoveryRisk.DOWNLOAD_INCOMPLETE,
        ), recovered.map { it.risk })
        assertFalse(recovered.toString().contains("alice"))
        assertFalse(recovered.toString().contains("drive.example"))
        assertFalse(recovered.toString().contains("Bearer"))
        assertEquals(2, store.writes)
    }

    @Test fun onlyExactOwnerCanInspectOrAcknowledge() {
        val store = MemoryStore()
        val entry = ledger(store).begin(ownerA, TransferRecoveryKind.UPLOAD)
        assertTrue(ledger(store).notices(ownerB).isEmpty())
        val otherServer = TransferRecoveryOwner("https://other.example", "alice")
        assertTrue(ledger(store).notices(otherServer).isEmpty())
        assertFalse(ledger(store).acknowledgeVerified(ownerB, entry.id))
        assertFalse(ledger(store).acknowledgeVerified(otherServer, entry.id))
        assertEquals(1, store.writes) // mismatched access cannot mutate journal
        assertTrue(ledger(store).acknowledgeVerified(ownerA, entry.id))
        assertTrue(ledger(store).notices(ownerA).isEmpty())
        assertFalse(ledger(store).acknowledgeVerified(ownerA, entry.id))
        assertEquals(2, store.writes)
    }

    @Test fun failedPersistenceBeforeNetworkMustStopNewTask() {
        val store = MemoryStore().apply { failSave = true }
        try {
            ledger(store).begin(ownerA, TransferRecoveryKind.UPLOAD)
            fail("Transport was allowed after failed journal commit")
        } catch (_: IllegalStateException) { }
        assertTrue(store.saved.isEmpty())
        assertEquals(0, store.writes)
        store.failSave = false
        val marker = ledger(store).begin(ownerA, TransferRecoveryKind.UPLOAD)
        store.failSave = true
        try {
            ledger(store).acknowledgeVerified(ownerA, marker.id)
            fail("Durable ACK loss was silently accepted")
        } catch (_: IllegalStateException) { }
        assertEquals(listOf(marker), store.saved)
    }

    @Test fun corruptJournalNeverLooksLikeEmptySuccess() {
        val store = MemoryStore()
        store.failRead = true
        try {
            ledger(store).notices(ownerA)
            fail("Corrupt journal produced empty notices")
        } catch (_: IllegalStateException) { }
        try {
            ledger(store).begin(ownerA, TransferRecoveryKind.UPLOAD)
            fail("Corrupt journal was overwritten by new task")
        } catch (_: IllegalStateException) { }
    }

    @Test fun boundedJournalDoesNotDropEarlierUnconfirmedUploads() {
        val store = MemoryStore()
        for (i in 1..NativeTransferRecoveryLedger.MAX_UNCONFIRMED_TRANSFERS) {
            val id = "00000000-0000-4000-8000-" + i.toString().padStart(12, '0')
            NativeTransferRecoveryLedger(store, { 1_800_000_000_000L }, { id })
                .begin(ownerA, TransferRecoveryKind.UPLOAD)
        }
        assertEquals(20, ledger(store).notices(ownerA).size)
        try {
            NativeTransferRecoveryLedger(store, { 1_800_000_000_000L },
                { "00000000-0000-4000-8000-000000000099" })
                .begin(ownerB, TransferRecoveryKind.DOWNLOAD)
            fail("Old unconfirmed records were dropped")
        } catch (_: IllegalStateException) {}
        assertEquals(20, store.saved.size)
    }

    @Test fun invalidIdentityAndDuplicateMarkerFailWithoutMutation() {
        // Android's canonical ServerAddress normalizes the origin root slash.
        assertEquals(ownerA, TransferRecoveryOwner("https://drive.example/", "alice"))
        assertEquals("https://drive.example/", ownerA.server)
        val store = MemoryStore()
        val first = ledger(store).begin(ownerA, TransferRecoveryKind.UPLOAD)
        try {
            ledger(store).begin(ownerA, TransferRecoveryKind.DOWNLOAD)
            fail("Duplicate marker ID accepted")
        } catch (_: IllegalStateException) {}
        assertEquals(listOf(first), store.saved)
        for ((server, name) in listOf(
            "http://drive.example" to "alice",
            "https://drive.example" to " ",
            "https://drive.example/a" to "alice",
        )) {
            try {
                TransferRecoveryOwner(server, name)
                fail("Unsafe Owner identity accepted")
            } catch (_: IllegalArgumentException) {}
        }
    }
}
