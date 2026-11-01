package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativeSavedLoginPasswordsContractTest {
    @Test fun secureProfilesRequireHttpsCanonicalOwnerAndSafeLan() {
        val a = AndroidSavedLoginPasswords.profile("https://drive.example.com", "192.168.1.30", "owner")
        assertNotNull(a)
        assertEquals("owner", a!!.username)
        assertNull(AndroidSavedLoginPasswords.profile("http://drive.example.com", "", "owner"))
        assertNull(AndroidSavedLoginPasswords.profile("https://owner:secret@drive.example.com", "", "owner"))
        assertNull(AndroidSavedLoginPasswords.profile("https://drive.example.com/api", "", "owner"))
        assertNull(AndroidSavedLoginPasswords.profile("https://drive.example.com", "8.8.8.8", "owner"))
        assertNull(AndroidSavedLoginPasswords.profile("https://drive.example.com", "", "owner\nadmin"))
    }

    @Test fun changingServerOwnerOrLanAlwaysChangesPasswordIdentity() {
        val p = AndroidSavedLoginPasswords.profile("https://drive.example.com", "192.168.1.30", "owner")!!
        assertNotEquals(p.id, AndroidSavedLoginPasswords.profile("https://other.example.com", "192.168.1.30", "owner")?.id)
        assertNotEquals(p.id, AndroidSavedLoginPasswords.profile("https://drive.example.com", "192.168.1.30", "other")?.id)
        assertNotEquals(p.id, AndroidSavedLoginPasswords.profile("https://drive.example.com", "192.168.1.31", "owner")?.id)
    }
}
