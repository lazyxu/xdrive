package com.tfluid.xdrive

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.repeatOnLifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises genuine Android lifecycle dispatch, not Owner GET or fake PDF
 * bytes. The production PDF viewer uses the same repeatOnLifecycle gate. */
@RunWith(AndroidJUnit4::class)
class NativePdfForegroundLifecycleAndroidTest {
    @Test fun startStopStartCancelsOldWorkBeforeAllowingAnotherSession() = runBlocking {
        val owner = object : LifecycleOwner {
            override val lifecycle = LifecycleRegistry(this)
        }
        val entered = AtomicInteger(0)
        val cleaned = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        fun move(state: Lifecycle.State) {
            instrumentation.runOnMainSync { owner.lifecycle.currentState = state }
        }
        val job = scope.launch {
            owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                assertTrue(nativePdfForegroundPermitted(owner.lifecycle.currentState))
                entered.incrementAndGet()
                try { awaitCancellation() }
                finally { cleaned.incrementAndGet() }
            }
        }
        try {
            move(Lifecycle.State.CREATED)
            assertEquals(0, entered.get())
            move(Lifecycle.State.STARTED)
            withTimeout(5_000) {
                while (entered.get() != 1) delay(10)
            }
            assertEquals(0, cleaned.get())
            // Android's ON_STOP moves a started Lifecycle back to CREATED.
            move(Lifecycle.State.CREATED)
            withTimeout(5_000) {
                while (cleaned.get() != 1) delay(10)
            }
            assertEquals(1, entered.get())
            // No old private lease is kept into the next onStart.
            move(Lifecycle.State.STARTED)
            withTimeout(5_000) {
                while (entered.get() != 2) delay(10)
            }
            assertEquals(1, cleaned.get())
        } finally {
            move(Lifecycle.State.DESTROYED)
            job.cancel()
            scope.cancel()
        }
    }
}
