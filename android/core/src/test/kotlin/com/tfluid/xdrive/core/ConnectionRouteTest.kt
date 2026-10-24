package com.tfluid.xdrive.core

import java.net.InetAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test

class ConnectionRouteTest {
    private fun resolver(block: () -> List<InetAddress>) = object : Dns {
        override fun lookup(hostname: String) = block()
    }
    @Test fun `route validation rejects hostnames unsafe ranges and cleartext`() {
        val origin = ServerAddress.parse("https://drive.example")
        for (route in listOf(ConnectionRoute(RouteMode.LAN), ConnectionRoute(lanIp = "localhost"),
            ConnectionRoute(lanIp = "127.0.0.1"), ConnectionRoute(lanIp = "169.254.1.1"),
            ConnectionRoute(lanIp = "8.8.8.8"), ConnectionRoute(publicIp = "192.168.2.4"),
            ConnectionRoute(publicIp = "100.64.0.1"), ConnectionRoute(publicIp = "192.0.2.1"),
            ConnectionRoute(publicIp = "::ffff:8.8.8.8"), ConnectionRoute(publicIp = "2001:db8::1"))) {
            assertThrows(IllegalArgumentException::class.java) { route.validate(origin) }
        }
        ConnectionRoute(lanIp = "192.168.2.4", publicIp = "8.8.8.8").validate(origin)
        ConnectionRoute(lanIp = "fd12::4", publicIp = "2606:4700::1111").validate(origin)
        assertThrows(IllegalArgumentException::class.java) {
            ConnectionRoute(RouteMode.PUBLIC).validate(ServerAddress.parse("http://drive.example", true))
        }
        ConnectionRoute().validate(ServerAddress.parse("http://drive.example", true))
    }

