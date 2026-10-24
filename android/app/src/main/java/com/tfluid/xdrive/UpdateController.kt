package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.Closeable
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class UpdateState(
    val versionCode: Long,
    val versionName: String,
    val source: UpdateSource,
    val visible: Boolean = false,
    val checking: Boolean = false,
    val checked: Boolean = false,
    val result: AndroidUpdate? = null,
    val error: String? = null,
)

/** Deliberately independent of connection/account state; no background polling. */
class UpdateController(
    private val scope: CoroutineScope,
    private val installedCode: Long,
    versionName: String,
    private val service: AndroidUpdateService,
    initialSource: UpdateSource = UpdateSource.GITHUB,
    private val saveSource: (UpdateSource) -> Unit = {},
) : Closeable {
    private val mutable = MutableStateFlow(UpdateState(installedCode, versionName, initialSource))
    val state = mutable.asStateFlow()
    private var job: Job? = null
    private var generation = 0L
    private var closed = false
    fun show() { if (!closed) mutable.update { it.copy(visible = true) } }
    fun dismiss() { invalidate(); mutable.update { it.copy(visible = false, checking = false, checked = false, result = null, error = null) } }
    fun selectSource(source: UpdateSource) {
        if (closed || source == state.value.source) return
        invalidate()
        saveSource(source)
        mutable.update { it.copy(source = source, checking = false, checked = false, result = null, error = null) }
    }
    fun check() {
        if (closed || !state.value.visible || state.value.checking) return
        invalidate()
        val requestGeneration = generation
        val source = state.value.source
        mutable.update { it.copy(checking = true, checked = false, result = null, error = null) }
        job = scope.launch {
            try {
                val result = service.check(source, installedCode)
                if (generation == requestGeneration && !closed) mutable.update { it.copy(checking = false, checked = true, result = result) }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) {
                if (generation == requestGeneration && !closed) mutable.update { it.copy(checking = false, error = "检查更新失败，请检查网络后重试。") }
            }
        }
    }
    fun browserUnavailable() { mutable.update { it.copy(error = "无法打开浏览器，请安装或启用浏览器后重试。") } }
    private fun invalidate() { generation++; job?.cancel(); job = null }
    override fun close() {
        if (closed) return
        closed = true; dismiss()
        (service as? Closeable)?.close()
    }
}
