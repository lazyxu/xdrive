package com.tfluid.xdrive.core

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class PhotoOCRTest {
    @Test fun chineseEnglishTextAndNoTextAreDistinctReadyResults() {
        val value = parsePhotoOCR(Json.parseToJsonElement(
            """{"state":"ready","text":"中文测试 XDRIVE 2026","language":"zh-en"}"""))!!
        assertEquals("中文测试 XDRIVE 2026", value.text)
        assertEquals("识别完成", value.message)
        assertFalse(value.toString().contains("中文测试"))
        assertEquals("已识别，未检测到文字", parsePhotoOCR(
            Json.parseToJsonElement("""{"state":"ready"}"""))!!.message)
        assertNull(parsePhotoOCR(null))
    }
    @Test fun staleFailedUnknownAndMalformedResponsesNeverExposeText() {
        for (raw in listOf(
            """{"state":"stale","text":"private"}""",
            """{"state":"failed","text":"private"}""",
            """{"state":"invented"}""",
            """{"state":true}""",
            """{"state":"ready","text":42}""",
            buildJsonObject { put("state", "ready"); put("text", "字".repeat(8193)) }.toString(),
        )) {
            try { parsePhotoOCR(Json.parseToJsonElement(raw)); fail("accepted malformed OCR") }
            catch (error: ApiException) { assertEquals(ApiFailureReason.INVALID_RESPONSE, error.reason) }
        }
        val failed = parsePhotoOCR(Json.parseToJsonElement(
            """{"state":"failed","reason":"private_model_exception"}"""))!!
        assertEquals("识别失败", failed.message)
        assertFalse(failed.message.contains("private_model_exception"))
    }
}
