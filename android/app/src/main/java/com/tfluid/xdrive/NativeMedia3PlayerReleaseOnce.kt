package com.tfluid.xdrive

import java.util.concurrent.atomic.AtomicBoolean

/** Owns one exact Media3 decoder generation in a native Viewer. A terminal
 * error, Viewer exit and manual retry may race; release at most once. A
 * vendor's throwing stop must not prevent release. Authenticated Owner
 * connection lifetimes remain managed separately by the Controller. */
internal class NativeMedia3PlayerReleaseOnce(
    private val stop: () -> Unit,
    private val release: () -> Unit,
) {
    private val released = AtomicBoolean(false)
    val isReleased: Boolean get() = released.get()

    fun retireFailed() {
        if (!released.compareAndSet(false, true)) return
        runCatching { stop() }
        runCatching { release() }
    }

    fun dispose() {
        if (released.compareAndSet(false, true)) runCatching { release() }
    }
}
