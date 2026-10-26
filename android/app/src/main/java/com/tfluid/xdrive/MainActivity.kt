package com.tfluid.xdrive

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
 import android.provider.OpenableColumns
import android.os.Bundle
import java.io.IOException
import androidx.activity.result.contract.ActivityResultContracts
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tfluid.xdrive.core.AndroidUpdateClient
import com.tfluid.xdrive.core.UpdateSource
import com.tfluid.xdrive.core.ConnectionRoute
import com.tfluid.xdrive.core.RouteMode
import com.tfluid.xdrive.core.ConnectionRouteSelector
import androidx.core.content.edit

class MainActivity : ComponentActivity() {
    private val model by viewModels<DriveViewModel>()
    // SAF owns the destination; no broad storage permission or persistent URI grants.
    private val fileDestination = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri ->
        if (uri == null) model.controller.cancelFileExport()
        else model.controller.saveFileExport(
            openOutput = {
                contentResolver.openOutputStream(uri, "wt")
                    ?: throw IOException("Unable to open chosen document")
            },
            discardOutput = {
                try { contentResolver.delete(uri, null, null) }
                catch (_: Exception) { /* Best effort; never hide the source error. */ }
            },
        )
    }
    private val uploadSource = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) model.controller.cancelFileUploadPicker()
        else {
            var filename = ""
            var byteSize = -1L
            try {
                contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                    null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (nameIndex >= 0 && !cursor.isNull(nameIndex))
                            filename = cursor.getString(nameIndex).orEmpty()
                        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex))
                            byteSize = cursor.getLong(sizeIndex)
                    }
                }
            } catch (_: Exception) {
                // Invalid SAF provider metadata is rejected by the Controller.
            }
            model.controller.acceptFileUpload(filename, byteSize) {
                contentResolver.openInputStream(uri)
                    ?: throw IOException("Selected file is unavailable")
            }
        }
    }
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
                }, initialFilesView = model.initialFilesView, saveFilesView = model::saveFilesView,
                    onDownload = { node ->
                        if (model.controller.prepareFileExport(node)) {
                            try { fileDestination.launch(node.name) }
                            catch (_: Exception) { model.controller.cancelFileExport() }
                        }
                    },
                    onUpload = {
                        if (model.controller.prepareFileUpload()) {
                            try { uploadSource.launch(arrayOf("*/*")) }
                            catch (_: Exception) { model.controller.cancelFileUploadPicker() }
                        }
                    })
            }
        }
    }
}

class DriveViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("connection", Application.MODE_PRIVATE)
    private val updatePreferences = application.getSharedPreferences("updates", Application.MODE_PRIVATE)
    private val uiPreferences = application.getSharedPreferences("ui", Application.MODE_PRIVATE)
    val initialFilesView = FileViewMode.fromPreference(uiPreferences.getString("files.view", null))
    fun saveFilesView(value: FileViewMode) {
        uiPreferences.edit { putString("files.view", value.name) }
    }
    private val routeDns = deviceRouteDns(application.mainExecutor)
    private val routeSelector = ConnectionRouteSelector(resolve = routeDns::lookup)
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
        routeSelector = routeSelector::select,
        saveConnection = { server, allow -> preferences.edit { putString("server", server); putBoolean("allowHttp", allow) } },
        loadRoute = { origin -> ConnectionRoute(
            mode = RouteMode.fromPreference(preferences.getString("route.mode:$origin", null)),
            lanIp = preferences.getString("route.lan:$origin", "").orEmpty(),
            publicIp = preferences.getString("route.public:$origin", "").orEmpty(),
        ) },
        saveRoute = { origin, route -> preferences.edit {
            putString("route.mode:$origin", route.mode.name)
            putString("route.lan:$origin", route.lanIp)
            putString("route.public:$origin", route.publicIp)
        } },
        sessionPersistence = AndroidSessionStore(application),
    )
    init { controller.restoreSession() }
    override fun onCleared() { updates.close(); controller.close() }
}