    @Test fun `auto falls back before login only on transport failure and pins one public IP`() = runBlocking {
        val attempted = mutableListOf<String>()
        val selector = ConnectionRouteSelector(
            dns = resolver { listOf(InetAddress.getByName("192.168.2.4"), InetAddress.getByName("8.8.8.8")) },
            probe = { _, ip -> attempted += ip; if (ip == "192.168.2.4") throw ApiException(0, "Connection failed", ApiFailureReason.CONNECTION) },
        )
        assertEquals("8.8.8.8", selector.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(lanIp = "192.168.2.4")))
        assertEquals(listOf("192.168.2.4", "8.8.8.8"), attempted)
        attempted.clear()
        assertEquals("8.8.8.8", selector.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(RouteMode.PUBLIC)))
        assertEquals(listOf("8.8.8.8"), attempted)
    }

    @Test fun `TLS and invalid responses never fall back to public`() = runBlocking {
        for (reason in listOf(ApiFailureReason.TLS, ApiFailureReason.INVALID_RESPONSE)) {
            val attempted = mutableListOf<String>()
            val selector = ConnectionRouteSelector(probe = { _, ip -> attempted += ip; throw ApiException(0, "Safe failure", reason) })
            val error = try { selector.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(lanIp = "192.168.2.4", publicIp = "8.8.8.8")); null } catch (e: ApiException) { e }
            assertEquals(reason, error?.reason)
            assertEquals(listOf("192.168.2.4"), attempted)
        }
    }

    @Test fun `public never uses private DNS and explicit address bypasses DNS`() = runBlocking {
        val selector = ConnectionRouteSelector(dns = resolver { throw AssertionError("Explicit IP must bypass DNS") }, probe = { _, ip -> assertEquals("8.8.8.8", ip) })
        assertEquals("8.8.8.8", selector.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(RouteMode.PUBLIC, publicIp = "8.8.8.8")))
        val privateOnly = ConnectionRouteSelector(dns = resolver { listOf(InetAddress.getByName("192.168.2.4")) }, probe = { _, _ -> throw AssertionError("Private DNS cannot be a public candidate") })
        val error = try { privateOnly.select(ServerAddress.parse("https://drive.example"), ConnectionRoute(RouteMode.PUBLIC)); null } catch (e: ApiException) { e }
        assertEquals(ApiFailureReason.DNS, error?.reason)
    }

    private suspend fun fixture(block: suspend (MockWebServer, ServerAddress, OkHttpClient) -> Unit) {
        val certificate = HeldCertificate.Builder().commonName("drive.example").addSubjectAlternativeName("drive.example").build()
        val tls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        MockWebServer().use { server ->
            server.useHttps(tls.sslSocketFactory(), false)
            val address = ServerAddress.parse(server.url("/").newBuilder().host("drive.example").build().toString())
            val client = OkHttpClient.Builder().sslSocketFactory(trust.sslSocketFactory(), trust.trustManager)
                .proxy(Proxy(java.net.Proxy.Type.HTTP, java.net.InetSocketAddress("127.0.0.1", 1))).build()
            try { block(server, address, client) }
            finally { client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll() }
        }
    }

    @Test fun `real TLS anonymous probe and pinned login retain hostname without proxy cookies or redirects`() = runBlocking {
        fixture { server, address, client ->
            server.enqueue(MockResponse().setBody("""{"version":"fixture"}"""))
            ConnectionRouteSelector(client).probeEndpoint(address, "127.0.0.1")
            val probe = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("GET", probe.method)
            assertEquals("/api/v1/version", probe.path)
            assertEquals("drive.example:${server.port}", probe.getHeader("Host") ?: probe.getHeader(":authority"))
            assertNull(probe.getHeader("Authorization")); assertNull(probe.getHeader("Cookie"))
            server.enqueue(MockResponse().setBody("""{"access_token":"fixture","refresh_token":"fixture-refresh","username":"owner"}"""))
            XDriveApi(address, client, "127.0.0.1").use { api -> assertEquals("owner", api.login("owner", "synthetic-password").username) }
            assertEquals("/api/v1/auth/login", server.takeRequest().path)
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://elsewhere.example"))
            val failure = try { ConnectionRouteSelector(client).probeEndpoint(address, "127.0.0.1"); null } catch (e: ApiException) { e }
            assertEquals(ApiFailureReason.INVALID_RESPONSE, failure?.reason)
        }
    }

    @Test fun `real TLS rejects untrusted chain and wrong hostname with safe typed errors`() = runBlocking {
        fixture { server, address, trusted ->
            val untrusted = OkHttpClient()
            try {
                val chain = try { ConnectionRouteSelector(untrusted).probeEndpoint(address, "127.0.0.1"); null } catch (e: ApiException) { e }
                assertEquals(ApiFailureReason.TLS, chain?.reason); assertNull(chain?.cause)
                val wrong = ServerAddress.parse(address.url.replace("drive.example", "wrong.example"))
                val hostname = try { ConnectionRouteSelector(trusted).probeEndpoint(wrong, "127.0.0.1"); null } catch (e: ApiException) { e }
                assertEquals(ApiFailureReason.TLS, hostname?.reason); assertNull(hostname?.cause)
                assertEquals(0, server.requestCount)
            } finally { untrusted.dispatcher.executorService.shutdownNow(); untrusted.connectionPool.evictAll() }
        }
    }

    @Test fun `cancelled real probe cancels socket and cannot return a selected route`() = runBlocking {
        fixture { server, address, client ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val job = launch { ConnectionRouteSelector(client).probeEndpoint(address, "127.0.0.1"); fail("Cancelled probe cannot succeed") }
            withContext(Dispatchers.IO) { assertNotNull(server.takeRequest(5, TimeUnit.SECONDS)) }
            job.cancelAndJoin()
            assertTrue(job.isCancelled)
        }
    }

    @Test fun `advanced routes reject numeric origins while legacy numeric addresses remain valid`() {
        for (url in listOf("https://192.168.2.4:8443", "https://8.8.8.8", "https://[fd12::4]")) {
            val address = ServerAddress.parse(url)
            ConnectionRoute().validate(address)
            assertThrows(IllegalArgumentException::class.java) { ConnectionRoute(RouteMode.PUBLIC).validate(address) }
        }
    }

    @Test fun `unknown saved modes fail closed without silently selecting auto`() {
        assertEquals(RouteMode.AUTO, RouteMode.fromPreference(null))
        val route = ConnectionRoute(RouteMode.fromPreference("corrupt"))
        assertThrows(IllegalArgumentException::class.java) { route.validate(ServerAddress.parse("https://drive.example")) }
    }
}
