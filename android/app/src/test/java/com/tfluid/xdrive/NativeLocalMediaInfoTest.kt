package com.tfluid.xdrive

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class NativeLocalMediaInfoTest {
    private val utc = ZoneId.of("UTC")
    private fun rows(info: NativeLocalMediaInfo, video: Boolean = false,
        added: Long = 0) = nativeLocalMediaInfoRows(info, video, "Camera", added, utc).toMap()

    @Test fun captureTimeAndAddedTimeRemainDistinct() {
        val capture = Instant.parse("2025-05-06T12:13:00Z").toEpochMilli()
        val added = Instant.parse("2026-11-01T15:16:00Z").epochSecond
        val values = rows(NativeLocalMediaInfo(
            name = "photo.heic", mime = "image/heic", bytes = 12_288L,
            width = 4032, height = 3024, takenAtMillis = capture
        ), added = added)
        assertEquals("2025-05-06 12:13", values["拍摄时间"])
        assertEquals("2026-11-01 15:16", values["加入时间"])
        assertEquals("4032 × 3024 像素", values["尺寸"])
        assertEquals("12288 字节", values["文件大小"])
        assertEquals("image/heic", values["格式"])
    }

    @Test fun missingCapturedAtIsNotInventedFromAddedAt() {
        val values = rows(NativeLocalMediaInfo(
            name = null, mime = null, bytes = -2L, takenAtMillis = 0L
        ), added = 1788888888L)
        assertEquals("未记录", values["拍摄时间"])
        assertNotEquals("未记录", values["加入时间"])
        assertEquals("未知", values["文件大小"])
        assertEquals("未知", values["尺寸"])
    }

    @Test fun videoDurationAndInvalidMetadataAreExplicit() {
        val values = rows(NativeLocalMediaInfo(
            name = "\u0000unsafe", mime = "\ntext",
            width = -2, height = 1200, durationMillis = 92_000L,
        ), video = true)
        assertEquals("未记录", values["名称"])
        assertEquals("未知", values["格式"])
        assertEquals("未知", values["尺寸"])
        assertEquals("1 分 32 秒", values["视频时长"])
        assertEquals("视频", values["类型"])
        assertEquals("Camera", values["相册"])
    }

    @Test fun mimeValidationDoesNotTrimMalformedUntrustedTokens() {
        listOf("\ntext", "\\ntext", "text", "image/", "image /jpeg", "image/jpeg\n",
            "image//jpeg", "image/jpeg; charset=utf-8").forEach { invalid ->
            assertEquals("invalid MIME: [" + invalid + "]",
                "未知", rows(NativeLocalMediaInfo(mime = invalid))["格式"])
        }
        listOf("image/heic", "image/x-adobe-dng",
            "application/vnd.apple.mpegurl").forEach { valid ->
            assertEquals(valid, rows(NativeLocalMediaInfo(mime = valid))["格式"])
        }
    }

    @Test fun invalidTimestampsDoNotCrashInfo() {
        val values = rows(NativeLocalMediaInfo(
            takenAtMillis = Long.MAX_VALUE, durationMillis = -1L
        ), video = true, added = 0)
        assertEquals("未记录", values["加入时间"])
        assertEquals("未知", values["视频时长"])
    }
}
