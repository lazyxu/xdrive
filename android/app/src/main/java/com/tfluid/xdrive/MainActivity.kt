package com.tfluid.xdrive

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.ContentResolver
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.widget.Toast
import android.os.Bundle
import java.io.IOException
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContract
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

/** A single Android document picker whose MIME follows the verified file extension.
 * SAF grant and choice stay with the OS. Reject non-document URI schemes.
 */
internal data class NativeExportDocument(val fileName: String, val mimeType: String)

internal class NativeCreateDocument : ActivityResultContract<NativeExportDocument, Uri?>() {
    override fun createIntent(context: Context, input: NativeExportDocument): Intent =
        Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = input.mimeType
            putExtra(Intent.EXTRA_TITLE, input.fileName)
        }

    override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
        if (resultCode == Activity.RESULT_OK) intent?.data?.takeIf { it.scheme == "content" }
        else null
}

class MainActivity : ComponentActivity() {
    private val model by viewModels<DriveViewModel>()
    // Transient Activity memory only: never saved to Bundle, prefs, URI grant
    // history or an Owner-unscoped task queue. Cold restarts cannot auto-upload.
    private var sharedFile by mutableStateOf<NativeIncomingShare?>(null)
    private var shareBusy by mutableStateOf(false)
    private var shareError by mutableStateOf<String?>(null)
    // A SAF result is usable only by the exact picker that launched it, not
    // another session that happened to re-open the same visible folder.
    private var pendingUploadPicker: NativeSafUploadTicket? = null
    private var pendingExportPicker: NativeSafExportTicket? = null

    /** ACTION_CREATE_DOCUMENT can reserve a new empty document before an
     * old Owner/Activity picker result is rejected. Delete only that returned
     * content URI; never open bytes or touch a new Owner's pending export. */
    private fun discardStaleExportDestination(uri: Uri?) {
        if (uri?.scheme != ContentResolver.SCHEME_CONTENT ||
            uri.authority.isNullOrBlank()) return
        try { contentResolver.delete(uri, null, null) }
        catch (_: Exception) { /* OS/provider may revoke the grant. */ }
    }

    private fun dismissIncomingShare() {
        if (shareBusy) return
        sharedFile = null
        shareError = null
    }

