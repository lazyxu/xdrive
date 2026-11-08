package com.tfluid.xdrive.core

import org.junit.Assert.*
import org.junit.Test

/** Executable JVM regression for the native Clipboard asynchronous lifecycle. */
class XDriveClipboardSessionFenceTest {
    @Test fun lateUnlockCannotRestoreKeyAfterManualLock() {
        val fence = XDriveClipboardSessionFence()
        val unlockStarted = fence.capture()
        fence.invalidate() // Lock while network authorization is pending.
        assertFalse(fence.accepts(unlockStarted))
    }

    @Test fun lateMutationFromPreviousUnlockCannotModifySameOwner() {
        val fence = XDriveClipboardSessionFence()
        val pendingCreate = fence.capture()
        fence.invalidate() // Lock.
        val newUnlock = fence.capture() // Same Owner, new vault unlock.
        assertFalse(fence.accepts(pendingCreate))
        assertTrue(fence.accepts(newUnlock))
    }

    @Test fun pageDisposalOrOwnerSwitchRejectsLateReads() {
        val fence = XDriveClipboardSessionFence()
        val read = fence.capture()
        fence.invalidate() // Compose onDispose / Owner change.
        assertFalse(fence.accepts(read))
    }

    @Test fun currentOperationRemainsValidUntilSessionInvalidated() {
        val fence = XDriveClipboardSessionFence()
        val active = fence.capture()
        assertTrue(fence.accepts(active))
        fence.invalidate()
        assertFalse(fence.accepts(active))
    }

    @Test fun returnToSameOwnerAfterDifferentOwnerNeverRestoresOldAReceipts() {
        val fence = XDriveClipboardSessionFence()
        val firstOwnerA = fence.capture()
        fence.invalidate() // A -> B
        val ownerB = fence.capture()
        fence.invalidate() // B -> A
        val currentOwnerA = fence.capture()
        assertFalse(fence.accepts(firstOwnerA))
        assertFalse(fence.accepts(ownerB))
        assertTrue(fence.accepts(currentOwnerA))
        fence.invalidate() // Lock/revocation while a request is still pending.
        assertFalse(fence.accepts(currentOwnerA))
    }

}
