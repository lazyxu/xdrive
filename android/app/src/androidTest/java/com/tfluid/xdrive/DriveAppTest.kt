package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Real Compose controls with a fixture service, not live Server or physical-device proof. */
class DriveAppTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var failNext = false
    private var paging = false
    private var failOnSecondPage = false
    private var manyFiles = false
    private var favoriteDeletes = 0
    private val service = object : XDriveService {
        override suspend fun login(username: String, password: String) = AuthSession("fixture", "fixture-refresh", username)
        override suspend fun refresh(refreshToken: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
        override suspend fun fileRecent(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(2, 1, "假期照片", "dir"), "假期照片",
                listOf(DriveCrumb(1, ""), DriveCrumb(2, "假期照片"))))
        override suspend fun fileFavorites(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                listOf(DriveCrumb(1, ""), DriveCrumb(7, "favorite.txt"))))
        override suspend fun unfavoriteFile(accessToken: String, nodeId: Long) {
            if (nodeId == 7L) favoriteDeletes++
        }
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange {
            if (failNext || (paging && offset == 100 && failOnSecondPage)) {
                failNext = false; failOnSecondPage = false; throw ApiException(503, "unavailable")
            }
            val rows = if (paging && offset == 100) listOf(DriveNode(4, 1, "第二页.txt", "file", 2048))
                else if (manyFiles && parentId == 1L) listOf(DriveNode(2, 1, "假期照片", "dir")) +
                    (1..99).map { index -> if (index == 49)
                        DriveNode(200, 1, "第二相册", "dir")
                        else DriveNode(100L + index, 1, "item-$index.txt", "file", 128) }
                else if (parentId == 1L) listOf(DriveNode(2, 1, "假期照片", "dir"))
                else listOf(DriveNode(3, 2, "测试.txt", "file", 12, updatedAt = "2026-10-23T00:00:00Z"))
            return NodeRange(rows, if (paging) 101 else rows.size.toLong(), offset)
        }
    }
    private val connectFactoryCalls = AtomicInteger()
    private val controller = DriveController(scope, { connectFactoryCalls.incrementAndGet(); service })
    @After fun cleanup() { controller.close(); scope.cancel() }

    private fun startAndLogin() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("server").assertTextEquals("https://drive.example")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        // Controller.connect() advances the Main coroutine separately from the
        // current Compose frame. Waiting only for idleness races on CI.
        compose.awaitFixtureConnectLogin(controller) { connectFactoryCalls.get() }
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES && controller.state.value.loaded
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun loginBrowseDetailsBackAndLogout() {
        startAndLogin()
        compose.onNodeWithText("假期照片").performClick()
        compose.onNodeWithText("测试.txt").performClick()
        compose.onNode(hasText("12 B") and hasAnyAncestor(isDialog())).assertIsDisplayed()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.onNodeWithText("假期照片").assertIsDisplayed()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.onNodeWithTag("password").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("假期照片").assertDoesNotExist()
    }

    @Test fun failedDirectoryLoadOffersRetryWithoutChangingPath() {
        startAndLogin()
        compose.runOnIdle { failNext = true }
        compose.onNodeWithText("假期照片").performClick()
        compose.onNodeWithTag("request-error").assertIsDisplayed()
        compose.onNodeWithText("重试").performClick()
        compose.onNodeWithText("测试.txt").assertIsDisplayed()
        compose.onNodeWithTag("request-error").assertDoesNotExist()
    }

    @Test fun cleartextRequiresExplicitOptIn() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("http://drive.example:1080")
        compose.onNodeWithTag("server").assertTextEquals("http://drive.example:1080")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        // Adopt merged API35 fixture fix: wait for real Controller error, then
        // scroll under the IME before checking that HTTP requires opt-in.
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.error != null }
        compose.onNodeWithTag("request-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("allow-http").performScrollTo().performClick()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.awaitFixtureConnectLogin(controller) { connectFactoryCalls.get() }
        compose.runOnIdle { org.junit.Assert.assertEquals(Screen.LOGIN, controller.state.value.screen) }
        compose.onNodeWithTag("username").performScrollTo().assertIsDisplayed()
    }

    @Test fun routeControlsValidateLanAndClearStaleOriginSettings() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("route-lan").performScrollTo().performClick()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.onNodeWithTag("request-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("lan-ip").performScrollTo().performTextInput("192.168.2.4")
        compose.onNodeWithTag("server").performScrollTo().performTextReplacement("https://other.example")
        compose.onNodeWithTag("lan-ip").performScrollTo()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithTag("route-auto").assertIsSelected()
        compose.onNodeWithTag("route-public").performScrollTo().performClick()
        compose.onNodeWithTag("public-ip").performScrollTo().assertExists()
    }

    @Test fun continuousScrollFailureKeepsFirstPageAndRetryAppends() {
        paging = true
        failOnSecondPage = true
        startAndLogin()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.error != null }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
        compose.onNodeWithText("保留上次成功读取的目录。").assertIsDisplayed()
        compose.onNodeWithText("重试").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.offset == 100 && !controller.state.value.loading
        }
        compose.onNodeWithText("第二页.txt").assertExists()
        compose.onNodeWithText("假期照片").assertExists()
    }

    @Test fun longPressOnFolderOpensActionsWithoutEnteringIt() {
        startAndLogin()
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("属性").assertIsDisplayed()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, controller.state.value.path.size) }
        compose.onNodeWithText("属性").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.selected?.id == 2L }
        compose.onNodeWithText("关闭").performClick()
        compose.runOnIdle { org.junit.Assert.assertNull(controller.state.value.selected) }
    }

    @Test fun listGridSwitchRetainsVisibleItemAnchor() {
        manyFiles = true
        startAndLogin()
        compose.onNodeWithTag("files").performScrollToIndex(50)
        compose.onNodeWithText("item-50.txt").assertIsDisplayed()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithText("item-50.txt").assertExists()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("列表").performClick()
        compose.onNodeWithTag("files").assertExists()
        compose.onNodeWithText("item-50.txt").assertExists()
    }

    @Test fun returningFromFolderRestoresPriorFirstPageViewport() {
        manyFiles = true
        startAndLogin()
        compose.onNodeWithTag("files").performScrollToIndex(49)
        compose.onNodeWithText("第二相册").assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.path.size == 2 && !controller.state.value.loading
        }
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.path.size == 1 && controller.state.value.loaded && !controller.state.value.loading
        }
        compose.onNodeWithText("item-50.txt").assertIsDisplayed()
    }

    @Test fun folderPathMenuReturnsToServerVerifiedAncestor() {
        startAndLogin()
        compose.onNodeWithText("假期照片").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.path.size == 2 && !controller.state.value.loading }
        compose.onNodeWithTag("files-path-menu").performClick()
        compose.onNodeWithTag("files-path-1").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.path.size == 1 && controller.state.value.loaded }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun recentBrowseFavoritesAreRealOwnerLoadedSections() {
        startAndLogin()
        compose.onNodeWithTag("files-section-recent").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.RECENT &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection-item-2").assertExists()
        compose.onNodeWithTag("files-section-favorites").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.FAVORITES &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection-item-7").assertExists()
        compose.onNodeWithTag("files-section-browse").performClick()
        compose.onNodeWithTag("files").assertExists()
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun favoriteLongPressRemovalChangesRealCollectionOnlyAfterAck() {
        startAndLogin()
        compose.onNodeWithTag("files-section-favorites").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.collectionLoaded }
        compose.onNodeWithTag("files-collection-item-7").performTouchInput { longClick() }
        compose.onNodeWithText("取消收藏").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            favoriteDeletes == 1 && controller.state.value.collectionItems.isEmpty() &&
                !controller.state.value.loading
        }
        compose.onNodeWithText("暂无收藏的文件").assertIsDisplayed()
    }

    @Test fun recentFolderOpensServerVerifiedBrowseLocation() {
        startAndLogin()
        compose.onNodeWithTag("files-section-recent").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.collectionLoaded }
        compose.onNodeWithTag("files-collection-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.BROWSE &&
                controller.state.value.path.size == 2 && !controller.state.value.loading
        }
        compose.onNodeWithText("测试.txt").assertExists()
    }

    @Test fun switchListAndGridKeepsTheSameFolderNavigation() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithText("假期照片").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.path.size == 2 && controller.state.value.loaded
        }
        compose.onNodeWithText("测试.txt").assertExists()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("列表").performClick()
        compose.onNodeWithTag("files").assertExists()
    }
}
