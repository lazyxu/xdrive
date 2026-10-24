package com.tfluid.xdrive

import android.net.DnsResolver
import android.os.CancellationSignal
import java.net.InetAddress
import java.util.concurrent.Executor

/** API 29+ device DNS; cancellation releases the native query without a blocked Java DNS thread. */
internal fun deviceRouteDns(executor: Executor) = RouteDnsResolver(RouteDnsQuery { host, answer ->
    val cancellation = CancellationSignal()
    try {
        DnsResolver.getInstance().query(null, host, DnsResolver.FLAG_EMPTY, executor, cancellation,
            object : DnsResolver.Callback<List<InetAddress>> {
                override fun onAnswer(result: List<InetAddress>, rcode: Int) { answer(if (rcode == 0) result else null) }
                override fun onError(error: DnsResolver.DnsException) { answer(null) }
            })
    } catch (error: Exception) {
        cancellation.cancel()
        throw error
    }
    val cancel: () -> Unit = { cancellation.cancel() }
    cancel
})
