package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Foreground backup requires verified, session-bound consent; no silent retry. */
class NativePhotoBackupConfirmPolicyTest {
    @Test fun exactGalleryOwnerGrantAndFilenameAreAllRequired(): Unit {
        fun allowed(
            owner: Boolean = true, gallery: Boolean = true, original: Boolean = true,
            grant: Boolean = true, busy: Boolean = false, name: String = "photo.jpg",
        ): Boolean = nativePhotoBackupCanConfirm(owner, gallery, original, grant, busy, name)

        assertTrue(allowed())
        assertFalse(allowed(owner = false))
        assertFalse(allowed(gallery = false))
        assertFalse(allowed(original = false))
        assertFalse(allowed(grant = false))
        assertFalse(allowed(busy = true))
        assertFalse(allowed(name = ""))
        assertFalse(allowed(name = "../photo.jpg"))
        assertFalse(allowed(name = "photo?.jpg"))
    }
}
