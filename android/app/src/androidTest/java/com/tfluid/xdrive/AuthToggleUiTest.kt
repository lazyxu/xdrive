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
        compose.onNodeWithTag("keep-login-row")
            .performScrollTo().assertIsEnabled().assertIsOn()
        // A label tap must be equivalent to tapping the visual checkbox,
        // rather than leaving a separate inert text target for TalkBack.
        compose.onNodeWithText("保持登录").performScrollTo().performClick()
        compose.onNodeWithTag("keep-login-row").assertIsOff()
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-only")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.runOnIdle {
            Assert.assertEquals(false to false, submitted)
        }
    }

    @Test fun mixedCaseHttpCannotOfferCredentialPersistence() {
        formState = DriveState(server = "HTTP://192.168.1.2")
        showForm()
        compose.onNodeWithTag("keep-login-row")
            .performScrollTo().assertIsOff().assertIsNotEnabled()
        compose.onNodeWithText("明文 HTTP 连接不能保持登录，请尽量使用 HTTPS。")
            .performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("connection-advanced").performClick()
        compose.onNodeWithTag("allow-http-row")
            .performScrollTo().assertIsOff().assertIsEnabled().performClick()
        compose.onNodeWithTag("allow-http-row").assertIsOn()
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-only")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.runOnIdle {
            Assert.assertEquals(true to false, submitted)
        }
    }

    @Test fun loginInFlightDisablesBothAuthToggles() {
        formState = DriveState(server = "https://drive.example")
        showForm()
        compose.onNodeWithTag("connection-advanced").performClick()
        compose.onNodeWithTag("keep-login-row").performScrollTo().assertIsEnabled()
        compose.onNodeWithTag("allow-http-row").performScrollTo().assertIsEnabled()
        compose.runOnIdle { formState = formState.copy(loading = true) }
        compose.onNodeWithTag("keep-login-row").assertIsNotEnabled()
        compose.onNodeWithTag("allow-http-row").assertIsNotEnabled()
        compose.onNodeWithTag("connection-advanced").assertIsNotEnabled()
        compose.runOnIdle { formState = formState.copy(loading = false) }
        compose.onNodeWithTag("keep-login-row").assertIsEnabled()
        compose.onNodeWithTag("allow-http-row").assertIsEnabled()
    }
}
