package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeStillDecodeSizeTest {
    @Test fun originalDecodeNeverExceeds4096AndPreservesOrientation() {
        assertEquals(640 to 480, nativeStillDecodeSize(640, 480))
        assertEquals(4096 to 3072, nativeStillDecodeSize(8000, 6000))
        assertEquals(3072 to 4096, nativeStillDecodeSize(6000, 8000))
        assertEquals(4096 to 1, nativeStillDecodeSize(16000, 2))
        assertEquals(1 to 4096, nativeStillDecodeSize(2, 16000))
    }

    @Test fun invalidDimensionsAreRejectedBeforeDecode() {
        for (dimensions in listOf(0 to 100, 100 to 0, -1 to 1)) {
            try {
                nativeStillDecodeSize(dimensions.first, dimensions.second)
                throw AssertionError("invalid source dimensions admitted")
            } catch (_: IllegalArgumentException) {
                // Fail closed before expensive decoder allocation.
            }
        }
    }
}
