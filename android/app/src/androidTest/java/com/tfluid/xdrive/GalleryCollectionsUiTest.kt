package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

/** Real Compose navigation through authenticated, non-empty album fixtures.
 * No placeholder album rows, WebView, duplicate media index or skipped checks. */
class GalleryCollectionsUiTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val album = GalleryAlbum("manual:trip", "manual", "家庭相册", 1, 3, 0)
    private val libraryPhoto = GalleryAsset(
        DriveNode(777, 1, "library.jpg", "file", size = 16, revision = 1),
        "image", hasThumbnail = false)
    private val albumPhoto = GalleryAsset(
        DriveNode(778, 1, "album.jpg", "file", size = 16, revision = 1),
        "image", hasThumbnail = false)
    private var albumPageCalls = 0
    private val service = object : XDriveService {
        override suspend fun login(username: String, password: String) =
            AuthSession("fixture-access", "fixture-refresh", username)
        override suspend fun refresh(refreshToken: String) =
            AuthSession("fixture-access", "fixture-refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String,
        ) = AuthSession("fixture-access", "fixture-refresh", "owner")
        override suspend fun root(accessToken: String) =
            DriveNode(1, name = "", type = "dir")
        override suspend fun children(accessToken: String, parentId: Long, offset: Int) =
            NodeRange(emptyList(), 0, offset)
        override suspend fun galleryPage(
            accessToken: String, offset: Int, initialLatest: Boolean,
        ) = GalleryPage(listOf(libraryPhoto), 1, 0)
        override suspend fun galleryAlbums(accessToken: String) = listOf(album)
        override suspend fun galleryAlbumPage(
            accessToken: String, albumId: String, offset: Int,
            initialLatest: Boolean,
        ): GalleryPage {
            assertEquals(album.id, albumId)
            albumPageCalls++
            return GalleryPage(listOf(albumPhoto), 1, 0)
        }
    }
    private val controller = DriveController(scope, { service })

    @After fun close() { controller.close(); scope.cancel() }

    @Test fun realCollectionsListOpensAlbumReturnsAndRestoresPhotoLibrary() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("synthetic-password")
        compose.onNodeWithTag("password").performImeAction()
        compose.waitForIdle()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES &&
                controller.state.value.loaded
        }

        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-open-collections").assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums == listOf(album)
        }
        compose.onNodeWithTag("gallery-albums-list").assertIsDisplayed()
        compose.onNodeWithTag("gallery-album-item-manual:trip").assertIsDisplayed()
            .performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded &&
                controller.state.value.gallerySelectedAlbum == album
        }
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.onNodeWithTag("gallery-album-back").assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySelectedAlbum == null &&
                controller.state.value.galleryAlbumsLoaded
        }
        compose.onNodeWithTag("gallery-album-item-manual:trip").assertIsDisplayed()
        compose.onNodeWithTag("gallery-collections-to-library").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryPrimaryTab == GalleryPrimaryTab.LIBRARY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 777L
        }
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle { assertEquals(1, albumPageCalls) }
    }
}
