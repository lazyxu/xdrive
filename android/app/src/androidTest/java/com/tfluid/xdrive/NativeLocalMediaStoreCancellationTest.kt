package com.tfluid.xdrive

import android.os.CancellationSignal
import android.os.OperationCanceledException
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

/** Native Compose lease + real Android CancellationSignal, not live photo grants. */
class NativeLocalMediaStoreCancellationTest {
    @get:Rule val compose = createComposeRule()

    @Test fun changingAlbumOrGrantEpochCancelsTheOldProviderSignal() {
        val latest = AtomicReference<CancellationSignal>()
        compose.setContent {
            var albumId by remember { mutableStateOf("a") }
            var permissionEpoch by remember { mutableIntStateOf(0) }
            var libraryEpoch by remember { mutableIntStateOf(0) }
            var allowed by remember { mutableStateOf(true) }
            var visible by remember { mutableStateOf(true) }
            val owner = remember { NativeLocalGalleryMemory() }
            Column {
                if (visible) {
                    val signal = rememberNativeLocalGalleryQuerySignal(
                        owner, 11L, true, albumId, permissionEpoch, libraryEpoch, allowed)
                    SideEffect { latest.set(signal) }
                    Text("本机媒体授权代次")
                }
                TextButton(onClick = { albumId = "b" },
                    modifier = Modifier.testTag("cancel-album")) { Text("相册") }
                TextButton(onClick = { permissionEpoch++ },
                    modifier = Modifier.testTag("cancel-grant")) { Text("授权变化") }
                TextButton(onClick = { libraryEpoch++ },
                    modifier = Modifier.testTag("cancel-library")) { Text("媒体库变化") }
                TextButton(onClick = { allowed = false },
                    modifier = Modifier.testTag("cancel-denied")) { Text("拒绝") }
                TextButton(onClick = { visible = false },
                    modifier = Modifier.testTag("cancel-dispose")) { Text("退出图库") }
            }
        }
        compose.waitForIdle()
        for (tag in listOf("cancel-album", "cancel-grant", "cancel-library",
                "cancel-denied")) {
            val before = latest.get()
            assertFalse(before.isCanceled)
            compose.onNodeWithTag(tag).performClick()
            compose.waitForIdle()
            assertTrue("$tag must cancel the in-flight provider query", before.isCanceled)
            assertNotSame(before, latest.get())
        }
        val beforeExit = latest.get()
        compose.onNodeWithTag("cancel-dispose").performClick()
        compose.waitForIdle()
        assertTrue("Disposing the Gallery must cancel its last query", beforeExit.isCanceled)
    }

    @Test fun alreadyCancelledSignalStopsPageAndAlbumScanBeforePermissionIsNeeded() {
        val resolver = InstrumentationRegistry.getInstrumentation().targetContext.contentResolver
        val signal = CancellationSignal().apply { cancel() }
        assertThrows(OperationCanceledException::class.java) {
            runBlocking { NativeLocalMediaStore.pageAfter(resolver, cancellationSignal = signal) }
        }
        assertThrows(OperationCanceledException::class.java) {
            runBlocking { NativeLocalMediaStore.albums(resolver, signal) }
        }
    }
}
