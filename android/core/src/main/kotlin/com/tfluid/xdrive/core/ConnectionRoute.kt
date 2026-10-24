package com.tfluid.xdrive.core

import java.io.IOException
import java.io.InterruptedIOException
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.Buffer

enum class RouteMode {
    AUTO, LAN, PUBLIC, INVALID;
    companion object {
        fun fromPreference(value: String?): RouteMode = if (value == null) AUTO else entries.firstOrNull { it.name == value } ?: INVALID
    }
}
data class ConnectionRoute(val mode: RouteMode = RouteMode.AUTO, val lanIp: String = "", val publicIp: String = "") {
    val enabled get() = mode != RouteMode.AUTO || lanIp.isNotEmpty() || publicIp.isNotEmpty()
    fun validate(address: ServerAddress) {
        require(mode != RouteMode.INVALID) { "Invalid saved route mode" }
        require(!enabled || address.url.startsWith("https://")) { "Route selection requires HTTPS" }
        require(!enabled || literalIp(address.url.toHttpUrl().host) == null) { "Route selection requires a DNS domain" }
        require(mode != RouteMode.LAN || lanIp.isNotEmpty()) { "LAN IP is required" }
        require(lanIp.isEmpty() || literalIp(lanIp)?.let(::isLanIp) == true) { "Invalid LAN IP" }
        require(publicIp.isEmpty() || literalIp(publicIp)?.let(::isPublicIp) == true) { "Invalid public IP" }
    }
}

/** Literal parsing cannot invoke DNS. IPv4 shorthand, scoped and mapped IPv6 are rejected. */
internal fun literalIp(value: String): InetAddress? {
    if (value.isEmpty() || value.length > 45) return null
    return try {
        if (':' in value) {
            if (!value.all { it in "0123456789abcdefABCDEF:" }) return null
            InetAddress.getByName(value).takeIf { it.address.size == 16 }
        } else {
            val parts = value.split('.')
            if (parts.size != 4 || parts.any { it.isEmpty() || (it.length > 1 && it.startsWith('0')) || !it.all { c -> c in '0'..'9' } || (it.toIntOrNull() ?: 256) > 255 }) return null
            InetAddress.getByAddress(parts.map { it.toInt().toByte() }.toByteArray())
        }
    } catch (_: IllegalArgumentException) { null } catch (_: UnknownHostException) { null }
}

private fun InetAddress.octets() = address.map { it.toInt() and 255 }
internal fun isLanIp(ip: InetAddress): Boolean {
    val b = ip.octets()
    return if (b.size == 4) b[0] == 10 || b[0] == 172 && b[1] in 16..31 || b[0] == 192 && b[1] == 168
    else b[0] and 0xfe == 0xfc
}

internal fun isPublicIp(ip: InetAddress): Boolean {
    val b = ip.octets()
    if (b.size == 16) {
        if (b[0] and 0xe0 != 0x20) return false
        if (b[0] == 0x20 && b[1] == 0x02 || b[0] == 0x3f && b[1] == 0xff) return false
        if (b[0] == 0x20 && b[1] == 0x01 && (b[2] == 0x0d && b[3] == 0xb8 || b[2] == 0 && b[3] <= 0x2f)) return false
        return true
    }
    if (b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224 ||
        b[0] == 100 && b[1] in 64..127 || b[0] == 169 && b[1] == 254 ||
        b[0] == 172 && b[1] in 16..31 || b[0] == 192 && b[1] == 168 ||
        b[0] == 192 && b[1] == 0 && b[2] in listOf(0, 2) ||
        b[0] == 192 && b[1] == 88 && b[2] == 99 ||
        b[0] == 198 && b[1] in 18..19 || b[0] == 198 && b[1] == 51 && b[2] == 100 ||
        b[0] == 203 && b[1] == 0 && b[2] == 113) return false
    return true
}

internal fun transportFailure(error: IOException): ApiException {
    val causes = generateSequence<Throwable>(error) { it.cause }.take(16).toList()
    val reason = when {
        causes.any { it is SSLException || it is java.security.cert.CertificateException } -> ApiFailureReason.TLS
        error is UnknownHostException -> ApiFailureReason.DNS
        error is InterruptedIOException -> ApiFailureReason.TIMEOUT
        else -> ApiFailureReason.CONNECTION
    }
    return ApiException(0, when (reason) {
        ApiFailureReason.TLS -> "HTTPS certificate verification failed"
        ApiFailureReason.DNS -> "Server DNS lookup failed"
        ApiFailureReason.TIMEOUT -> "Server connection timed out"
        else -> "Unable to connect to server"
    }, reason)
}

/** The URL is unchanged, so HTTP Host, TLS SNI and hostname verification keep the origin. */
internal fun OkHttpClient.Builder.pinConnection(address: ServerAddress, ip: String?): OkHttpClient.Builder {
    if (ip == null) return this
    val parsed = requireNotNull(literalIp(ip)) { "Invalid connection IP" }
    val host = address.url.toHttpUrl().host
    return proxy(Proxy.NO_PROXY).dns(object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            if (hostname != host) throw UnknownHostException("Unexpected connection host")
            return listOf(parsed)
        }
    })
}

