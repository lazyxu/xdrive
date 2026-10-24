package com.tfluid.xdrive.core

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.After
import org.junit.Test

class AndroidUpdatesTest {
    private val server = MockWebServer()
    private val client = AndroidUpdateClient()
    @After fun cleanup() { client.close(); server.shutdown() }

    private fun github(name: String = "xdrive-android-3-0.1.2.apk", url: String = "https://github.com/lazyxu/xdrive/releases/download/snapshot/$name") =
        """[{"tag_name":"snapshot","draft":false,"prerelease":true,"assets":[{"name":"$name","browser_download_url":"$url"}]}]"""
    private suspend fun check(body: String, source: UpdateSource = UpdateSource.GITHUB, installed: Long = 2): AndroidUpdate? {
        server.enqueue(MockResponse().setBody(body))
        return client.check(source, installed, server.url("/releases"))
    }

    @Test fun githubAnonymousCheckWorksWithoutServerOrLogin() = runBlocking {
        val update = check(github())!!
        assertEquals(3L, update.versionCode); assertEquals("0.1.2", update.versionName)
        assertEquals("https://github.com/lazyxu/xdrive/releases/download/snapshot/xdrive-android-3-0.1.2.apk", update.downloadUrl)
        assertTrue(update.available)
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertNull(request.getHeader("Authorization")); assertNull(request.getHeader("Cookie"))
    }

    @Test fun gitlabUsesLinksAndOwnAndroidVersionNotServerTag() = runBlocking {
        val update = check("""[{"tag_name":"v900.0.0","assets":{"links":[{"name":"xdrive-android-4-0.1.3.apk","url":"http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/android/4/xdrive-android-4-0.1.3.apk"}]}}]""", UpdateSource.GITLAB)!!
        assertEquals(4L, update.versionCode); assertTrue(update.available)
        assertTrue(update.downloadUrl.startsWith("http://gitlab.t-fluid.com:1080/"))
    }

    @Test fun picksHighestCodeAcrossReleasesAndSkipsDrafts() = runBlocking {
        val body = """[
          {"draft":true,"assets":[{"name":"xdrive-android-999-9.apk","browser_download_url":"https://github.com/lazyxu/xdrive/releases/download/x/xdrive-android-999-9.apk"}]},
          {"assets":[{"name":"xdrive-android-5-0.1.4.apk","browser_download_url":"https://github.com/lazyxu/xdrive/releases/download/x/xdrive-android-5-0.1.4.apk"}]},
          {"assets":[{"name":"xdrive-android-3-0.1.2.apk","browser_download_url":"https://github.com/lazyxu/xdrive/releases/download/x/xdrive-android-3-0.1.2.apk"}]}
        ]"""
        assertEquals(5L, check(body)!!.versionCode)
    }

    @Test fun equalOrOlderCodeNeverOffersDowngrade() = runBlocking {
        assertFalse(check(github(), installed = 3)!!.available)
        assertFalse(check(github(), installed = 4)!!.available)
    }

    @Test fun missingApkIsDifferentFromAlreadyCurrent() = runBlocking {
        assertNull(check("""[{"tag_name":"v999.0.0","assets":[{"name":"xDriveSetup-amd64.exe","browser_download_url":"https://example.org/a"}]}]"""))
    }

    @Test fun unsafeAssetUrlsCannotBecomeDownloadActions() = runBlocking {
        val name = "xdrive-android-3-0.1.2.apk"
        for (url in listOf("http://github.com/lazyxu/xdrive/releases/download/x/$name", "https://evil.example/$name",
            "https://user:secret@github.com/lazyxu/xdrive/releases/download/x/$name", "https://github.com/foreign/repo/releases/download/x/$name",
            "javascript:alert(1)", "https://github.com/lazyxu/xdrive/releases/download/x/$name?token=secret")) {
            try { check(github(url = url)); fail("unsafe URL accepted") } catch (_: UpdateException) { }
        }
    }

