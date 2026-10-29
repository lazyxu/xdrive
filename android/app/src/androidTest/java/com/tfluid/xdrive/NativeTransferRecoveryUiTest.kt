package com.tfluid.xdrive

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test

/** Real Compose confirmation only, never a fake remote finalize or background
 * resume. The Controller owns the authenticated Owner check. */
class NativeTransferRecoveryUiTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val controller = DriveController(scope)
    private val notice = NativeInterruptedTransfer(
        "019abca0-1254-4a18-b0e9-824bac80d034",
        NativeTransferKind.UPLOAD, 1_700_000_000_000L)

    @After fun close() { controller.close(); scope.cancel() }

    private fun show(state: DriveState) {
        compose.setContent {
            XDriveTheme {
                NativeTransferCenter(state, controller, dismiss = {})
            }
        }
    }

    @Test fun priorUploadHasNoInventedFilenameAndRequiresSecondConfirmation() {
        show(DriveState(screen = Screen.FILES, server = "https://drive.example/",
            username = "owner", interruptedNativeTransfers = listOf(notice)))
        compose.onNodeWithTag("native-recovery-heading").assertExists()
        compose.onNodeWithText("上传结果未确认").assertExists()
        compose.onNodeWithTag("native-recovery-review-${notice.id}")
            .performScrollTo().assertIsEnabled().performClick()
        compose.onNodeWithTag("native-recovery-confirm-dialog").assertExists()
        compose.onNodeWithText("这不会恢复上传", substring = true).assertExists()
        compose.onNodeWithTag("native-recovery-cancel").performClick()
        compose.onNodeWithTag("native-recovery-confirm-dialog").assertDoesNotExist()
        compose.onNodeWithTag("native-recovery-review-${notice.id}").assertExists()
    }

    @Test fun activeSafTransferBlocksDeletingRecoveryJournal() {
        show(DriveState(screen = Screen.FILES, server = "https://drive.example/",
            username = "owner", interruptedNativeTransfers = listOf(notice),
            fileUploadActive = true))
        compose.onNodeWithTag("native-recovery-review-${notice.id}")
            .performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("native-recovery-confirm-dialog").assertDoesNotExist()
    }

    @Test fun unreadableEncryptedJournalDoesNotLookLikeSuccessfulHistory() {
        show(DriveState(screen = Screen.FILES, server = "https://drive.example/",
            username = "owner", transferRecoveryIssue = true))
        compose.onNodeWithTag("native-recovery-warning").assertExists()
        compose.onNodeWithText("加密传输恢复记录未能完整读取或清理", substring = true)
            .assertExists()
    }
}
