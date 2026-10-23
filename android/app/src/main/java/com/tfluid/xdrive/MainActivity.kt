package com.tfluid.xdrive

import android.app.Application
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.core.content.edit

class MainActivity : ComponentActivity() {
    private val model by viewModels<DriveViewModel>()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                DriveApp(model.controller)
            }
        }
    }
}

class DriveViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("connection", Application.MODE_PRIVATE)
    val controller = DriveController(
        scope = viewModelScope,
        initialServer = preferences.getString("server", "").orEmpty(),
        initialAllowHttp = preferences.getBoolean("allowHttp", false),
        saveConnection = { server, allow -> preferences.edit { putString("server", server); putBoolean("allowHttp", allow) } },
    )
    override fun onCleared() { controller.close() }
}
