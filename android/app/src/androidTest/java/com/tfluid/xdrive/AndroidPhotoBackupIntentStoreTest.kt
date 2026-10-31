package com.tfluid.xdrive

import android.content.Context
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.ServerAddress
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Physical Android Keystore instrumentation: does not use a mock cipher. */
class AndroidPhotoBackupIntentStoreTest {
    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext
    private val suffix = System.nanoTime().toString()
    private val pref = "test-photo-backup-intent-$suffix"
    private val alias = "test-photo-backup-intent-key-$suffix"
    private val owner = NativePhotoBackupOwner(
        ServerAddress.parse("https://drive.example").url,
        "server-installation", 51L, "owner", 1L, 2L, "android-device")
    private val key = "a".repeat(64)
    private val hash = "b".repeat(64)

    private fun store() = AndroidPhotoBackupIntentStore(context, pref, alias)
    private fun ledger() = NativePhotoBackupLedger(
        store(), now = { 1_800_000_000_000L },
        nextId = { "00000000-0000-4000-8000-000000000091" })

    @After fun cleanup() {
        context.deleteSharedPreferences(pref)
        val androidKeys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (androidKeys.containsAlias(alias)) androidKeys.deleteEntry(alias)
    }

    @Test fun ciphertextHidesOwnerAndSurvivesRestartAsUnconfirmed() {
        val planned = ledger().plan(owner, key, "c".repeat(64),
            NativePhotoBackupResource.STILL, hash, 4096L)
        ledger().beginAttempt(owner, planned.id, hash, 4096L)
        val raw = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
            .getString("sealed-v1", null)
        assertNotNull(raw)
        assertFalse(raw!!.contains("drive.example"))
        assertFalse(raw.contains("owner"))
        assertFalse(raw.contains(hash))
        assertFalse(raw.contains("Bearer"))
        assertTrue(Base64.decode(raw, Base64.NO_WRAP).size > 28)
        val reopened = ledger()
        assertEquals(NativePhotoBackupPhase.MAY_HAVE_SENT,
            reopened.inspect(owner).single().phase)
        assertTrue(reopened.inspect(owner).single().requiresReadOnlyReconciliation)
        assertTrue(reopened.inspect(owner.copy(ownerId = 99L)).isEmpty())
        assertTrue(reopened.inspect(owner.copy(instanceId = "new-installation")).isEmpty())
        reopened.markUnknownAck(owner, planned.id)
        assertEquals(NativePhotoBackupPhase.UNKNOWN_ACK,
            ledger().inspect(owner).single().phase)
        val proof = NativePhotoBackupVerifiedReceipt(owner, 42L, 3L, 4096L, hash)
        ledger().acknowledgeVerified(owner, planned.id, proof)
        assertEquals(NativePhotoBackupPhase.VERIFIED,
            ledger().inspect(owner).single().phase)
    }

    @Test fun tamperedCiphertextAndLostKeystoreKeyAreNotAnEmptyJournal() {
        ledger().plan(owner, key, "d".repeat(64),
            NativePhotoBackupResource.VIDEO, hash, 1234L)
        val prefs = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
        val saved = prefs.getString("sealed-v1", null)!!
        assertTrue(prefs.edit().putString("sealed-v1", "invalid").commit())
        assertThrows(IllegalStateException::class.java) { store().read() }
        assertEquals("invalid", prefs.getString("sealed-v1", null))
        assertTrue(prefs.edit().putString("sealed-v1", saved).commit())
        val androidKeys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        androidKeys.deleteEntry(alias)
        assertThrows(IllegalStateException::class.java) { store().read() }
        // Never replace unknown old intentions with a new empty store.
        assertEquals(saved, prefs.getString("sealed-v1", null))
    }
    @Test fun newOriginalNameSurvivesEncryptedRestartWithoutLeakingPrivatePath() {
        val destination = "xdrive-photo-" + "a".repeat(20) + "-" +
            "b".repeat(20) + ".heic"
        val planned = ledger().plan(owner, key, "d".repeat(64),
            NativePhotoBackupResource.STILL, hash, 4096L, destination)
        ledger().beginAttempt(owner, planned.id, hash, 4096L)
        val reopened = ledger().inspect(owner).single()
        assertEquals(destination, reopened.destinationName)
        assertEquals(NativePhotoBackupPhase.MAY_HAVE_SENT, reopened.phase)
        val raw = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
            .getString("sealed-v1", null)!!
        assertFalse(raw.contains(destination))
        assertFalse(raw.contains(owner.serverOrigin))
        // An old unextended ledger record remains readable, with no guessed
        // destination allowed for an uncertain ACK lookup.
        store().write(listOf(reopened.copy(destinationName = null)))
        assertNull(store().read().single().destinationName)
        assertEquals(NativePhotoBackupPhase.MAY_HAVE_SENT,
            store().read().single().phase)
    }

}
