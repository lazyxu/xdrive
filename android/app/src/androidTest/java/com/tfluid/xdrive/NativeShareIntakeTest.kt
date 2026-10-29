package com.tfluid.xdrive

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tfluid.xdrive.core.DriveNode
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real Android framework Intent and content Uri semantics. No external
 * provider, actual SAF grant or production Server is faked as verified. */
@RunWith(AndroidJUnit4::class)
class NativeShareIntakeTest {
    private val shared = Uri.parse("content://docs.example/document/abc123")
    private fun intent(uri: Uri = shared) = Intent(Intent.ACTION_SEND).apply {
        type = "image/jpeg"
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        putExtra(Intent.EXTRA_STREAM, uri)
    }

    @Test fun singleGrandedContentFileIsAcceptedOnlyForUserReview() {
        val input = intent()
        assertEquals(shared, nativeSingleShareCandidate(input))
        assertEquals(Intent.ACTION_SEND, input.action)
        assertEquals("content", shared.scheme)
        // The result holds only a URI. The Controller is not touched until
        // an explicit user confirmation and verified folder preflight.
    }

    @Test fun missingGrantOtherSchemesOrMultipleSourcesFailClosed() {
        val noGrant = intent().apply { flags = 0 }
        assertNull(nativeSingleShareCandidate(noGrant))
        assertNull(nativeSingleShareCandidate(intent(Uri.parse("file:///sdcard/p.jpg"))))
        assertNull(nativeSingleShareCandidate(intent(Uri.parse("https://example.com/p.jpg"))))
        assertNull(nativeSingleShareCandidate(intent(Uri.parse("content:///p.jpg"))))
        assertNull(nativeSingleShareCandidate(
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(shared))
            }))
        assertNull(nativeSingleShareCandidate(Intent(Intent.ACTION_SEND)))
        assertNull(nativeSingleShareCandidate(Intent(Intent.ACTION_SEND).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(Intent.EXTRA_TEXT, "Just text")
        }))
    }

    @Test fun forgedClipdataCannotAddSecondOrDifferentFile() {
        val different = Uri.parse("content://docs.example/document/other")
        val mismatch = intent().apply {
            clipData = ClipData.newRawUri("different", different)
        }
        assertNull(nativeSingleShareCandidate(mismatch))
        val multiple = intent().apply {
            clipData = ClipData.newRawUri("first", shared).also {
                it.addItem(ClipData.Item(different))
            }
        }
        assertNull(nativeSingleShareCandidate(multiple))
        val same = intent().apply { clipData = ClipData.newRawUri("same", shared) }
        assertEquals(shared, nativeSingleShareCandidate(same))
    }

    @Test fun providerMustSupplySafeExactNameAndSize() {
        assertEquals(NativeShareMetadata("photo.jpg", 1024),
            nativeShareMetadata("photo.jpg", 1024))
        assertEquals(NativeShareMetadata("empty.bin", 0),
            nativeShareMetadata("empty.bin", 0))
        for (bad in listOf(null, "", "../private", "a/b.jpg", "CON",
            "trailing.", "name|bad", "bad\nname")) {
            assertNull(nativeShareMetadata(bad, 10))
        }
        assertNull(nativeShareMetadata("a.jpg", null))
        assertNull(nativeShareMetadata("a.jpg", -1))
        assertNull(nativeShareMetadata("a.jpg", Long.MAX_VALUE))
    }

    @Test fun uploadTargetRequiresRealOwnerBrowseAndExactFolder() {
        val root = DriveNode(1, name = "", type = "dir", revision = 1)
        val owner = DriveState(
            screen = Screen.FILES, server = "https://drive.example",
            username = "owner", path = listOf(root), loaded = true,
        )
        val target = nativeShareTarget(owner)
        assertNotNull(target)
        assertEquals(1L, target!!.folderId)
        assertEquals("根目录", target.folderName)
        assertEquals(listOf(1L), target.pathIds)
        assertEquals(ShareOwnerIdentity("https://drive.example", "owner"),
            target.identity)
        assertNull(nativeShareTarget(owner.copy(screen = Screen.LOGIN)))
        assertNull(nativeShareTarget(owner.copy(screen = Screen.GALLERY)))
        assertNull(nativeShareTarget(owner.copy(screen = Screen.FILES,
            filesSection = FilesSection.RECENT)))
        assertNull(nativeShareTarget(owner.copy(loading = true)))
        assertNull(nativeShareTarget(owner.copy(browseSelectionMode = true)))
        assertNull(nativeShareTarget(owner.copy(fileUploadActive = true)))
        assertNull(nativeShareTarget(owner.copy(fileDownloadActive = true)))
        assertNull(nativeShareTarget(owner.copy(loaded = false)))
        assertNull(nativeShareTarget(owner.copy(path = emptyList())))
        assertNull(nativeShareTarget(owner.copy(username = "")))
        assertNull(nativeShareTarget(owner.copy(destinationKind = FilesTransferKind.COPY)))
    }
}
