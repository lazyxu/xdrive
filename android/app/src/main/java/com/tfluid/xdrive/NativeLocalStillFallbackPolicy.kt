package com.tfluid.xdrive

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** Pure decision behind a local still's truthful original/thumbnail status.
 * Exactly one caller-owned URI may be read; a second fallback fetch is skipped
 * when a previous decoded thumbnail is already on screen. */
internal sealed interface NativeLocalStillRead<out T> {
    data class Original<T>(val value: T) : NativeLocalStillRead<T>
    data class Thumbnail<T>(val value: T) : NativeLocalStillRead<T>
    data object Failed : NativeLocalStillRead<Nothing>
}

/** Do not treat a failed original as a successful original just because the
 * Android photo provider can still return a bounded derivative bitmap.
 * Propagate cancellation even if an OEM throws a generic decode exception
 * *after* the navigation or Owner coroutine was cancelled. */
internal suspend fun <T> readLocalStillWithFallback(
    previousThumbnail: T? = null,
    original: suspend () -> T,
    thumbnail: suspend () -> T?,
): NativeLocalStillRead<T> {
    try {
        val bitmap = original()
        currentCoroutineContext().ensureActive()
        return NativeLocalStillRead.Original(bitmap)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        currentCoroutineContext().ensureActive()
    }
    if (previousThumbnail != null)
        return NativeLocalStillRead.Thumbnail(previousThumbnail)
    return try {
        val bitmap = thumbnail()
        currentCoroutineContext().ensureActive()
        if (bitmap == null) NativeLocalStillRead.Failed
        else NativeLocalStillRead.Thumbnail(bitmap)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        currentCoroutineContext().ensureActive()
        NativeLocalStillRead.Failed
    }
}
