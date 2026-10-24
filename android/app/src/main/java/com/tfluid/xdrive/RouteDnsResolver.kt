package com.tfluid.xdrive

import com.tfluid.xdrive.core.ApiException
import com.tfluid.xdrive.core.ApiFailureReason
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

internal fun interface RouteDnsQuery {
    /** Starts one asynchronous device DNS query; the returned function cancels it. */
    fun query(host: String, answer: (List<InetAddress>?) -> Unit): () -> Unit
}

internal class RouteDnsResolver(private val query: RouteDnsQuery) {
    suspend fun lookup(host: String): List<InetAddress> = suspendCancellableCoroutine { continuation ->
        val pending = AtomicReference<(() -> Unit)?>(null)
        fun cancelPending() { pending.getAndSet(null)?.invoke() }
        continuation.invokeOnCancellation { cancelPending() }
        if (!continuation.isActive) return@suspendCancellableCoroutine
        try {
            val cancel = query.query(host) { answer ->
                if (continuation.isActive) {
                    if (answer != null) continuation.resume(answer)
                    else continuation.resumeWithException(ApiException(0, "Server DNS lookup failed", ApiFailureReason.DNS))
                }
            }
            pending.set(cancel)
            // Covers cancellation before query() returned its cancellation handle.
            if (!continuation.isActive) cancelPending()
        } catch (_: Exception) {
            cancelPending()
            if (continuation.isActive) continuation.resumeWithException(ApiException(0, "Server DNS lookup failed", ApiFailureReason.DNS))
        }
    }
}
