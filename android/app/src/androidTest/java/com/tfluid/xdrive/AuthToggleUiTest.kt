package com.tfluid.xdrive

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert
import org.junit.Rule
import org.junit.Test

/** Real native Compose interaction, no mock auth transport or synthetic Server. */
class AuthToggleUiTest {
    @get:Rule val compose = createComposeRule()
    private var formState by mutableStateOf(DriveState())
    private var submitted: Pair<Boolean, Boolean>? = null // allowHttp, remember

    private fun showForm() {
        compose.setContent {
            XDriveTheme {
                UnifiedLoginForm(
                    state = formState,
                    login = { _, allowHttp, _, _, _, remember ->
                        submitted = allowHttp to remember
                    },
                    actions = {},
                )
            }
        }
    }

    @Test fun tappingKeepLoginLabelTogglesOneAccessibleActionAndForwardsChoice() {
        showForm()
        compose.onNodeWithTag("keep-login")
            .performScrollTo().assertIsEnabled().assertIsOn()
        // A label tap must be equivalent to tapping the visual checkbox,
        // rather than leaving a separate inert text target for TalkBack.
        compose.onNodeWithText("保持登录").performScrollTo().performClick()
        compose.onNodeWithTag("keep-login").assertIsOff()
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-only")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.runOnIdle {
            Assert.assertEquals(false to false, submitted)
        }
    }

    @Test fun mixedCaseHttpNeverEnablesUnsafeLoginTransport() {
        formState = DriveState(server = "HTTP://192.168.1.2")
        showForm()
        // No switch can authorize plaintext: even a stale HTTP input can
        // never set the old allowHttp transport flag or persist it as opt-in.
        compose.onNodeWithTag("connection-advanced").assertDoesNotExist()
        compose.onNodeWithTag("allow-http").assertDoesNotExist()
        compose.onNodeWithTag("keep-login").performScrollTo().assertIsOn()
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-only")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.runOnIdle { Assert.assertEquals(false to true, submitted) }
    }

    @Test fun loginInFlightDisablesKeepLoginWithNoUnsafeToggle() {
        formState = DriveState(server = "https://drive.example")
        showForm()
        compose.onNodeWithTag("keep-login").performScrollTo().assertIsEnabled()
        compose.onNodeWithTag("allow-http").assertDoesNotExist()
        compose.onNodeWithTag("connection-advanced").assertDoesNotExist()
        compose.runOnIdle { formState = formState.copy(loading = true) }
        compose.onNodeWithTag("keep-login").assertIsNotEnabled()
        compose.onNodeWithTag("allow-http").assertDoesNotExist()
        compose.runOnIdle { formState = formState.copy(loading = false) }
        compose.onNodeWithTag("keep-login").assertIsEnabled()
    }
}
