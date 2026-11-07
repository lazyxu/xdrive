package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

/** Actual OkHttp Owner SSE transport, not merely a source-contract assertion. */
class NativeClipboardSSEApiTest {
    @Test fun authenticatedStreamUsesOnlyBearerAndEmitsInvalidation() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse()
                .setHeader("Content-Type", "text/event-stream; charset=utf-8")
                .setBody("retry: 2000\nevent: sync\ndata: {}\n\n" +
                    "id: 9\nevent: change\ndata: {}\n\n" +
                    ": ping\n\n"))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                var loads = 0
                val last = api.clipboardWatch("current-owner-bearer", 7) { loads++ }
                assertEquals(9L, last)
                assertEquals(2, loads) // reconnect sync + new change; no clipboard body.
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/api/v1/clipboard/events?after=7", request.path)
                assertEquals("Bearer current-owner-bearer", request.getHeader("Authorization"))
                assertEquals("text/event-stream", request.getHeader("Accept"))
                assertNull(request.getHeader("Cookie"))
                assertNull(request.getHeader("X-XDrive-Device-Token"))
            }
        }
    }

    @Test fun unexpectedPayloadCannotBeDeliveredAsAnEvent() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody("event: change\nid: 1\ndata: {\"plaintext\":\"secret\"}\n\n"))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                var loads = 0
                try {
                    api.clipboardWatch("owner-bearer", 0) { loads++ }
                    fail("SSE with secret payload must fail closed")
                } catch (_: IllegalArgumentException) { }
                assertEquals(0, loads)
            }
        }
    }

    @Test fun requireEventStreamMimeAndNoRedirects() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
                .setBody("{}"))
            server.enqueue(MockResponse().setResponseCode(302)
                .setHeader("Location", "/api/v1/clipboard/items"))
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                repeat(2) {
                    try {
                        api.clipboardWatch("owner-bearer", 0) { }
                        fail("MIME mismatch or redirect was accepted")
                    } catch (_: ApiException) { }
                }
                assertEquals(2, server.requestCount)
            }
        }
    }
}