    private fun receiveIncomingShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        if (shareBusy) return
        val uri = nativeSingleShareCandidate(intent)
        if (uri == null) {
            Toast.makeText(this, "只支持有读取授权的单个共享文件。", Toast.LENGTH_LONG).show()
            sharedFile = null
            return
        }
        val state = model.controller.state.value
        val owner = if (state.username.isNotBlank() && state.server.isNotBlank())
            ShareOwnerIdentity(state.server, state.username) else null
        sharedFile = NativeIncomingShare(uri, owner)
        shareError = null
    }

    private fun confirmIncomingShare(target: NativeShareTarget) {
        val share = sharedFile ?: return
        val exactOwnerView = model.controller.state.value
        if (shareBusy || share.sourceOwner != null &&
            share.sourceOwner != target.identity ||
            nativeShareTarget(exactOwnerView) != target) return
        shareBusy = true
        shareError = null
        lifecycleScope.launch {
            val metadata = withContext(Dispatchers.IO) {
                queryNativeShareMetadata(applicationContext.contentResolver, share.uri)
            }
            if (sharedFile !== share) {
                shareBusy = false
                return@launch
            }
            // Recheck both actual Owner and the exact verified directory after
            // asynchronous provider metadata. Never replay a stale Picker ACK.
            val liveState = model.controller.state.value
            val live = nativeShareTarget(liveState)
            // A new DriveState object means Owner/path/authorization may have
            // changed while an untrusted provider answered. Reject even an
            // A -> B -> A login or folder hop with the same visible IDs.
            if (liveState !== exactOwnerView || live != target ||
                share.sourceOwner != null &&
                share.sourceOwner != live.identity) {
                shareBusy = false
                sharedFile = null
                return@launch
            }
            if (metadata == null) {
                shareBusy = false
                shareError = "共享来源没有提供有效文件名或准确大小。请在文件页使用上传。"
                return@launch
            }
            val controller = model.controller
            if (!controller.prepareFileUpload()) {
                shareBusy = false
                shareError = "当前目录不可上传，请结束其他操作后重试。"
                return@launch
            }
            // Explicit single user confirmation accepted. The existing
            // Controller will recheck Owner + parent before any UploadSession.
            sharedFile = null
            shareBusy = false
            val resolver = applicationContext.contentResolver
            controller.acceptFileUpload(metadata.name, metadata.byteSize) {
                resolver.openInputStream(share.uri)
                    ?: throw IOException("The shared source is unavailable")
            }
        }
    }

    // SAF owns the destination; no broad storage permission or persistent URI grants.
    private val fileDestination = registerForActivityResult(
        NativeCreateDocument()
    ) { uri ->
        val controller = model.controller
        val ticket = pendingExportPicker
        pendingExportPicker = null
        // The OS result itself does not carry the original Owner or Node.
        // Even A->B->A re-login / folder round-trip must fail closed.
        if (ticket == null || !ticket.isCurrent(controller.state.value)) {
            discardStaleExportDestination(uri)
            if (ticket != null) controller.cancelFileExport()
        } else if (uri == null || uri.scheme != ContentResolver.SCHEME_CONTENT ||
            uri.authority.isNullOrBlank()) {
            discardStaleExportDestination(uri)
            controller.cancelFileExport()
        } else {
            controller.saveFileExport(
                openOutput = {
                    contentResolver.openOutputStream(uri, "wt")
                        ?: throw IOException("Unable to open chosen document")
                },
                discardOutput = {
                    // Already authorized single destination only. A failed
                    // final output or checksum must not leave a partial file.
                    discardStaleExportDestination(uri)
                },
            )
        }
    }
    private val uploadSource = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val controller = model.controller
        val ticket = pendingUploadPicker
        pendingUploadPicker = null
        // The OS may deliver a late chooser result after account/folder
        // replacement. Do not clear the *new* Owner's picker or consume bytes.
        if (ticket != null && ticket.isCurrent(controller.state.value)) {
            if (uri == null || uri.scheme != ContentResolver.SCHEME_CONTENT ||
                uri.authority.isNullOrBlank()) {
                controller.cancelFileUploadPicker()
            } else {
                lifecycleScope.launch {
                    // Content providers are untrusted IPC, potentially slow or
                    // blocking. NEVER query their metadata on the main thread.
                    // This shared helper reads only name/size; no file bytes.
                    val metadata = withContext(Dispatchers.IO) {
                        queryNativeShareMetadata(applicationContext.contentResolver, uri)
                    }
                    // Explicitly defend A→B→A Owner/folder replay while the
                    // provider was responding; even identical path IDs are not
                    // sufficient without the original immutable state object.
                    if (!ticket.isCurrent(controller.state.value)) return@launch
                    if (metadata == null) {
                        // Existing Controller handles the safe failure message.
                        // Invalid provider data must never start UploadSession.
                        controller.acceptFileUpload("", -1L) {
                            throw IOException("Invalid SAF source metadata")
                        }
                    } else {
                        controller.acceptFileUpload(metadata.name, metadata.byteSize) {
                            contentResolver.openInputStream(uri)
                                ?: throw IOException("Selected file is unavailable")
                        }
                    }
                }
            }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // This Activity cannot reconstruct a same-intent SAF ticket after an
        // OS recreation. Do not strand the Controller's picker flag or silently
        // accept a result whose original Owner session is no longer provable.
        // Existing active uploads/downloads are unaffected.
        if (savedInstanceState != null) {
            if (model.controller.state.value.fileUploadPickerParent != null)
                model.controller.cancelFileUploadPicker()
            // ActivityResultRegistry may redeliver an old CreateDocument
            // result after recreation, but our in-memory exact ticket is
            // intentionally never restored; clear its old pending intent.
            if (model.controller.state.value.fileExportPending != null)
                model.controller.cancelFileExport()
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent {
            XDriveTheme {
                val driveState by model.controller.state.collectAsStateWithLifecycle()
                // The app remains interactive while login/navigation is
                // required; the review dialog appears only for a real folder.
                Box(Modifier.fillMaxSize()) {
                    DriveApp(model.controller, model.updates, openUpdate = { url ->
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
                            true
                        } catch (_: ActivityNotFoundException) { false }
                        catch (_: SecurityException) { false }
                    }, initialFilesView = model.initialFilesView, saveFilesView = model::saveFilesView,
                        onDownload = { node ->
                            // Never overlap two OS CreateDocument launches.
                            // This prevents a late earlier picker ACK from
                            // being mistaken for another Owner's new download.
                            if (pendingExportPicker == null &&
                                model.controller.prepareFileExport(node)) {
                                val ticket = NativeSafExportTicket.capture(
                                    model.controller.state.value)
                                if (ticket == null) {
                                    model.controller.cancelFileExport()
                                } else {
                                    try {
                                        pendingExportPicker = ticket
                                        fileDestination.launch(NativeExportDocument(
                                            node.name, exportMimeType(node.name)))
                                    } catch (_: Exception) {
                                        pendingExportPicker = null
                                        if (ticket.isCurrent(model.controller.state.value))
                                            model.controller.cancelFileExport()
                                    }
                                }
                            }
                        },
                        onUpload = {
                            if (pendingUploadPicker == null &&
                                model.controller.prepareFileUpload()) {
                                val ticket = NativeSafUploadTicket.capture(
                                    model.controller.state.value)
                                if (ticket == null) {
                                    model.controller.cancelFileUploadPicker()
                                } else {
                                    try {
                                        pendingUploadPicker = ticket
                                        uploadSource.launch(arrayOf("*/*"))
                                    } catch (_: Exception) {
                                        pendingUploadPicker = null
                                        if (ticket.isCurrent(model.controller.state.value))
                                            model.controller.cancelFileUploadPicker()
                                    }
                                }
                            }
                        })
                    val incoming = sharedFile
                    if (incoming != null) {
                        // A logout/server switch invalidates a bound source grant.
                        androidx.compose.runtime.LaunchedEffect(
                            driveState.screen, driveState.server, driveState.username,
                        ) {
                            if (incoming.sourceOwner != null &&
                                (incoming.sourceOwner != ShareOwnerIdentity(
                                    driveState.server, driveState.username) ||
                                    driveState.screen == Screen.LOGIN ||
                                    driveState.screen == Screen.CONNECT ||
                                    driveState.screen == Screen.PASSWORD)) {
                                sharedFile = null
                                shareError = null
                            }
                        }
                        NativeShareReview(incoming, driveState, shareBusy, shareError,
                            onDismiss = ::dismissIncomingShare,
                            onConfirm = ::confirmIncomingShare)
                    }
                }
            }
        }
        // Never replay an Intent on Activity recreation. OS grants and source
        // metadata are intentionally not saved for process resurrection.
        if (savedInstanceState == null) receiveIncomingShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveIncomingShare(intent)
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
