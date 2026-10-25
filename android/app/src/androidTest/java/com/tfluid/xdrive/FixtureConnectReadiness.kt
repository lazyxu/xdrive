package com.tfluid.xdrive

import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.junit4.ComposeTestRule

/**
 * Real Compose UI fixture handshake, not a controller mock or an automatic
 * retry. Preserve the original 10s CONNECT → LOGIN assertion and expose only
 * non-secret causal evidence if an emulator intermittently misses the handoff.
 */
internal fun ComposeTestRule.awaitFixtureConnectLogin(
    controller: DriveController,
    serviceFactoryCalls: () -> Int,
) {
    try {
        waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.LOGIN
        }
    } catch (failure: ComposeTimeoutException) {
        val state = controller.state.value
        // Query only tag cardinality, never entered URI or auth text.
        val submitNodes = try {
            onAllNodesWithTag("auth-submit").fetchSemanticsNodes().size
        } catch (_: Exception) { -1 }
        val serverNodes = try {
            onAllNodesWithTag("server").fetchSemanticsNodes().size
        } catch (_: Exception) { -1 }
        throw AssertionError(
            "Synthetic CONNECT→LOGIN timed out: screen=${state.screen}, " +
                "loading=${state.loading}, errorPresent=${!state.error.isNullOrBlank()}, " +
                "factoryCalls=${serviceFactoryCalls()}, submitNodes=${submitNodes}, " +
                "serverNodes=${serverNodes}",
            failure,
        )
    }
    waitForIdle()
}
