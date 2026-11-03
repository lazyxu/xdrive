package com.tfluid.xdrive.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest

class NativeNotesApiTest {
    private val id = "12345678-1234-1234-1234-123456789abc"

    private fun row(source: String = "mine", revision: Int = 1,
                    markdown: String = "# Test"): String {
        val sha = MessageDigest.getInstance("SHA-256")
            .digest(markdown.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return """{"id":"$id","source":"$source","title":"Test","node_id":87,
            "revision":$revision,"sha256":"$sha","bytes":6,
            "created_at":"2026-11-03T00:00:00Z","updated_at":"2026-11-03T00:00:00Z"}"""
            .replace("\"bytes\":6", "\"bytes\":" + markdown.toByteArray(Charsets.UTF_8).size)
    }

    @Test fun inputAndReadOnlySourcePolicy() {
        assertTrue(validNotesUUID(id))
        assertFalse(validNotesUUID("../other"))
        assertTrue(validNotesInput("中文", "# Test"))
        assertFalse(validNotesInput("A\nB", "text"))
        assertFalse(validNotesInput("A", "\u0000"))
        assertFalse(validNotesInput("A", "x".repeat(1_048_577)))
        val mine = OwnerNoteRow(id, "mine", "title", 87, 1, "a".repeat(64), 1, "")
        assertTrue(mine.writable)
        assertFalse(mine.copy(source = "ios_notes").writable)
    }

    @Test fun notesUseOwnerBearerAndVersionedAPI() = runBlocking {
        MockWebServer().use { server ->
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                server.enqueue(MockResponse().setBody(
                    """{"ios_backup_node_id":7,"my_notes_node_id":8}"""))
                api.notesInitialize("owner-secret")
                val namespaceRequest = server.takeRequest()
                assertEquals("POST", namespaceRequest.method)
                assertEquals("/api/v1/notes/namespace", namespaceRequest.path)
                assertEquals("Bearer owner-secret", namespaceRequest.getHeader("Authorization"))
                assertNull(namespaceRequest.getHeader("Cookie"))

                // A manually selected Markdown file has no reliable native
                // Apple Notes ID. Never manufacture external_id or title-dedupe.
                server.enqueue(MockResponse().setBody(row(source = "ios_notes")))
                val imported = api.notesImportIOSMarkdown("owner-secret", "Test", "# Test")
                assertFalse(imported.writable)
                val manual = server.takeRequest()
                assertEquals("POST", manual.method)
                assertEquals("/api/v1/notes/ios/import", manual.path)
                assertEquals("Bearer owner-secret", manual.getHeader("Authorization"))
                val manualBody = Json.parseToJsonElement(manual.body.readUtf8()).jsonObject
                assertEquals("# Test", manualBody["markdown"]!!.jsonPrimitive.content)
                assertNull(manualBody["external_id"])


                server.enqueue(MockResponse().setBody(
                    """{"items":[""" + row() + """],"next_offset":0}"""))
                assertEquals(1, api.notesList("owner-secret", "mine", "Test", 0).items.size)
                assertTrue(server.takeRequest().path!!.startsWith("/api/v1/notes?"))

                server.enqueue(MockResponse().setBody(
                    row().dropLast(1) + ""","markdown":"# Test"}"""))
                assertEquals("# Test", api.notesDetail("owner-secret", id).markdown)
                assertEquals("/api/v1/notes/$id", server.takeRequest().path)

                server.enqueue(MockResponse().setBody(row(revision = 2, markdown = "# Updated")))
                assertEquals(2L, api.notesUpdate("owner-secret", id, "Test", "# Updated", 1).revision)
                val updated = server.takeRequest()
                assertEquals("PUT", updated.method)
                val fields = Json.parseToJsonElement(updated.body.readUtf8()).jsonObject
                assertEquals(1L, fields["expected_revision"]!!.jsonPrimitive.long)
                assertEquals("# Updated", fields["markdown"]!!.jsonPrimitive.content)

                server.enqueue(MockResponse().setResponseCode(204))
                api.notesDelete("owner-secret", id, 2)
                val deleted = server.takeRequest()
                assertEquals("DELETE", deleted.method)
                assertEquals("2", deleted.getHeader("If-Match")!!.trim('"'))

                server.enqueue(MockResponse().setBody(
                    row(source = "ios_notes").dropLast(1) + ""","markdown":"# Test"}"""))
                assertFalse(api.notesDetail("owner-secret", id).row.writable)
                server.takeRequest()

                server.enqueue(MockResponse().setResponseCode(403))
                try {
                    api.notesUpdate("owner-secret", id, "Test", "# Other", 1)
                    fail("Read-only backup was editable")
                } catch (e: ApiException) { assertEquals(403, e.statusCode) }
            }
        }
    }

    @Test fun historyUsesPinnedReadAndRejectsHashMismatch() = runBlocking {
        MockWebServer().use { server ->
            XDriveApi(ServerAddress.parse(server.url("/").toString(), true)).use { api ->
                val sha = row().substringAfter("\"sha256\":\"").substringBefore("\"")
                server.enqueue(MockResponse().setBody(
                    "{\"items\":[{\"id\":91,\"revision\":1,\"sha256\":\"" + sha +
                        "\",\"bytes\":6}],\"node_id\":87}"))
                assertEquals(1, api.notesVersions("owner-secret", id).size)
                assertEquals("/api/v1/notes/$id/versions", server.takeRequest().path)

                server.enqueue(MockResponse().setBody("# Test"))
                assertEquals("# Test", api.notesReadVersion("owner-secret", 87, 91))
                val read = server.takeRequest()
                assertEquals("/api/v1/files/87/versions/91/content", read.path)
                assertEquals("Bearer owner-secret", read.getHeader("Authorization"))

                server.enqueue(MockResponse().setBody(
                    row().dropLast(1) + ""","markdown":"tampered"}"""))
                try {
                    api.notesDetail("owner-secret", id)
                    fail("Invalid Markdown SHA accepted")
                } catch (e: ApiException) {
                    assertEquals(ApiFailureReason.INVALID_RESPONSE, e.reason)
                }
            }
        }
    }
}
