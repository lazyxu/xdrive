package com.tfluid.xdrive

import android.content.Context
import android.app.Application
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.tfluid.xdrive.core.UpdateSource
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Actual Activity/ViewModel wiring and public source preference, no network. */
class AndroidUpdateActivityTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun sourcePreferenceIsWrittenBeforeLoginAndRestoredWithActivity() {
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("检查更新").performClick()
        compose.onNodeWithText("GitLab").performClick()
        compose.runOnIdle {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            assertEquals("gitlab", context.getSharedPreferences("updates", Context.MODE_PRIVATE).getString("source", null))
            val store = ViewModelStore()
            try {
                val fresh = ViewModelProvider(store, ViewModelProvider.AndroidViewModelFactory.getInstance(context.applicationContext as Application))[DriveViewModel::class.java]
                assertEquals(UpdateSource.GITLAB, fresh.updates.state.value.source)
            } finally { store.clear() }
        }
        compose.onNodeWithText("关闭").performClick()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("检查更新").performClick()
        compose.onNodeWithText("GitLab").assertIsSelected()
        compose.onNodeWithTag("server").assertExists()
        // Reset only our public setting for subsequent fixture tests.
        compose.onNodeWithText("GitHub").performClick()
    }
}
