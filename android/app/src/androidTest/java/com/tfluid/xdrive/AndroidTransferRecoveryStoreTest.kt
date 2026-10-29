package com.tfluid.xdrive

import android.content.Context
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import java.security.KeyStore
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Actual API35 Android Keystore AES-GCM, not a mocked encryption adapter. */
class AndroidTransferRecoveryStoreTest {
    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext
    private val suffix = System.nanoTime().toString()
    private val pref = "test-xdrive-recovery-$suffix"
    private val keyAlias = "test-xdrive-recovery-key-$suffix"

    private fun store() = AndroidTransferRecoveryStore(context, pref, keyAlias)
    private val owner = TransferRecoveryOwner("https://drive.example", "owner")

    @After fun cleanup() {
        context.deleteSharedPreferences(pref)
        val androidKeys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (androidKeys.containsAlias(keyAlias)) androidKeys.deleteEntry(keyAlias)
    }

    @Test fun encryptedNoFilenameOrOwnerLeakAndRestartIsUnconfirmed() {
        val first = NativeTransferRecoveryLedger(store(),
            now = { 1_800_000_000_000L },
            newId = { "00000000-0000-4000-8000-000000000007" })
            .begin(owner, TransferRecoveryKind.UPLOAD)
        val raw = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
            .getString("sealed-v1", null)
        assertNotNull(raw)
        assertFalse(raw!!.contains("owner"))
        assertFalse(raw.contains("drive.example"))
        assertFalse(raw.contains("Bearer"))
        val rawBytes = Base64.decode(raw, Base64.NO_WRAP)
        assertTrue(rawBytes.size > 28)
        val afterRestart = NativeTransferRecoveryLedger(store())
        val mine = afterRestart.notices(owner)
        assertEquals(listOf(first), mine)
        assertEquals(TransferRecoveryRisk.UPLOAD_RESULT_UNCONFIRMED, mine.single().risk)
        assertTrue(afterRestart.notices(
            TransferRecoveryOwner("https://drive.example", "other")).isEmpty())
        assertTrue(afterRestart.acknowledgeVerified(owner, first.id))
        assertTrue(store().read().isEmpty())
        assertNull(context.getSharedPreferences(pref, Context.MODE_PRIVATE)
            .getString("sealed-v1", null))
    }

    @Test fun tamperedCiphertextAndDeletedKeyFailClosed() {
        val id = "00000000-0000-4000-8000-000000000009"
        NativeTransferRecoveryLedger(store(), newId = { id })
            .begin(owner, TransferRecoveryKind.DOWNLOAD)
        val prefs = context.getSharedPreferences(pref, Context.MODE_PRIVATE)
        val original = prefs.getString("sealed-v1", null)!!
        assertTrue(prefs.edit().putString("sealed-v1", "not-a-valid-seal").commit())
        try { store().read(); fail("tampered journal became empty") }
        catch (_: IllegalStateException) {}
        assertTrue(prefs.edit().putString("sealed-v1", original).commit())
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        keyStore.deleteEntry(keyAlias)
        try { store().read(); fail("key loss became empty success") }
        catch (_: IllegalStateException) {}
        // The unverified ciphertext is retained, not silently erased.
        assertEquals(original, prefs.getString("sealed-v1", null))
    }
}
