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
    private var createCalls = 0
    private var renameCalls = 0
    private var trashCalls = 0
    private var batchTrashCalls = 0
    private var copyCalls = 0
    private var moveCalls = 0
    private var extraRootFile = false
    private val mutableRootRows = mutableListOf(DriveNode(2, 1, "假期照片", "dir", revision = 1))
    private val galleryFixture = GalleryAsset(
        DriveNode(40, 1, "相册照片.jpg", "file", size = 44, revision = 1), "image",
        capturedAt = "2026-10-24T00:00:00Z", hasThumbnail = true)
    private val service = object : XDriveService {
        override suspend fun login(username: String, password: String) = AuthSession("fixture", "fixture-refresh", username)
        override suspend fun refresh(refreshToken: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
        override suspend fun galleryPage(accessToken: String, offset: Int,
            initialLatest: Boolean) = GalleryPage(listOf(galleryFixture), 1, 0)
        override suspend fun galleryThumbnail(accessToken: String, nodeId: Long,
            revision: Long) = byteArrayOf(1,2,3)
        override suspend fun fileRecent(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(2, 1, "假期照片", "dir"), "假期照片",
                listOf(DriveCrumb(1, ""), DriveCrumb(2, "假期照片"))))
        override suspend fun fileFavorites(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                listOf(DriveCrumb(1, ""), DriveCrumb(7, "favorite.txt"))))
        override suspend fun searchFiles(accessToken: String, query: String, cursor: String): FileSearchPage =
            FileSearchPage(listOf(
                DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                    listOf(DriveCrumb(1, "")))), "")
        override suspend fun unfavoriteFile(accessToken: String, nodeId: Long) {
            if (nodeId == 7L) favoriteDeletes++
        }
        override suspend fun createDirectory(accessToken: String, parentId: Long, name: String): DriveNode {
            createCalls++
            val created = DriveNode(800 + createCalls.toLong(), parentId, name, "dir", revision = 1)
            mutableRootRows += created
            return created
        }
        override suspend fun renameNode(accessToken: String, original: DriveNode, name: String): DriveNode {
            renameCalls++
            val updated = original.copy(name = name, revision = original.revision + 1)
            val index = mutableRootRows.indexOfFirst { it.id == original.id }
            if (index >= 0) mutableRootRows[index] = updated
            return updated
        }
        override suspend fun trashNode(accessToken: String, original: DriveNode) {
            trashCalls++
            mutableRootRows.removeAll { it.id == original.id }
        }
        override suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
            batchTrashCalls++
            val ids = originals.map { it.id }.toSet()
            mutableRootRows.removeAll { it.id in ids }
            if (70L in ids) extraRootFile = false
        }
        override suspend fun copyNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
            copyCalls++
            return original.copy(id = 770 + copyCalls.toLong(), parentId = parentId, revision = 1)
        }
        override suspend fun moveNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
            moveCalls++
            if (original.id == 70L) extraRootFile = false
            return original.copy(parentId = parentId, revision = original.revision + 1)
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
                else if (parentId == 1L) mutableRootRows.toList() +
                    (if (extraRootFile) listOf(DriveNode(70, 1, "复制目标.txt", "file", 120, revision = 2))
                        else emptyList())
                else listOf(DriveNode(3, 2, "测试.txt", "file", 12, updatedAt = "2026-10-23T00:00:00Z"))
            return NodeRange(rows, if (paging) 101 else rows.size.toLong(), offset)
        }
    }
    private val connectFactoryCalls = AtomicInteger()
    private val controller = DriveController(scope, { connectFactoryCalls.incrementAndGet(); service })
    @After fun cleanup() { controller.close(); scope.cancel() }

    private fun startAndLogin(
        onDownload: ((DriveNode) -> Unit)? = null,
        onUpload: (() -> Unit)? = null,
    ) {
        compose.setContent { XDriveTheme {
            DriveApp(controller, onDownload = onDownload, onUpload = onUpload)
        } }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("server").assertTextEquals("https://drive.example")
        // Real IME Done closes the soft keyboard; no credential replay.
        compose.onNodeWithTag("server").performImeAction()
        // Do not dispatch the CONNECT click while Compose is still applying
        // keyboard-focus and scroll changes. A single interaction must be
        // visibly enabled and placed before sending it; never retry blindly.
        compose.waitForIdle()
        compose.onNodeWithTag("auth-submit").performScrollTo()
        compose.waitForIdle()
        compose.onNodeWithTag("auth-submit").assertIsDisplayed().assertIsEnabled().performClick()
        // Controller.connect() advances the Main coroutine separately from the
        // current Compose frame. Waiting only for idleness races on CI.
        compose.awaitFixtureConnectLogin(controller) { connectFactoryCalls.get() }
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        compose.onNodeWithTag("password").performImeAction()
        compose.waitForIdle()
        compose.onNodeWithTag("auth-submit").performScrollTo()
        compose.waitForIdle()
        compose.onNodeWithTag("auth-submit").assertIsDisplayed().assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES && controller.state.value.loaded
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun batchTrashRequiresExplicitConfirmationAndNeverDeletesOnCancel() {
        startAndLogin()
        compose.onNodeWithTag("xdrive-mobile-app-header").assertIsDisplayed()
        compose.onNodeWithTag("files-select-mode").performClick()
        compose.onNodeWithTag("files-item-2").performClick()
        // The clickable row merges Checkbox semantics in the default tree.
        compose.runOnIdle {
            org.junit.Assert.assertEquals(setOf(2L), controller.state.value.browseSelectedIds)
        }
        compose.onNodeWithTag("files-select-2", useUnmergedTree = true).assertIsSelected()
        compose.onNodeWithText("1 项已选择（最多 200）").assertIsDisplayed()
        compose.onNodeWithTag("files-batch-trash-action").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, batchTrashCalls) }
        compose.onNodeWithTag("files-batch-trash-cancel").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, batchTrashCalls) }
        compose.onNodeWithTag("files-batch-trash-action").performClick()
        compose.onNodeWithTag("files-batch-trash-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            batchTrashCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.none { it.id == 2L }
        }
        compose.onNodeWithTag("files-item-2").assertDoesNotExist()
        compose.onNodeWithText("此文件夹为空").assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertFalse(controller.state.value.browseSelectionMode)
        }
    }

    @Test fun selectingInGridDoesNotOpenFolderAndCanExitSelectionMode() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithTag("files-select-mode").performClick()
        compose.onNodeWithTag("files-item-2").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(setOf(2L), controller.state.value.browseSelectedIds)
            org.junit.Assert.assertEquals(1, controller.state.value.path.size)
        }
        compose.onNodeWithTag("files-select-mode").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertTrue(controller.state.value.browseSelectedIds.isEmpty())
        }
        compose.onNodeWithTag("files-grid").assertExists()
    }

    @Test fun nativeGalleryOpensRealOwnerPhotoWallAndReturnsToFiles() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-files").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun nativeUploadActionStartsRealSafPickerCallback() {
        var picks = 0
        startAndLogin(onUpload = { picks++ })
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("files-upload-action").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, picks) }
    }

    @Test fun nativeDownloadMenuUsesOnlyRealCurrentFile() {
        extraRootFile = true
        val downloads = mutableListOf<Long>()
        startAndLogin(onDownload = { downloads += it.id })
        compose.onNodeWithTag("files-item-70").performTouchInput { longClick() }
        compose.onNodeWithTag("files-download-action").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(70L), downloads)
            org.junit.Assert.assertTrue(controller.state.value.fileExportPending == null)
        }
    }

    @Test fun nativeCopyPickerSelectsVerifiedChildFolder() {
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithTag("files-item-70").performTouchInput { longClick() }
        compose.onNodeWithText("复制到…").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationPath.lastOrNull()?.id == 2L &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            copyCalls == 1 && !controller.state.value.loading &&
                controller.state.value.destinationKind == null
        }
        compose.onNodeWithTag("files-item-70").assertExists()
    }

    @Test fun nativeMovePickerRejectsSameParentThenMovesIntoFolder() {
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithTag("files-item-70").performTouchInput { longClick() }
        compose.onNodeWithText("移动到…").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("files-destination-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationPath.lastOrNull()?.id == 2L &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            moveCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.none { it.id == 70L }
        }
        compose.onNodeWithTag("files-item-70").assertDoesNotExist()
    }

    @Test fun createFolderFromMoreUsesActualServerAndValidatesName() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("files-create-folder-action").performClick()
        compose.onNodeWithTag("files-edit-name").performTextInput("CON")
        compose.onNodeWithTag("files-edit-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("files-edit-name").performTextReplacement("新相册")
        compose.onNodeWithTag("files-edit-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            createCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.any { it.name == "新相册" }
        }
        compose.onNodeWithText("新相册").assertIsDisplayed()
    }

    @Test fun longPressRenameUsesRevisionedServerPatchAndShowsNewName() {
        startAndLogin()
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("重命名").performClick()
        compose.onNodeWithTag("files-edit-name").performTextReplacement("照片备份")
        compose.onNodeWithTag("files-edit-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            renameCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.any { it.name == "照片备份" }
        }
        compose.onNodeWithText("照片备份").assertIsDisplayed()
    }

    @Test fun deleteToTrashRequiresConfirmationAndCancelCannotWrite() {
        startAndLogin()
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("移到回收站").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, trashCalls) }
        compose.onNodeWithText("取消").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, trashCalls) }
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("移到回收站").performClick()
        compose.onNodeWithTag("files-edit-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            trashCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.none { it.id == 2L }
        }
        compose.onNodeWithTag("files-item-2").assertDoesNotExist()
        compose.onNodeWithText("此文件夹为空").assertIsDisplayed()
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

    @Test fun searchAllFilesUsesServerResultRatherThanCurrentDirectoryRows() {
        startAndLogin()
        compose.onNodeWithTag("files-global-search-input").performTextInput("favorite")
        compose.onNodeWithTag("files-global-search-submit").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.SEARCH &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection").assertExists()
        compose.onNodeWithTag("files-collection-item-7").assertExists()
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.BROWSE
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun searchLaunchedFromFavoritesReturnsToFavoritesViaBack() {
        startAndLogin()
        compose.onNodeWithTag("files-section-favorites").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.FAVORITES &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-search-results-input").performTextInput("holiday")
        compose.onNodeWithTag("files-search-results-submit").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.SEARCH &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.FAVORITES &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection-item-7").assertExists()
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
