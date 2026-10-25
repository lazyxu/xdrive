package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.*
import org.junit.*

/** Synthetic fixtures only: this Activity does not replace the secure production Activity. */
class VisualParityTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var mustChange = false
    private var changes = 0
    private var compactViewport by mutableStateOf(false)
    private val service = object : XDriveService {
        override suspend fun login(username: String, password: String) = AuthSession("fixture", "fixture", username, mustChangePassword = mustChange)
        override suspend fun refresh(refreshToken: String) = AuthSession("fixture", "fixture", "demo")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String): AuthSession {
            changes++; return AuthSession("fixture", "fixture", "demo")
        }
        override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
        override suspend fun children(accessToken: String, parentId: Long, offset: Int) = NodeRange(listOf(
            DriveNode(2, 1, "Documents", "dir"), DriveNode(3, 1, "Photos", "dir"),
            DriveNode(4, 1, "report.pdf", "file", 131072), DriveNode(5, 1, "budget.xlsx", "file", 32768),
            DriveNode(6, 1, "notes.txt", "file", 2048),
        ), 5, offset)
    }
    private val controller = DriveController(scope, { service })
    @After fun close() { controller.close(); scope.cancel() }
    private fun loginScreen(dark: Boolean = false, narrow: Boolean = false, landscape: Boolean = false) {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, if (narrow) 1.5f else 1f)) {
                XDriveTheme(dark) {
                    Box(if (narrow) Modifier.width(280.dp) else if (landscape && compactViewport) Modifier.width(640.dp).height(300.dp) else Modifier) {
                        DriveApp(controller)
                    }
                }
            }
        }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("server").assertTextEquals("https://drive.example")
        // Exercise the actual tagged Button rather than a possibly stale
        // child Text semantics node while the URI keyboard is visible.
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        // connect() runs in the Controller's Main coroutine scope, which is
        // independent of Compose's current idle frame. A runOnIdle-only
        // assertion races the CONNECT -> LOGIN StateFlow transition on CI.
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.LOGIN
        }
        compose.waitForIdle()
        compose.onNodeWithTag("username").assertExists()
        compose.runOnIdle {
            Assert.assertEquals(Screen.LOGIN, controller.state.value.screen)
            compactViewport = true
        }
    }
    private fun login() {
        compose.onNodeWithTag("username").performTextInput("demo")
        compose.onNodeWithTag("password").performTextInput("synthetic-password")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        // Compose may be idle before the controller's Main coroutine has
        // completed login and, for FILES, the first synthetic directory read.
        // Assert the same real UI, but only after its data has been delivered.
        compose.waitUntil(timeoutMillis = 10_000) {
            val current = controller.state.value
            (current.screen == Screen.PASSWORD && !current.loading) ||
                (current.screen == Screen.FILES && current.loaded && !current.loading)
        }
        compose.waitForIdle()
    }
    @Test fun passwordRevealResetsAfterBlurAndEmpty() {
        loginScreen()
        compose.onNodeWithTag("password").performTextInput("synthetic")
        compose.onNodeWithContentDescription("显示密码").performClick()
        compose.onNodeWithContentDescription("隐藏密码").assertExists()
        assertPasswordRendering("synthetic")
        compose.onNodeWithTag("username").performClick()
        assertPasswordRendering("•".repeat(9))
        compose.onNodeWithTag("password").performClick()
        compose.onNodeWithContentDescription("显示密码").performClick()
        compose.onNodeWithTag("password").performTextClearance()
        assertPasswordRendering("")
        compose.onNodeWithContentDescription("显示密码").assertExists()
    }
    private fun assertPasswordRendering(expected: String) {
        val results = mutableListOf<TextLayoutResult>()
        compose.onNodeWithTag("password").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(results) }
        Assert.assertEquals(expected, results.single().layoutInput.text.text)
    }
    @Test fun mandatoryPasswordRequiresMatchingConfirmation() {
        mustChange = true; loginScreen(); login()
        compose.onNodeWithTag("files").assertDoesNotExist()
        compose.onNodeWithTag("current-password").performTextInput("synthetic-old")
        compose.onNodeWithTag("new-password").performTextInput("synthetic-new")
        compose.onNodeWithTag("confirm-password").performTextInput("different")
        // Click the actual Submit node: a text child can lose its click target
        // while the IME and scroll position are changing on emulators.
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.onNodeWithText("两次输入的密码不一致。").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { Assert.assertEquals(0, changes) }
        compose.onNodeWithTag("confirm-password").performTextReplacement("synthetic-new")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        // The controller enters FILES before the Main coroutine finishes
        // its first authenticated root/children read. Compose idle alone does
        // not guarantee that the freshly loaded "Documents" row is visible.
        // Keep the real screen/row assertion; wait for the real loaded state.
        compose.waitUntil(timeoutMillis = 10_000) {
            val current = controller.state.value
            current.screen == Screen.FILES && current.loaded && !current.loading
        }
        compose.waitForIdle()
        // The password box is visually masked: InputText holds the clear input
        // while EditableText exposes bullets. Verify the actual successful
        // backend call rather than asserting the masked semantics string.
        compose.runOnIdle { Assert.assertEquals(1, changes) }
        compose.onNodeWithText("Documents").assertIsDisplayed()
    }
    @Test fun brandAndFileTypeGlyphsRender() {
        loginScreen(); compose.onNodeWithTag("auth-card").assertExists()
        compose.onNodeWithContentDescription("xDrive").assertIsDisplayed()
        login()
        compose.onAllNodesWithContentDescription("文件夹").assertCountEquals(2)
        compose.onNodeWithContentDescription("PDF").assertIsDisplayed()
    }
    private fun save(name: String, bitmap: Bitmap) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val output = File(context.getExternalFilesDir(null), "ui-parity").apply { mkdirs() }
        File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        save(name, compose.onRoot().captureToImage().asAndroidBitmap())
    }
    @Test fun loginLightFixture() { loginScreen(); capture("login-light") }
    @Test fun darkCardUsesSharedSurfacePixels() {
        loginScreen(dark = true)
        val card = compose.onNodeWithTag("auth-card").captureToImage().toPixelMap()
        Assert.assertEquals(0xff171d27.toInt(), card[card.width / 2, card.height - 5].toArgb())
        capture("login-dark")
    }
    @Test fun filesLightFixture() { loginScreen(); login(); capture("files-light") }
    @Test fun filesDarkFixture() {
        loginScreen(dark = true); login()
        val root = compose.onRoot()
        val rootBounds = root.fetchSemanticsNode().boundsInRoot
        val bounds = compose.onNodeWithText("Documents", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val screen = root.captureToImage().toPixelMap()
        var readablePixels = 0
        for (y in (bounds.top - rootBounds.top).toInt() until (bounds.bottom - rootBounds.top).toInt())
            for (x in (bounds.left - rootBounds.left).toInt() until (bounds.right - rootBounds.left).toInt()) {
            val pixel = screen[x, y]
            if (pixel.alpha > .9f && pixel.red > .7f && pixel.green > .7f && pixel.blue > .7f) readablePixels++
        }
        Assert.assertTrue("Dark file names must have visible light glyphs", readablePixels > 10)
        capture("files-dark")
    }
    @Test fun narrowLargeFontSubmitRemainsReachable() {
        loginScreen(narrow = true)
        val brand = mutableListOf<TextLayoutResult>()
        compose.onNodeWithTag("auth-brand-title").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(brand) }
        Assert.assertEquals(1, brand.single().lineCount)
        Assert.assertFalse(brand.single().hasVisualOverflow)
        compose.onNodeWithText("登录").performScrollTo().assertIsDisplayed()
        capture("login-narrow-large-font")
    }
    @Test fun landscapeSubmitRemainsReachable() {
        loginScreen(landscape = true)
        compose.onNodeWithText("登录").performScrollTo().assertIsDisplayed()
        capture("login-landscape")
    }
    @Test fun actualApplicationIconRendersThroughPackageManager() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val icon = context.packageManager.getApplicationIcon(context.packageName)
        Assert.assertTrue(icon is android.graphics.drawable.AdaptiveIconDrawable)
        val bitmap = Bitmap.createBitmap(216, 216, Bitmap.Config.ARGB_8888)
        icon.setBounds(0, 0, 216, 216); icon.draw(Canvas(bitmap))
        Assert.assertNotEquals(0, bitmap.getPixel(108, 108))
        save("launcher-package-manager-mask", bitmap)
    }
}
