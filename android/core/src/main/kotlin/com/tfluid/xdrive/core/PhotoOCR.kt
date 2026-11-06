package com.tfluid.xdrive.core

import kotlinx.serialization.json.*

/** Private, current-revision detail only. Never include this text in Gallery lists or logs. */
data class PhotoOCR(val state: String, val text: String = "", val reason: String = "") {
    override fun toString() = "PhotoOCR(state=$state, text=[redacted])"
    val message: String get() = when (state) {
        "ready" -> if (text.isBlank()) "已识别，未检测到文字" else "识别完成"
        "pending" -> "等待后台识别"
        "running" -> "正在识别"
        "stale" -> "照片已更新，等待重新识别"
        "failed" -> when (reason) {
            "model_timeout" -> "识别超时"
            "model_busy" -> "识别模型繁忙"
            "model_unreachable" -> "无法连接识别模型"
            "preview_unavailable" -> "分析预览暂不可用"
            "interrupted" -> "识别已中断"
            else -> "识别失败"
        }
        else -> "暂无可用 OCR 结果，请检查服务器模型配置"
    }
}

internal fun parsePhotoOCR(raw: JsonElement?): PhotoOCR? {
    if (raw == null || raw == JsonNull) return null
    fun invalid(): Nothing = throw ApiException(0, "Invalid OCR response", ApiFailureReason.INVALID_RESPONSE)
    val value = raw as? JsonObject ?: invalid()
    fun text(key: String, required: Boolean = false): String {
        val v = value[key] ?: return if (required) invalid() else ""
        if (v !is JsonPrimitive || !v.isString) invalid()
        return v.content
    }
    val state = text("state", true)
    if (state !in setOf("ready", "pending", "running", "stale", "failed", "unavailable")) invalid()
    val recognized = text("text")
    if (recognized.codePointCount(0, recognized.length) > 8192 ||
        (state != "ready" && recognized.isNotEmpty())) invalid()
    val reason = text("reason")
    if (reason.length > 64) invalid()
    return PhotoOCR(state, recognized, reason)
}
