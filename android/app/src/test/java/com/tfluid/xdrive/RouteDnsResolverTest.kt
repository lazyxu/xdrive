package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.net.InetAddress
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RouteDnsResolverTest {
    @Test fun deviceDnsFailuresKeepSafeDnsClassificationAtSelectorBoundary() = runTest {
        val resolver = RouteDnsResolver(RouteDnsQuery { _, answer -> answer(null); {} })
        val selector = ConnectionRouteSelector(resolve = resolver::lookup, probe = { _, _ -> fail("DNS failure cannot probe") })
        val error = try {
            selector.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(RouteMode.PUBLIC)); null
        } catch (e: ApiException) { e }
        assertEquals(ApiFailureReason.DNS, error?.reason)
        assertNull(error?.cause)
    }

    @Test fun selectionDeadlineCancelsPendingDeviceDnsAndIgnoresLateAnswers() = runTest {
        var callback: ((List<InetAddress>?) -> Unit)? = null
        var cancellations = 0
        var probes = 0
        var reason: ApiFailureReason? = null
        val resolver = RouteDnsResolver(RouteDnsQuery { host, answer ->
            assertEquals("drive.example", host)
            callback = answer
            val cancel: () -> Unit = { cancellations++ }
            cancel
        })
        val selector = ConnectionRouteSelector(resolve = resolver::lookup, probe = { _, _ -> probes++ })
        val job = launch {
            try { selector.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(RouteMode.PUBLIC)) }
            catch (e: ApiException) { reason = e.reason }
        }
        runCurrent()
        assertNotNull(callback)
        advanceTimeBy(12_001); runCurrent()
        assertTrue(job.isCompleted)
        assertEquals(ApiFailureReason.TIMEOUT, reason)
        assertEquals(1, cancellations)
        callback!!.invoke(listOf(InetAddress.getByAddress(byteArrayOf(8, 8, 8, 8))))
        runCurrent()
        assertEquals(0, probes)
    }

    @Test fun callerCancellationCancelsQueryWithoutInstallingLateDnsResult() = runTest {
        var callback: ((List<InetAddress>?) -> Unit)? = null
        var cancellations = 0
        var results = 0
        val resolver = RouteDnsResolver(RouteDnsQuery { _, answer ->
            callback = answer
            val cancel: () -> Unit = { cancellations++ }
            cancel
        })
        val job = launch { resolver.lookup("drive.example"); results++ }
        runCurrent(); job.cancelAndJoin()
        assertEquals(1, cancellations)
        callback!!.invoke(emptyList())
        runCurrent()
        assertEquals(0, results)
    }
}
