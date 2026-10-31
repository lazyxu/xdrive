package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Native UI against public-release fixtures, not evidence of a published signed update. */
class AndroidUpdateUiTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val drive = DriveController(scope, { object : XDriveService {
        override suspend fun login(username: String, password: String) = AuthSession("fixture", "fixture-refresh", username)
        override suspend fun refresh(refreshToken: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
        override suspend fun children(accessToken: String, parentId: Long, offset: Int) = NodeRange(emptyList(), 0, offset)
    } })
    private var available: AndroidUpdate? = AndroidUpdate(4, "0.1.3", "https://github.com/lazyxu/xdrive/releases/download/snapshot/xdrive-android-4-0.1.3.apk", true)
    private var checkedSource: UpdateSource? = null
    private var opened: String? = null
    private var browserWorks = true
    private val updates = UpdateController(scope, 3, "0.1.2", object : AndroidUpdateService {
        override suspend fun check(source: UpdateSource, installedCode: Long): AndroidUpdate? { checkedSource = source; return available }
    })
    @After fun cleanup() { updates.close(); drive.close(); scope.cancel() }
    private fun start() { compose.setContent { XDriveTheme { DriveApp(drive, updates, openUpdate = { opened = it; browserWorks }, galleryFirstOnLogin = false) } } }
    private fun openUpdates() {
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("检查更新").performClick()
        compose.onNodeWithText("当前版本：0.1.2 (3)").assertIsDisplayed()
    }
    @Test fun unconfiguredClientChecksBothSourcesWithoutLoginAndCanDownload() {
        start(); openUpdates()
        compose.onNodeWithText("检查新版本").performClick()
        compose.waitUntil(10_000) { updates.state.value.checked }
        compose.onNodeWithText("发现新版本：0.1.3 (4)").assertIsDisplayed()
        compose.onNodeWithText("下载更新").performClick()
        compose.runOnIdle { assertEquals(available!!.downloadUrl, opened) }
        compose.onNodeWithText("GitLab").performClick()
        compose.onNodeWithText("下载更新").assertDoesNotExist()
        compose.onNodeWithTag("update-http-warning").assertIsDisplayed()
        compose.onNodeWithText("检查新版本").performClick()
        compose.waitUntil(10_000) { updates.state.value.checked }
        compose.runOnIdle { assertEquals(UpdateSource.GITLAB, checkedSource); assertEquals(Screen.CONNECT, drive.state.value.screen) }
    }
    @Test fun loginScreenHasTheSameUpdateEntry() {
        drive.connect("https://drive.example", false)
        start(); openUpdates()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithTag("password").assertExists()
    }
    @Test fun loggedInFilesAlsoHaveTheUpdateEntryAndLogoutDoesNotResetSource() {
        drive.connect("https://drive.example", false); drive.login("owner", "fixture")
        start()
        compose.waitUntil(10_000) { drive.state.value.screen == Screen.FILES && drive.state.value.loaded }
        openUpdates()
        compose.onNodeWithText("GitLab").performClick()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        openUpdates()
        compose.runOnIdle { assertEquals(UpdateSource.GITLAB, updates.state.value.source) }
    }
    @Test fun missingApkDoesNotClaimLatestAndHasNoDownload() {
        available = null; start(); openUpdates()
        compose.onNodeWithText("检查新版本").performClick()
        compose.waitUntil(10_000) { updates.state.value.checked }
        compose.onNodeWithText("此源最近发布中未找到 Android APK，无法判断是否有新版。").assertIsDisplayed()
        compose.onNodeWithText("下载更新").assertDoesNotExist()
    }
    @Test fun unavailableBrowserIsReportedAndUpdateRemainsRetryable() {
        browserWorks = false; start(); openUpdates()
        compose.onNodeWithText("检查新版本").performClick()
        compose.waitUntil(10_000) { updates.state.value.checked }
        compose.onNodeWithText("下载更新").performClick()
        compose.onNodeWithText("无法打开浏览器，请安装或启用浏览器后重试。").assertIsDisplayed()
        compose.onNodeWithText("下载更新").assertIsEnabled()
    }
}
