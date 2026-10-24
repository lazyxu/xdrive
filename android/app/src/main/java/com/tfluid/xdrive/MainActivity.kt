package com.tfluid.xdrive

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tfluid.xdrive.core.AndroidUpdateClient
import com.tfluid.xdrive.core.UpdateSource
import androidx.core.content.edit

class MainActivity : ComponentActivity() {
    private val model by viewModels<DriveViewModel>()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent {
            XDriveTheme {
                DriveApp(model.controller, model.updates, openUpdate = { url ->
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
                        true
                    } catch (_: ActivityNotFoundException) { false }
                    catch (_: SecurityException) { false }
                })
            }
        }
    }
}

class DriveViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("connection", Application.MODE_PRIVATE)
    private val updatePreferences = application.getSharedPreferences("updates", Application.MODE_PRIVATE)
    @Suppress("DEPRECATION")
    private val installedPackage = application.packageManager.getPackageInfo(application.packageName, 0)
    val updates = UpdateController(
        scope = viewModelScope,
        installedCode = installedPackage.longVersionCode,
        versionName = installedPackage.versionName ?: "未知",
        service = AndroidUpdateClient(),
        initialSource = UpdateSource.fromPreference(updatePreferences.getString("source", null)),
        saveSource = { source -> updatePreferences.edit { putString("source", source.preference) } },
    )
    val controller = DriveController(
        scope = viewModelScope,
        initialServer = preferences.getString("server", "").orEmpty(),
        initialAllowHttp = preferences.getBoolean("allowHttp", false),
        saveConnection = { server, allow -> preferences.edit { putString("server", server); putBoolean("allowHttp", allow) } },
    )
    override fun onCleared() { updates.close(); controller.close() }
}