    @Test fun foreignGitlabProjectsCannotBecomeDownloadActions() = runBlocking {
        val name = "xdrive-android-3-0.1.2.apk"
        for (path in listOf("api/v4/projects/999/packages/generic/android/3/$name",
            "api/v4/projects/foreign%2Fxdrive/packages/generic/android/3/$name", "foreign/xdrive/-/releases/snapshot/downloads/$name")) {
            val body = """[{"assets":{"links":[{"name":"$name","url":"http://gitlab.t-fluid.com:1080/$path"}]}}]"""
            try { check(body, UpdateSource.GITLAB); fail("foreign GitLab project accepted") } catch (_: UpdateException) { }
        }
    }

    @Test fun gitlabCanonicalDirectAssetUrlIsPreferredOverNumericPackageLink() = runBlocking {
        val name = "xdrive-android-3-0.1.2.apk"
        val body = """[{"assets":{"links":[{"name":"$name","url":"http://gitlab.t-fluid.com:1080/api/v4/projects/1/packages/generic/android/3/$name","direct_asset_url":"http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/releases/snapshot/downloads/$name"}]}}]"""
        assertEquals("http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/releases/snapshot/downloads/$name", check(body, UpdateSource.GITLAB)!!.downloadUrl)
    }

    @Test fun conflictingSameVersionIsRejected() = runBlocking {
        val a = github().removeSuffix("]")
        val b = github(name = "xdrive-android-3-0.1.3.apk").removePrefix("[")
        try { check("$a,$b"); fail("conflicting version accepted") } catch (_: UpdateException) { }
    }

    @Test fun sameVersionInSnapshotAndStableReleaseStillOffersAnUpdate() = runBlocking {
        val a = github().removeSuffix("]")
        val b = github(url = "https://github.com/lazyxu/xdrive/releases/download/v0.1.2/xdrive-android-3-0.1.2.apk").removePrefix("[")
        assertEquals(3L, check("$a,$b")!!.versionCode)
    }

    @Test fun invalidMetadataAndInvalidCodesFailSafely() = runBlocking {
        for (body in listOf("not-json", "{}", "[null]")) {
            try { check(body); fail("bad metadata accepted") } catch (e: UpdateException) { assertFalse(e.message.orEmpty().contains(body)) }
        }
        assertNull(check(github(name = "xdrive-android-0-0.1.2.apk")))
        assertNull(check(github(name = "xdrive-android-2100000001-0.1.2.apk")))
    }

    @Test fun failedRequestsAndRedirectsDoNotLeakResponseBodies() = runBlocking {
        for (code in listOf(302, 401, 429, 500)) {
            server.enqueue(MockResponse().setResponseCode(code).addHeader("Location", server.url("/secret")).setBody("secret-fixture"))
            try { client.check(UpdateSource.GITHUB, 2, server.url("/releases")); fail("HTTP $code accepted") }
            catch (e: UpdateException) { assertFalse(e.toString().contains("secret-fixture")) }
        }
        assertEquals(4, server.requestCount)
    }

    @Test fun responseSizeIsBounded() = runBlocking {
        try { check(" ".repeat(2 * 1024 * 1024 + 1)); fail("oversized metadata accepted") } catch (_: UpdateException) { }
    }

    @Test fun cancellationStopsTheOwnedHttpCall() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val job = launch { client.check(UpdateSource.GITHUB, 2, server.url("/releases")) }
        withContext(Dispatchers.IO) { assertNotNull(server.takeRequest(5, TimeUnit.SECONDS)) }
        withTimeout(2_000) { job.cancelAndJoin() }
    }

    @Test fun sourceSelectionDefaultsSafely() {
        assertEquals(UpdateSource.GITHUB, UpdateSource.fromPreference("unknown"))
        assertEquals(UpdateSource.GITLAB, UpdateSource.fromPreference("gitlab"))
        assertEquals("https://api.github.com/repos/lazyxu/xdrive/releases?per_page=100", UpdateSource.GITHUB.releasesUrl)
        assertEquals("http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/releases?per_page=100", UpdateSource.GITLAB.releasesUrl)
    }
}
