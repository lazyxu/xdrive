package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

class NativeTransferStateTest {
    @Test fun confirmedBytesAndElapsedMeanNeverInventInstantWireSpeed() {
        val begun = NativeTransferEntry(
            id = 1, kind = NativeTransferKind.UPLOAD, fileName = "photo.jpg",
            totalBytes = 2_000, startedAtMillis = 10_000,
        )
        assertNull(begun.averageBytesPerSecond())
        assertNull(begun.remainingMillis())
        assertEquals(0f, begun.progressFraction()!!, .0001f)

        val confirmed = begun.withConfirmedBytes(800, 11_000)
        assertEquals(800L, confirmed.transferredBytes)
        assertEquals(800.0, confirmed.averageBytesPerSecond()!!, .001)
        assertEquals(1_500L, confirmed.remainingMillis())
        assertEquals(.4f, confirmed.progressFraction()!!, .0001f)

        val stale = confirmed.withConfirmedBytes(300, 11_500)
        assertEquals(800L, stale.transferredBytes)
        assertEquals(11_500L, stale.updatedAtMillis)
        val completed = stale.finish(NativeTransferStatus.COMPLETED, 12_000, 2_000)
        assertEquals(2_000L, completed.transferredBytes)
        assertEquals(2_000L, completed.elapsedMillis())
        assertEquals(NativeTransferStatus.COMPLETED, completed.status)
        assertNull(completed.remainingMillis())
        assertEquals(1f, completed.progressFraction()!!, .0001f)
        assertEquals(completed, completed.withConfirmedBytes(0, 14_000))
    }

    @Test fun cancelFailureAndUnconfirmedNeverShowSuccessOrRetryProgress() {
        val first = NativeTransferEntry(
            id = 2, kind = NativeTransferKind.DOWNLOAD, fileName = "a.mov",
            totalBytes = 1_024, startedAtMillis = 1_000,
        ).withConfirmedBytes(128, 1_250)
        val cancelled = first.finish(NativeTransferStatus.CANCELLED, 1_300)
        assertEquals(128L, cancelled.transferredBytes)
        assertEquals("已取消", nativeTransferStatusLabel(cancelled))
        assertEquals(cancelled,
            cancelled.finish(NativeTransferStatus.COMPLETED, 2_000, 1_024))

        val upload = first.copy(id = 3, kind = NativeTransferKind.UPLOAD)
            .finish(NativeTransferStatus.UNCONFIRMED, 1_300)
        assertEquals("结果未确认", nativeTransferStatusLabel(upload))
        assertEquals(128L, upload.transferredBytes)
        assertNull(upload.remainingMillis())
        val failed = first.copy(id = 4).finish(NativeTransferStatus.FAILED, 1_300)
        assertEquals("失败", nativeTransferStatusLabel(failed))
    }

    @Test fun historyIsBoundedAndCanRetainOneActiveWhenClearingTerminalRecords() {
        val all = (1L..32L).fold(emptyList<NativeTransferEntry>()) { current, id ->
            current.withStartedTransfer(NativeTransferEntry(id,
                NativeTransferKind.DOWNLOAD, "file-$id", 100, startedAtMillis = id))
        }
        assertEquals(MAX_SESSION_TRANSFERS, all.size)
        assertEquals(32L, all.first().id)
        assertEquals(13L, all.last().id)
        val duplicate = all.withStartedTransfer(NativeTransferEntry(
            32, NativeTransferKind.UPLOAD, "replacement", 50, startedAtMillis = 40))
        assertEquals(MAX_SESSION_TRANSFERS, duplicate.size)
        assertEquals(1, duplicate.count { it.id == 32L })

        val inactive = all.map { it.finish(NativeTransferStatus.COMPLETED, 1_000) }
        val running = all.first()
        val visible = (listOf(running) + inactive.drop(1))
            .filter { it.status == NativeTransferStatus.RUNNING }
        assertEquals(listOf(32L), visible.map { it.id })
    }

    @Test fun emptySizeNeverReportsFakeProgressOrEta() {
        val empty = NativeTransferEntry(
            1, NativeTransferKind.UPLOAD, "empty.txt", 0, startedAtMillis = 10)
        assertNull(empty.progressFraction())
        assertNull(empty.remainingMillis())
        assertNull(empty.averageBytesPerSecond())
        assertEquals(0L, empty.withConfirmedBytes(200, 100).transferredBytes)
        assertEquals("已上传",
            nativeTransferStatusLabel(empty.finish(NativeTransferStatus.COMPLETED, 200, 0)))
    }

    @Test fun allBytesWithoutUploadFinalizeAckNeverBecomeACompletedTransfer() {
        val pending = NativeTransferEntry(
            id = 9, kind = NativeTransferKind.UPLOAD, fileName = "video.mp4",
            totalBytes = 4_096L, startedAtMillis = 1_000L,
        ).withConfirmedBytes(4_096L, 2_000L)
        assertEquals(NativeTransferStatus.RUNNING, pending.status)
        assertTrue(pending.awaitingCompletionAck())
        assertEquals(99, pending.confirmedPercent())
        assertTrue(pending.progressFraction()!! < 1f)
        assertNull(pending.remainingMillis()) // finalization, not remaining bytes

        val noAck = pending.finish(NativeTransferStatus.UNCONFIRMED, 2_100L)
        assertFalse(noAck.awaitingCompletionAck())
        assertEquals(99, noAck.confirmedPercent())
        assertTrue(noAck.progressFraction()!! < 1f)
        assertEquals("结果未确认", nativeTransferStatusLabel(noAck))

        val completed = pending.finish(NativeTransferStatus.COMPLETED, 2_100L, 4_096L)
        assertFalse(completed.awaitingCompletionAck())
        assertEquals(100, completed.confirmedPercent())
        assertEquals(1f, completed.progressFraction()!!, .0001f)
        assertEquals("已上传", nativeTransferStatusLabel(completed))
    }

    @Test fun veryLargeFilesCannotRoundNonterminalProgressUpToOneHundred() {
        val almostAll = NativeTransferEntry(
            id = 10, kind = NativeTransferKind.DOWNLOAD, fileName = "large.bin",
            totalBytes = Long.MAX_VALUE, startedAtMillis = 5_000L,
        ).withConfirmedBytes(Long.MAX_VALUE - 1, 8_000L)
        assertEquals(99, almostAll.confirmedPercent())
        assertTrue(almostAll.progressFraction()!! < 1f)
        assertFalse(almostAll.awaitingCompletionAck())
        assertEquals(100, almostAll.finish(
            NativeTransferStatus.COMPLETED, 9_000L, Long.MAX_VALUE,
        ).confirmedPercent())
    }

    @Test fun emptyFileRemainsIndeterminateUntilRealCompletion() {
        val zero = NativeTransferEntry(
            11, NativeTransferKind.UPLOAD, "empty", 0L, startedAtMillis = 1L,
        )
        assertNull(zero.confirmedPercent())
        assertNull(zero.progressFraction())
        assertFalse(zero.awaitingCompletionAck())
        val complete = zero.finish(NativeTransferStatus.COMPLETED, 3L, 0L)
        assertEquals(100, complete.confirmedPercent())
        assertNull(complete.progressFraction()) // no denominator for an indicator
    }
}
