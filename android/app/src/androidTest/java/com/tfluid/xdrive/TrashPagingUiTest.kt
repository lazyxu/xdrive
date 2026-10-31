package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.tfluid.xdrive.core.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Real native Compose + Controller + authenticated synthetic Owner range.
 * There is no fake successful mutation or production Server credential. */
class TrashPagingUiTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val reads = mutableListOf<Int>()
    private val root = DriveNode(1L, name = "", type = "dir", revision = 1L)
    private val first = TrashEntry(
        DriveNode(3L, parentId = 1L, name = "old-a.txt", type = "file",
            size = 5L, revision = 1L),
        "2026-10-01T12:00:00Z")
    private val second = TrashEntry(
        DriveNode(4L, parentId = 1L, name = "old-b.txt", type = "file",
            size = 6L, revision = 1L),
        "2026-10-02T12:00:00Z")
    private val service = object : XDriveService {
        override suspend fun login(username: String, password: String) =
            AuthSession("fixture-access", "fixture-refresh", username)
        override suspend fun refresh(refreshToken: String) =
            AuthSession("fixture-access", "fixture-refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(
            accessToken: String, currentPassword: String, newPassword: String,
        ) = AuthSession("fixture-access", "fixture-refresh", "owner")
        override suspend fun root(accessToken: String) = root
        override suspend fun children(
            accessToken: String, parentId: Long, offset: Int,
        ) = NodeRange(emptyList(), 0L, offset)
        override suspend fun trashPage(accessToken: String, offset: Int): TrashPage {
            check(accessToken == "fixture-access")
            reads += offset
            return TrashPage(
                when (offset) {
                    0 -> listOf(first)
                    1 -> listOf(second)
                    else -> error("Unexpected speculative trash page offset $offset")
                },
                2L, offset,
            )
        }
    }
    private val controller = DriveController(scope, { service })

    @After fun close() { controller.close(); scope.cancel() }

    @Test fun firstShortPageRequiresManualLoadAndNeverPrefetchesOnLayout() {
        compose.setContent { XDriveTheme { DriveApp(controller, galleryFirstOnLogin = false) } }
        compose.runOnIdle {
            controller.connectAndLogin("https://drive.example", false,
                "", "owner", "fixture-password", true)
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES &&
                controller.state.value.loaded && !controller.state.value.loading
        }
        compose.runOnIdle { controller.openTrash() }
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.TRASH &&
                controller.state.value.trashLoaded && !controller.state.value.loading
        }
        compose.waitForIdle()
        compose.runOnIdle { assertEquals(listOf(0), reads) }
        compose.onNodeWithTag("trash-load-more")
            .assertIsDisplayed().assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.trashItems.size == 2 &&
                !controller.state.value.loading
        }
        compose.runOnIdle { assertEquals(listOf(0, 1), reads) }
        compose.onNodeWithTag("trash-load-more").assertDoesNotExist()
        compose.onNodeWithText("old-b.txt").assertExists()
    }
}
