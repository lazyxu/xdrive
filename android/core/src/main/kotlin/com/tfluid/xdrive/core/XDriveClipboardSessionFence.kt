package com.tfluid.xdrive.core

/**
 * A manual lock, Owner change, or disposed native screen invalidates all
 * outstanding asynchronous Clipboard operations, including one that returns
 * after a new unlock of the same Owner. Only use from the Compose UI thread.
 */
class XDriveClipboardSessionFence {
    private var generation: Long = 0L

    fun capture(): Long = generation

    fun invalidate() {
        generation += 1L
    }

    fun accepts(snapshot: Long): Boolean = generation == snapshot
}
