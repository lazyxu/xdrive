package com.tfluid.xdrive

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercise the real Android ACTION_CREATE_DOCUMENT contract. No provider
 * output is opened, no URI grant is persisted and no Owner is simulated. */
@RunWith(AndroidJUnit4::class)
class NativeSafExportContractTest {
    private val contract = NativeCreateDocument()

    @Test fun canceledOrMissingOrForeignSchemesNeverBecomeOutputUris() {
        val content = Intent().setData(Uri.parse("content://documents.example/d/1"))
        assertNull(contract.parseResult(Activity.RESULT_CANCELED, content))
        assertNull(contract.parseResult(Activity.RESULT_OK, null))
        assertNull(contract.parseResult(Activity.RESULT_OK,
            Intent().setData(Uri.parse("file:///sdcard/private.jpg"))))
        assertNull(contract.parseResult(Activity.RESULT_OK,
            Intent().setData(Uri.parse("https://example.test/owned.jpg"))))
    }

    @Test fun onlyContentUriFromSuccessfulOsPickerReachesOwnerTicketCheck() {
        val uri = Uri.parse("content://documents.example/document/one")
        assertEquals(uri, contract.parseResult(
            Activity.RESULT_OK, Intent().setData(uri)))
    }
}
