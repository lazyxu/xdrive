package com.tfluid.xdrive

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.AuthSession
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Physical Android Keystore encryption; does not require a live xDrive Server. */
@RunWith(AndroidJUnit4::class)
class AndroidSessionStoreTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun refreshCredentialIsSealedAndCanBeRestoredAfterReopen() {
        val store = AndroidSessionStore(context)
        store.clear()
        try {
            store.save("https://drive.example", AuthSession("access-secret", "refresh-secret", "owner"))
            val raw = context.getSharedPreferences("auth-session", Context.MODE_PRIVATE)
                .getString("sealed-v1", "").orEmpty()
            assertTrue(raw.isNotBlank())
            assertFalse(raw.contains("refresh-secret"))
            assertFalse(raw.contains("access-secret"))
            assertEquals("refresh-secret", AndroidSessionStore(context).load()?.refreshToken)
            assertEquals("owner", AndroidSessionStore(context).load()?.username)
        } finally { store.clear() }
        assertNull(AndroidSessionStore(context).load())
    }

    @Test fun tamperingOrInsecureServerNeverRestoresSecrets() {
        val store = AndroidSessionStore(context)
        store.clear()
        try {
            assertThrows(IllegalArgumentException::class.java) {
                store.save("http://192.168.2.4", AuthSession("a", "r", "owner"))
            }
            assertNull(store.load())
            context.getSharedPreferences("auth-session", Context.MODE_PRIVATE).edit()
                .putString("sealed-v1", "broken").commit()
            assertNull(store.load())
            assertNull(context.getSharedPreferences("auth-session", Context.MODE_PRIVATE)
                .getString("sealed-v1", null))
        } finally { store.clear() }
    }
}