/** Anonymous pre-login selection only. A chosen socket is never changed by an authenticated call. */
class ConnectionRouteSelector(
    private val client: OkHttpClient = OkHttpClient(),
    private val dns: Dns = Dns.SYSTEM,
    private val probe: (suspend (ServerAddress, String) -> Unit)? = null,
    private val resolve: suspend (String) -> List<InetAddress> = { host -> runInterruptible(Dispatchers.IO) { dns.lookup(host) } },
) {
    suspend fun select(address: ServerAddress, route: ConnectionRoute): String? {
        route.validate(address)
        if (!route.enabled) return null
        try {
            return withTimeout(12_000) {
                var last: ApiException? = null
                suspend fun attempt(ip: String): Boolean {
                    try { if (probe != null) probe.invoke(address, ip) else probeEndpoint(address, ip); return true }
                    catch (error: ApiException) {
                        if (error.reason !in listOf(ApiFailureReason.DNS, ApiFailureReason.CONNECTION, ApiFailureReason.TIMEOUT)) throw error
                        last = error; return false
                    }
                }
                if (route.mode != RouteMode.PUBLIC && route.lanIp.isNotEmpty()) {
                    if (attempt(route.lanIp)) return@withTimeout route.lanIp
                }
                if (route.mode == RouteMode.LAN) throw last ?: ApiException(0, "Unable to connect to server", ApiFailureReason.CONNECTION)
                val candidates = if (route.publicIp.isNotEmpty()) listOf(route.publicIp) else {
                    val host = address.url.toHttpUrl().host
                    val literal = literalIp(host)
                    if (literal != null) listOfNotNull(literal.takeIf(::isPublicIp)?.hostAddress)
                    else try {
                        resolve(host).filter(::isPublicIp).mapNotNull { it.hostAddress }.distinct().take(4)
                    } catch (error: ApiException) { throw error }
                    catch (error: IOException) { throw transportFailure(error) }
                }
                if (candidates.isEmpty()) throw ApiException(0, "No public DNS address available", ApiFailureReason.DNS)
                for (ip in candidates) if (attempt(ip)) return@withTimeout ip
                throw last ?: ApiException(0, "Unable to connect to server", ApiFailureReason.CONNECTION)
            }
        } catch (_: TimeoutCancellationException) { throw ApiException(0, "Server connection timed out", ApiFailureReason.TIMEOUT) }
    }

    internal suspend fun probeEndpoint(address: ServerAddress, ip: String) {
        require(address.url.startsWith("https://")) { "Route selection requires HTTPS" }
        val http = client.newBuilder().pinConnection(address, ip)
            .dispatcher(Dispatcher()).connectionPool(ConnectionPool()).cache(null)
            .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
            .apply { interceptors().clear(); networkInterceptors().clear() }
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .callTimeout(3, TimeUnit.SECONDS).connectTimeout(3, TimeUnit.SECONDS).readTimeout(3, TimeUnit.SECONDS).build()
        try {
            suspendCancellableCoroutine<Unit> { continuation ->
                val call = http.newCall(Request.Builder().url(address.url.toHttpUrl().newBuilder().addPathSegments("api/v1/version").build())
                    .header("Accept", "application/json").build())
                continuation.invokeOnCancellation { call.cancel() }
                call.enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) {
                        if (continuation.isActive) continuation.resumeWithException(transportFailure(e))
                    }
                    override fun onResponse(call: Call, response: Response) {
                        try {
                            response.use {
                                fun invalid(): Nothing = throw ApiException(0, "Invalid server response", ApiFailureReason.INVALID_RESPONSE)
                                if (it.code != 200) invalid()
                                val body = it.body ?: invalid()
                                val max = 16_384L
                                if (body.contentLength() > max) invalid()
                                val buffer = Buffer()
                                val input = body.source()
                                while (buffer.size <= max && input.read(buffer, minOf(4096, max + 1 - buffer.size)) != -1L) { }
                                if (buffer.size > max) invalid()
                                val json = Json.parseToJsonElement(buffer.readUtf8()) as? JsonObject ?: invalid()
                                val version = json["version"] as? JsonPrimitive ?: invalid()
                                if (!version.isString || version.content.isBlank() || version.content.length > 256) invalid()
                            }
                            if (continuation.isActive) continuation.resume(Unit)
                        } catch (error: ApiException) {
                            if (continuation.isActive) continuation.resumeWithException(error)
                        } catch (error: IOException) {
                            if (continuation.isActive) continuation.resumeWithException(transportFailure(error))
                        } catch (_: IllegalArgumentException) {
                            if (continuation.isActive) continuation.resumeWithException(ApiException(0, "Invalid server response", ApiFailureReason.INVALID_RESPONSE))
                        }
                    }
                })
            }
        } finally {
            http.dispatcher.cancelAll(); http.connectionPool.evictAll(); http.dispatcher.executorService.shutdownNow()
        }
    }
}
