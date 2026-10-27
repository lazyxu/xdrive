package com.tfluid.xdrive

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import com.tfluid.xdrive.core.*
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
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
    private var textPreviewFixture = false
    private var textPreviewReads = 0
    private var locateLargeFolder = false
    private var locateRangeReads = 0
    private val locatedFile = DriveNode(1155, 1, "target-155.txt", "file", 12, revision = 2)
    private val mutableRootRows = mutableListOf(DriveNode(2, 1, "假期照片", "dir", revision = 1))
    private var galleryAutoPagingFixture = false
    private var galleryManyPhotos = false
    private var galleryTimelineFixture = false
    private var galleryVideoFixture = false
    private var galleryLivePhotoFixture = false
    private var galleryLIVPFixture = false
    private var liveStillReads = 0
    private var liveMotionRequests = 0
    private var liveMotionClosed = 0
    private var galleryOversizeFixture = false
    private var galleryThumbnailFailuresRemaining = 0
    private var galleryThumbnailReads = 0
    private var videoTransportClosed = 0
    private val galleryOffsets = mutableListOf<Int>()
    private var galleryRangeReads = 0
    private val galleryTimelineRequests = mutableListOf<Pair<Int, Boolean>>()
    private val gallerySearchQueries = mutableListOf<String>()
    private val galleryKindQueries = mutableListOf<Pair<String, String>>()
    private var galleryThumbnailRetryFixture = false
    private val galleryThumbnailCalls = AtomicInteger()
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
            initialLatest: Boolean): GalleryPage {
            galleryRangeReads++
            if (galleryTimelineFixture) {
                galleryTimelineRequests += offset to initialLatest
                val groups = GalleryTimelineSets(
                    year = listOf(GalleryTimelineGroup("2025", 60, 0),
                        GalleryTimelineGroup("2026", 61, 60)),
                    month = listOf(GalleryTimelineGroup("2025-12", 60, 0),
                        GalleryTimelineGroup("2026-10", 61, 60)),
                    day = listOf(GalleryTimelineGroup("unknown", 60, 0),
                        GalleryTimelineGroup("2026-10-25", 61, 60)),
                )
                if (initialLatest)
                    return GalleryPage(listOf(galleryFixture), 121, 120, timeline = groups)
                return GalleryPage((offset until minOf(offset + 60, 121)).map { index ->
                    if (index == 120) galleryFixture else GalleryAsset(
                        DriveNode(1000L + index, 1L, "photo-$index.jpg",
                            "file", size = 44, revision = 1),
                        "image", hasThumbnail = true)
                }, 121, offset)
            }
            if (galleryLivePhotoFixture) return GalleryPage(listOf(GalleryAsset(
                DriveNode(48, 1,
                    if (galleryLIVPFixture) "live.livp" else "paired.jpg",
                    "file", size = if (galleryLIVPFixture)
                        80L * 1024 * 1024 else 44L, revision = 2),
                "image", livePhoto = true, hasThumbnail = true)), 1, 0)
            if (galleryVideoFixture) return GalleryPage(listOf(GalleryAsset(
                DriveNode(45, 1, "clip.mp4", "file", size = 100, revision = 2),
                "video", durationMs = 10_000L, hasThumbnail = true)), 1, 0)
            if (galleryOversizeFixture) return GalleryPage(listOf(GalleryAsset(
                DriveNode(46, 1, "large.jpg", "file",
                    size = 32L * 1024 * 1024 + 1, revision = 2),
                "image", hasThumbnail = true)), 1, 0)
            if (galleryManyPhotos) {
            val originals = (0 until 60).map { index ->
                GalleryAsset(DriveNode(1000L + index, 1L,
                    "相片-${index}.jpg", "file", size = 44, revision = 1),
                    "image", hasThumbnail = true)
            }
            return GalleryPage(originals, 60, 0)
            }
            if (!galleryAutoPagingFixture) return GalleryPage(listOf(galleryFixture), 1, 0)
            galleryOffsets += if (initialLatest) 180 else offset
            return if (initialLatest) GalleryPage(listOf(galleryFixture), 181, 180)
            else GalleryPage((offset until offset + 60).map { index ->
                GalleryAsset(
                    DriveNode(1000L + index, 1L, "相片-${index}.jpg", "file",
                        size = 44, revision = 1), "image", hasThumbnail = true)
            }, 181, offset)
        }
        override suspend fun gallerySearchPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String): GalleryPage {
            gallerySearchQueries += search
            return GalleryPage(listOf(GalleryAsset(
                DriveNode(46, 1, "search-result.jpg", "file", size = 64, revision = 1),
                "image", hasThumbnail = true)), 1, 0)
        }
        override suspend fun galleryKindPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String, kind: String): GalleryPage {
            galleryKindQueries += search to kind
            return GalleryPage(listOf(GalleryAsset(
                DriveNode(if (kind == "video") 47L else 48L, 1,
                    if (kind == "video") "filtered.mp4" else "filtered.jpg",
                    "file", size = 64, revision = 1),
                kind, hasThumbnail = true)), 1, 0)
        }
        override suspend fun galleryThumbnail(accessToken: String, nodeId: Long,
            revision: Long): ByteArray {
            galleryThumbnailReads++
            if (galleryThumbnailFailuresRemaining > 0) {
                galleryThumbnailFailuresRemaining--
                throw ApiException(503, "Fixture one-shot unavailable thumbnail")
            }
            if (galleryOversizeFixture || galleryVideoFixture || galleryLivePhotoFixture) {
                val small = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
                return try {
                    val output = ByteArrayOutputStream()
                    check(small.compress(Bitmap.CompressFormat.JPEG, 75, output))
                    output.toByteArray()
                } finally {
                    small.recycle()
                }
            }
            if (!galleryThumbnailRetryFixture) return byteArrayOf(1, 2, 3)
            if (galleryThumbnailCalls.incrementAndGet() == 1) return byteArrayOf(1, 2, 3)
            val bitmap = android.graphics.Bitmap.createBitmap(
                16, 16, android.graphics.Bitmap.Config.ARGB_8888)
            val output = java.io.ByteArrayOutputStream()
            try {
                check(bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, output))
                return output.toByteArray()
            } finally {
                bitmap.recycle()
            }
        }
        override suspend fun galleryLivePhotoStill(
            accessToken: String, node: DriveNode,
            onProgress: (Long, Long?) -> Unit,
        ): ByteArray {
            check(galleryLivePhotoFixture && galleryLIVPFixture &&
                node.id == 48L && node.revision == 2L)
            liveStillReads++
            val bitmap = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
            return try {
                val output = ByteArrayOutputStream()
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output))
                val data = output.toByteArray()
                onProgress(data.size.toLong(), data.size.toLong())
                data
            } finally { bitmap.recycle() }
        }
        override suspend fun galleryLivePhotoMotionPlayback(
            accessToken: String, node: DriveNode,
        ): OwnerVideoPlayback {
            check(galleryLivePhotoFixture && node.id == 48L && node.revision == 2L)
            liveMotionRequests++
            return OwnerVideoPlayback(
                "https://fixture.invalid/api/v1/media-live-photo-motion/48?ticket=fixture",
                okhttp3.OkHttpClient.Builder().addInterceptor {
                    throw java.io.IOException("Fixture motion codec unavailable")
                }.build(), 0L,
            ) { liveMotionClosed++ }
        }
        override fun galleryVideoPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback =
            OwnerVideoPlayback(
                "https://fixture.invalid/api/v1/files/" + node.id + "/content",
                okhttp3.OkHttpClient.Builder().addInterceptor {
                    throw java.io.IOException("Fixture intentionally has no MP4")
                }.build(), node.size,
            ) { videoTransportClosed++ }
        override suspend fun fileRecent(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(2, 1, "假期照片", "dir"), "假期照片",
                listOf(DriveCrumb(1, ""), DriveCrumb(2, "假期照片"))))
        override suspend fun fileFavorites(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                listOf(DriveCrumb(1, ""), DriveCrumb(7, "favorite.txt"))))
        override suspend fun searchFiles(accessToken: String, query: String, cursor: String): FileSearchPage =
            if (locateLargeFolder) FileSearchPage(listOf(
                DriveCollectionItem(locatedFile, "outdated/path/target-155.txt",
                    listOf(DriveCrumb(888, "stale")))), "")
            else FileSearchPage(listOf(
                DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                    listOf(DriveCrumb(1, "")))), "")
        override suspend fun nodeLocation(accessToken: String, nodeId: Long): OwnedNodeLocation {
            check(locateLargeFolder && nodeId == locatedFile.id)
            return OwnedNodeLocation(nodeId, locatedFile.revision, 1, listOf(DriveCrumb(1, "")))
        }
        override suspend fun childPosition(
            accessToken: String, parentId: Long, nodeId: Long,
        ): DirectoryItemPosition {
            check(locateLargeFolder && parentId == 1L && nodeId == locatedFile.id)
            return DirectoryItemPosition(nodeId, locatedFile.revision, 155)
        }
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
        override suspend fun textFilePreview(
            accessToken: String, node: DriveNode,
        ): FileTextPreview {
            check(textPreviewFixture && node.id == 3L && node.revision == 2L)
            textPreviewReads++
            return FileTextPreview("hello xDrive", false, node.size)
        }
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange {
            if (failNext || (paging && offset == 100 && failOnSecondPage)) {
                failNext = false; failOnSecondPage = false; throw ApiException(503, "unavailable")
            }
            if (locateLargeFolder && parentId == 1L) {
                locateRangeReads++
                val rows = (0..200).drop(offset).take(100).map { index ->
                    when (index) {
                        0 -> DriveNode(2, 1, "假期照片", "dir", revision = 1)
                        155 -> locatedFile
                        else -> DriveNode(1000L + index, 1, "file-$index.txt", "file",
                            size = 12, revision = 1)
                    }
                }
                return NodeRange(rows, 201, offset)
            }
            val rows = if (paging && offset == 100) listOf(DriveNode(4, 1, "第二页.txt", "file", 2048))
                else if (manyFiles && parentId == 1L) listOf(DriveNode(2, 1, "假期照片", "dir")) +
                    (1..99).map { index -> if (index == 49)
                        DriveNode(200, 1, "第二相册", "dir")
                        else DriveNode(100L + index, 1, "item-$index.txt", "file", 128) }
                else if (parentId == 1L) mutableRootRows.toList() +
                    (if (extraRootFile) listOf(DriveNode(70, 1, "复制目标.txt", "file", 120, revision = 2))
                        else emptyList())
                else listOf(DriveNode(3, 2, "测试.txt", "file", 12,
                    revision = if (textPreviewFixture) 2 else 0,
                    updatedAt = "2026-10-23T00:00:00Z"))
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

    @Test fun nativeTransfersOpenFromFilesAndGalleryWithoutInventingHistory() {
        startAndLogin()
        compose.onNodeWithTag("native-transfer-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-transfer-center").assertExists()
        compose.onNodeWithTag("native-transfer-empty").assertIsDisplayed()
        compose.onNodeWithText("本次登录的上传与下载 · 最近最多 20 项").assertExists()
        compose.onNodeWithTag("native-transfer-close").performClick()
        compose.onNodeWithTag("native-transfer-center").assertDoesNotExist()

        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("native-transfer-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-transfer-empty").assertExists()
        compose.onNodeWithTag("native-transfer-close").performClick()

        // The normal Account menu still controls Owner logout independently.
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.LOGIN
        }
        compose.onNodeWithTag("native-transfer-open").assertDoesNotExist()
        compose.runOnIdle {
            org.junit.Assert.assertTrue(controller.state.value.nativeTransfers.isEmpty())
        }
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

    @Test fun showInFolderSelectsExactFileOnFirstFrameInListAndGrid() {
        locateLargeFolder = true
        startAndLogin()
        compose.onNodeWithTag("files-global-search-input").performTextInput("target")
        compose.onNodeWithTag("files-global-search-submit").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.SEARCH &&
                controller.state.value.collectionLoaded &&
                controller.state.value.collectionItems.singleOrNull()?.node?.id == 1155L
        }
        compose.onNodeWithTag("files-collection-item-1155", useUnmergedTree = true)
            .performTouchInput { longClick() }
        compose.onNodeWithText("显示所在位置").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.BROWSE &&
                controller.state.value.focusedBrowseNodeId == 1155L &&
                controller.state.value.loaded && !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(100, controller.state.value.browseWindowStart)
            org.junit.Assert.assertEquals(55, controller.state.value.focusedBrowseIndex)
            org.junit.Assert.assertEquals(100, controller.state.value.items.size)
            // One initial page plus one precisely positioned Range.
            org.junit.Assert.assertEquals(2, locateRangeReads)
        }
        compose.onNodeWithTag("files-item-1155").assertIsDisplayed().assertIsSelected()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-item-1155").assertIsDisplayed().assertIsSelected()
        compose.runOnIdle { org.junit.Assert.assertEquals(2, locateRangeReads) }
    }

    @Test fun nativeGallerySearchUsesRealOwnerRangeAndClearsWithoutCrossOwnerRows() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.galleryLoaded }
        compose.onNodeWithTag("gallery-search-button").performClick()
        compose.onNodeWithTag("gallery-search-input").performTextInput("sunset")
        compose.onNodeWithTag("gallery-search-apply").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySearchQuery == "sunset" &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 46L
        }
        compose.runOnIdle { org.junit.Assert.assertEquals(listOf("sunset"), gallerySearchQueries) }
        compose.onNodeWithTag("gallery-search-clear").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySearchQuery.isEmpty() &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 40L
        }
    }

    @Test fun nativeGalleryKindFilterUsesServerAndResetsPositionOnChangedScope() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.galleryLoaded }
        compose.onNodeWithTag("gallery-kind-filter").performClick()
        compose.onNodeWithTag("gallery-kind-video").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryMediaKind == "video" &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 47L
        }
        compose.onNodeWithTag("gallery-kind-filter")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "仅视频"))
        compose.onNodeWithTag("gallery-search-button").performClick()
        compose.onNodeWithTag("gallery-search-input").performTextInput("sunset")
        compose.onNodeWithTag("gallery-search-apply").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySearchQuery == "sunset" &&
                controller.state.value.galleryMediaKind == "video"
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf("" to "video", "sunset" to "video"),
                galleryKindQueries)
        }
        compose.onNodeWithTag("gallery-kind-filter").performClick()
        compose.onNodeWithTag("gallery-kind-all").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryMediaKind.isEmpty() &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 46L
        }
    }

    @Test fun nativeGalleryTimeScaleUsesOwnerIndexedJumpAndResetsToLatest() {
        galleryTimelineFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        // The latest tail is intentionally sparse (one row at index 120).
        // The existing Gallery lifecycle is allowed exactly one real
        // earlier Range prefetch before the user's first date jump.
        compose.waitUntil(timeoutMillis = 10_000) {
            val state = controller.state.value
            state.galleryLoaded && !state.loading &&
                state.galleryTimelineSets != null &&
                state.galleryItems.size == 61 && state.galleryOffset == 60
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(
                listOf(0 to true, 60 to false), galleryTimelineRequests)
            org.junit.Assert.assertEquals(121L, controller.state.value.galleryTotal)
        }
        val beforeJump = galleryTimelineRequests.size
        compose.onNodeWithTag("gallery-time-scale-year").performClick()
        compose.onNodeWithTag("gallery-time-groups").assertExists()
        compose.onNodeWithTag("gallery-time-group-2026").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            val state = controller.state.value
            state.galleryLoaded && !state.loading &&
                state.galleryJumpIndex == 60 &&
                state.galleryItems.firstOrNull()?.node?.id == 1060L
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(121L, controller.state.value.galleryTotal)
            org.junit.Assert.assertEquals(60, controller.state.value.galleryOffset)
            org.junit.Assert.assertEquals(60, controller.state.value.galleryItems.size)
            // The actual date click must issue exactly one indexed Owner GET.
            // Do not count the legitimate sparse-tail prefetch as a duplicate.
            org.junit.Assert.assertEquals(
                listOf(60 to false), galleryTimelineRequests.drop(beforeJump))
        }
        val beforeAll = galleryTimelineRequests.size
        compose.onNodeWithTag("gallery-time-scale-all").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            val state = controller.state.value
            state.galleryLoaded && !state.loading &&
                state.galleryJumpIndex == null &&
                state.galleryTimelineSets != null &&
                state.galleryItems.lastOrNull()?.node?.id == 40L
        }
        compose.runOnIdle {
            val requests = galleryTimelineRequests.drop(beforeAll)
            org.junit.Assert.assertTrue("All must reload real latest",
                requests.isNotEmpty())
            org.junit.Assert.assertEquals(0 to true, requests.first())
            // An optional follow-up 60-row prefetch is a separate read.
            org.junit.Assert.assertTrue("No redundant latest or older scans",
                requests.size <= 2 && requests.drop(1).all { it == (60 to false) })
            org.junit.Assert.assertTrue(controller.state.value.galleryOffset in
                listOf(60, 120))
            org.junit.Assert.assertEquals(40L,
                controller.state.value.galleryItems.last().node.id)
        }
    }

    @Test fun nativeGalleryDisplayOptionsAdjustRealGridWithoutReloadingOwnerPhotos() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        var readsBefore = 0
        compose.runOnIdle { readsBefore = galleryRangeReads }
        compose.onNodeWithTag("gallery-view-options").performClick()
        compose.onNodeWithTag("gallery-zoom-out").performClick()
        compose.onNodeWithTag("gallery-view-options")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "缩略图密度 4 档，方形裁切"))
        compose.onNodeWithTag("gallery-view-options").performClick()
        compose.onNodeWithTag("gallery-aspect-contain").performClick()
        compose.onNodeWithTag("gallery-view-options")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "缩略图密度 4 档，完整比例"))
        // Display changes cannot trigger a second Owner Range or invalidate a tile.
        compose.runOnIdle {
            org.junit.Assert.assertEquals(readsBefore, galleryRangeReads)
            org.junit.Assert.assertEquals(40L, controller.state.value.galleryItems.single().node.id)
        }
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-view-options")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "缩略图密度 4 档，完整比例"))
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

    @Test fun galleryThumbnailFailureRequiresUserRetryAndThenShowsImage() {
        galleryThumbnailRetryFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-failed-40", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.waitForIdle()
        // Invalid first thumbnail never automatically creates a request storm.
        compose.runOnIdle { org.junit.Assert.assertEquals(1, galleryThumbnailCalls.get()) }
        // No operation icon on the tile: explicit long-press retries instead.
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true)
            .performTouchInput { longClick() }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-ready-40", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-thumbnail-failed-40", useUnmergedTree = true)
            .assertDoesNotExist()
        // One initial error + one explicit long-press retry. Opening the
        // Viewer is a separate lifecycle and must not be counted as another
        // Gallery tile retry.
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailCalls.get()) }
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithText("相册照片.jpg").assertIsDisplayed()
        // The synthetic original is not decodable. The real native Viewer
        // reuses the currently decoded Owner/revision JPEG from the Gallery
        // bitmap cache: fallback must not issue a third thumbnail HTTP request
        // or start any background retry loop.
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-fallback", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-fallback").assertIsDisplayed()
        // One failed tile + one user-triggered tile retry; the Viewer shares
        // the decoded JPEG and never repeats its authenticated thumbnail GET.
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailCalls.get()) }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-thumbnail-ready-40", useUnmergedTree = true).assertExists()
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailCalls.get()) }
    }

    @Test fun GalleryAutomaticallyFetchesOlderOwnerRangeAtScrolledTop() {
        galleryAutoPagingFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        // Initial latest single tile triggers one bounded sparse-tail prefetch.
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryOffset == 120 &&
                controller.state.value.galleryItems.size == 61
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(0)
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryOffset == 60 &&
                controller.state.value.galleryItems.size == 121
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(180, 120, 60), galleryOffsets)
            org.junit.Assert.assertEquals(
                40L, controller.state.value.galleryItems.last().node.id)
            org.junit.Assert.assertNull(controller.state.value.error)
        }
    }

    @Test fun nativePhotoTileOpensImageViewerAndBackPreservesGallery() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
            org.junit.Assert.assertEquals(Screen.GALLERY, controller.state.value.screen)
        }
    }

    @Test fun oversizedNativePhotoUsesBoundedOwnerThumbnailAndLabelsDegradedPreview() {
        galleryOversizeFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-ready-46",
                useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        val readsBeforeViewer = galleryThumbnailReads
        compose.onNodeWithTag("gallery-item-46", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-fallback").fetchSemanticsNodes().isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(readsBeforeViewer, galleryThumbnailReads)
        }
        compose.onNodeWithTag("gallery-photo-image").assertExists()
        compose.onNodeWithTag("gallery-photo-fallback").assertIsDisplayed()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
        }
    }

    @Test fun failedNativePhotoRequiresExplicitRetryAndRecoversSameOwnerThumbnail() {
        galleryOversizeFixture = true
        galleryThumbnailFailuresRemaining = 2
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded && galleryThumbnailReads > 0 &&
                compose.onAllNodesWithTag("gallery-thumbnail-failed-46",
                    useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        // A missing Gallery tile and then the Viewer fallback fail once each.
        // No cached success exists in this fixture; manual Retry is the third
        // authenticated request and may never start on its own.
        compose.onNodeWithTag("gallery-item-46", useUnmergedTree = true).performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-retry").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-image").assertDoesNotExist()
        compose.onNodeWithTag("gallery-photo-retry").assertIsDisplayed()
        val failureReads = galleryThumbnailReads
        compose.waitForIdle()
        org.junit.Assert.assertEquals(failureReads, galleryThumbnailReads)
        compose.onNodeWithTag("gallery-photo-retry").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-fallback").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-image").assertIsDisplayed()
        compose.onNodeWithTag("gallery-photo-retry").assertDoesNotExist()
        org.junit.Assert.assertEquals(failureReads + 1, galleryThumbnailReads)
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
    }

    @Test fun photoViewerBackRestoresActualGalleryScrollAnchor() {
        galleryManyPhotos = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(30)
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true)
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true)
            .assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
        }
    }

    @Test fun leavingGalleryClearsOldViewportButViewerBackKeepsCurrentAnchor() {
        galleryManyPhotos = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(0)
        compose.onNodeWithTag("gallery-item-1000", useUnmergedTree = true)
            .assertIsDisplayed()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-files").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES
        }
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        // Re-entering a Gallery session must start at newest, rather than
        // restoring the former session's oldest tile at index zero.
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-item-1059", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-item-1059", useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test fun galleryViewerSwipeChangesOnlyVerifiedAdjacentOwnerPhotos() {
        galleryManyPhotos = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(30)
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { swipeLeft() }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1031L,
                controller.state.value.galleryViewer?.node?.id)
        }
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { swipeRight() }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1030L,
                controller.state.value.galleryViewer?.node?.id)
        }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test fun nativeLIVPStillIsReadFromSignedResourceNotOuterZip() {
        galleryLivePhotoFixture = true
        galleryLIVPFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-item-48", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.waitUntil(timeoutMillis = 10_000) {
            liveStillReads == 1 &&
                compose.onAllNodesWithTag("gallery-photo-image").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-image").assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, liveStillReads)
            org.junit.Assert.assertEquals(0, liveMotionRequests)
        }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
    }

    @Test fun nativeLivePhotoNeedsExplicitHoldAndReleasesPrivateMotionOnUp() {
        galleryLivePhotoFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                compose.onAllNodesWithTag("gallery-thumbnail-ready-48",
                    useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-item-48", useUnmergedTree = true).performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-image").fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(0, liveMotionRequests)
        }
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { longClick() }
        compose.waitUntil(timeoutMillis = 10_000) { liveMotionRequests == 1 }
        compose.waitUntil(timeoutMillis = 10_000) { liveMotionClosed == 1 }
        compose.onNodeWithTag("gallery-photo-image").assertIsDisplayed()
        compose.onNodeWithTag("gallery-live-motion-surface").assertDoesNotExist()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, liveMotionRequests)
            org.junit.Assert.assertEquals(1, liveMotionClosed)
        }
    }

    @Test fun nativeVideoOpensMedia3AndClosesOwnerStream() {
        galleryVideoFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-ready-45",
                useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        val readsBeforeViewer = galleryThumbnailReads
        compose.onNodeWithTag("gallery-item-45", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-video-viewer").assertExists()
        compose.onNodeWithTag("gallery-video-player").assertExists()
        compose.onNodeWithTag("gallery-video-poster").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(readsBeforeViewer, galleryThumbnailReads)
        }
        compose.onNodeWithTag("gallery-video-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
            org.junit.Assert.assertEquals(1, videoTransportClosed)
        }
    }

    @Test fun galleryInfoOffersRealOwnerPhotoSafDownloadAndNoPlaceholderWhenUnavailable() {
        val downloads = mutableListOf<Long>()
        startAndLogin(onDownload = { downloads += it.id })
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.galleryLoaded }
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-info").performClick()
        compose.onNodeWithTag("gallery-download-action").assertExists().assertIsEnabled().performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(listOf(40L), downloads) }
    }

    @Test fun nativeExportPickerUsesTypedDocumentIntentAndRejectsNonDocumentUri() {
        val contract = NativeCreateDocument()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val image = contract.createIntent(context, NativeExportDocument("family.jpeg", "image/jpeg"))
        org.junit.Assert.assertEquals(Intent.ACTION_CREATE_DOCUMENT, image.action)
        org.junit.Assert.assertEquals("image/jpeg", image.type)
        org.junit.Assert.assertEquals("family.jpeg", image.getStringExtra(Intent.EXTRA_TITLE))
        org.junit.Assert.assertTrue(image.hasCategory(Intent.CATEGORY_OPENABLE))

        val video = contract.createIntent(context, NativeExportDocument("clip.mov", "video/quicktime"))
        org.junit.Assert.assertEquals("video/quicktime", video.type)
        val forbidden = Intent().setData(Uri.parse("file:///data/local/tmp/foreign"))
        org.junit.Assert.assertNull(contract.parseResult(Activity.RESULT_OK, forbidden))
        org.junit.Assert.assertNull(contract.parseResult(Activity.RESULT_CANCELED,
            Intent().setData(Uri.parse("content://fake/export"))))
        val accepted = Uri.parse("content://fixture/export")
        org.junit.Assert.assertEquals(accepted, contract.parseResult(Activity.RESULT_OK,
            Intent().setData(accepted)))
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
        // The real Compose LazyColumn may not mount its second row while the
        // IME/viewport settles. Verify actual Owner rows before scrolling to
        // the fixture target; never synthesize a click or retry a write.
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.loaded &&
                controller.state.value.filesSection == FilesSection.BROWSE &&
                controller.state.value.items.any { it.id == 70L }
        }
        val targetIndex = controller.state.value.items.indexOfFirst { it.id == 70L }
        compose.onNodeWithTag("files").performScrollToIndex(targetIndex)
        compose.onNodeWithTag("files-item-70").assertIsDisplayed()
            .performTouchInput { longClick() }
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

    @Test fun nativeFilesTextPreviewShowsBoundedRealOwnerTextAndReclaimsOnClose() {
        textPreviewFixture = true
        startAndLogin()
        compose.onNodeWithText("假期照片").performClick()
        compose.onNodeWithText("测试.txt").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.fileTextPreview?.text == "hello xDrive" &&
                !controller.state.value.fileTextPreviewLoading
        }
        compose.onNodeWithTag("files-text-preview-content").assertIsDisplayed()
        compose.onNodeWithText("hello xDrive").assertIsDisplayed()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, textPreviewReads) }
        compose.onNodeWithText("关闭").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.fileTextPreview)
            org.junit.Assert.assertNull(controller.state.value.selected)
        }
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.runOnIdle { org.junit.Assert.assertNull(controller.state.value.fileTextPreview) }
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
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        // The unified form never stores a cleartext HTTP refresh credential.
        compose.onNodeWithTag("keep-login").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.error != null }
        compose.onNodeWithTag("request-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("connection-advanced").performScrollTo().performClick()
        compose.onNodeWithTag("allow-http").performScrollTo().performClick()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES && controller.state.value.loaded
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun unifiedLoginValidatesLanAndClearsStaleOriginSettings() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        compose.onNodeWithTag("lan-ip").performScrollTo().performTextInput("192.168.2.999")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.onNodeWithTag("request-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("lan-ip").performScrollTo().performTextReplacement("192.168.2.4")
        compose.onNodeWithTag("server").performScrollTo().performTextReplacement("https://other.example")
        compose.onNodeWithTag("lan-ip").performScrollTo()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        // Routing is now automatic; the old three-mode/public IP UI must stay removed.
        compose.onNodeWithTag("route-auto").assertDoesNotExist()
        compose.onNodeWithTag("route-lan").assertDoesNotExist()
        compose.onNodeWithTag("route-public").assertDoesNotExist()
        compose.onNodeWithTag("public-ip").assertDoesNotExist()
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
