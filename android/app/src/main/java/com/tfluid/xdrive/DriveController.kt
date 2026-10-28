package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

enum class Screen { CONNECT, LOGIN, PASSWORD, FILES, GALLERY, TRASH }
enum class FilesSection { RECENT, BROWSE, FAVORITES, SEARCH }
enum class FilesTransferKind { COPY, MOVE }
enum class GalleryPrimaryTab { LIBRARY, COLLECTIONS }

data class DriveState(
    val screen: Screen = Screen.CONNECT,
    val server: String = "",
    val allowHttp: Boolean = false,
    val route: ConnectionRoute = ConnectionRoute(),
    val connectionIp: String? = null,
    val username: String = "",
    val loading: Boolean = false,
    /** True only for an explicitly cancellable Owner GET, not writes or SAF. */
    val discardableReadInFlight: Boolean = false,
    val error: String? = null,
    val path: List<DriveNode> = emptyList(),
    val items: List<DriveNode> = emptyList(),
    val offset: Int = 0,
    val totalCount: Long = 0,
    val loaded: Boolean = false,
    /** First absolute page in the visible directory window. */
    val browseWindowStart: Int = 0,
    /** Focus after Show in Folder, distinct from multi-select edit mode. */
    val focusedBrowseNodeId: Long? = null,
    val focusedBrowseIndex: Int = 0,
    val focusedBrowseEpoch: Long = 0,
    val selected: DriveNode? = null,
    /** No PDF bytes, disk path or credential in native UI state. */
    val filesPdfViewer: DriveNode? = null,
    val filesPdfBytes: Long = 0,
    /** Owner-private foreground audio session; never persists URL or tokens. */
    val filesAudioViewer: DriveNode? = null,
    /** Private in-memory text is scoped to one visible Owner file and one detail dialog. */
    val fileTextPreview: FileTextPreview? = null,
    val fileTextPreviewLoading: Boolean = false,
    val fileTextPreviewError: String? = null,
    val filesSection: FilesSection = FilesSection.BROWSE,
    /** Current login's full Owner range order, never reorder a sparse client page. */
    val filesArrangement: FileBrowseArrangement = FileBrowseArrangement(),
    /** Genuine Owner group index for the directory's full logical range. */
    val filesGroups: List<FileBrowseGroupIndex> = emptyList(),
    val collectionItems: List<DriveCollectionItem> = emptyList(),
    val collectionLoaded: Boolean = false,
    val searchQuery: String = "",
    val searchNextCursor: String = "",
    val searchReturnSection: FilesSection = FilesSection.BROWSE,
    val browseSelectionMode: Boolean = false,
    val browseSelectedIds: Set<Long> = emptySet(),
    val browseBatchWriteAttempted: Boolean = false,
    // Export URI and tokens are never put into state or preferences.
    val fileExportPending: DriveNode? = null,
    val fileExportOrigin: Screen? = null, // Picker origin prevents Files/Gallery cross-surface replay.
    val fileDownloadActive: Boolean = false,
    val fileDownloadSaved: Boolean = false,
    val fileDownloadError: String? = null,
    val fileDownloadBytes: Long = 0,
    val fileDownloadTotal: Long = 0,
    val fileUploadPickerParent: Long? = null,
    val fileUploadActive: Boolean = false,
    val fileUploadCommitted: Boolean = false,
    val fileUploadBytes: Long = 0,
    val fileUploadTotal: Long = 0,
    /** Last 20 verified SAF transfers, held only for the active login session. */
    val nativeTransfers: List<NativeTransferEntry> = emptyList(),
    val trashItems: List<TrashEntry> = emptyList(),
    val trashTotal: Long = 0,
    val trashLoaded: Boolean = false,
    /** Lost restore ACK freezes further writes until a successful authenticated GET. */
    val trashRestoreAttempted: Boolean = false,
    val galleryPrimaryTab: GalleryPrimaryTab = GalleryPrimaryTab.LIBRARY,
    val galleryAlbums: List<GalleryAlbum> = emptyList(),
    val galleryAlbumsLoaded: Boolean = false,
    /** A possibly committed collection create POST must be reconciled by GET. */
    val galleryAlbumCreateAttempted: Boolean = false,
    /** POST ACK was valid; list GET may be retried, never the POST. */
    val galleryAlbumCreateCommittedNeedsRefresh: Boolean = false,
    /** A rename/delete ACK may be lost; prevent other album writes until GET. */
    val galleryAlbumEditAttempted: Boolean = false,
    /** Mutation ACK valid, but Owner list GET may fail. Never repeat the write. */
    val galleryAlbumEditCommittedNeedsRefresh: Boolean = false,
    val gallerySelectedAlbum: GalleryAlbum? = null,
    val galleryMapOpen: Boolean = false,
    val galleryMapLoaded: Boolean = false,
    val galleryMapOverview: OwnerMapOverview? = null,
    /** Explicitly requested verified BD09LL Owner cells; never raw WGS84. */
    val galleryBd09Requested: Boolean = false,
    val galleryBd09Cells: OwnerBd09MapCells? = null,
    val galleryItems: List<GalleryAsset> = emptyList(),
    val galleryOffset: Int = 0,
    val galleryTotal: Long = 0,
    val galleryLoaded: Boolean = false,
    val gallerySearchQuery: String = "",
    val galleryMediaKind: String = "",
    val gallerySortBy: String = "captured",
    val gallerySortDir: String = "asc",
    val galleryTimelineSets: GalleryTimelineSets? = null,
    val galleryJumpIndex: Int? = null,
    val galleryJumpEpoch: Long = 0,
    val galleryPageIntent: String = "",
    val gallerySelected: GalleryAsset? = null,
    val galleryViewer: GalleryAsset? = null,
    /** Current Owner, verified loaded rows only; never persisted or query-wide. */
    val gallerySelectionMode: Boolean = false,
    val gallerySelectedItems: List<GalleryAsset> = emptyList(),
    /** Uncertain metadata ACK must be followed by GET, not another PATCH. */
    val galleryMetadataWriteAttempted: Boolean = false,
    /** A boundary lookup is independent of the current photo/Media3/Live stream. */
    val galleryViewerPageDirection: Int = 0,
    val galleryViewerPageBusy: Boolean = false,
    val galleryViewerPageError: String? = null,
    /** Scoped single real Owner file in existing Gallery Viewer; Back returns to Files. */
    val viewerReturnToFiles: Boolean = false,
    val destinationKind: FilesTransferKind? = null,
    val destinationSource: DriveNode? = null,
    /** Nonempty only for an atomic batch Copy/Move of 1–200 confirmed rows.
     * The legacy single-node picker continues to use destinationSource. */
    val destinationSources: List<DriveNode> = emptyList(),
    val destinationPath: List<DriveNode> = emptyList(),
    val destinationFolders: List<DriveNode> = emptyList(),
    val destinationOffset: Int = 0,
    val destinationTotal: Long = 0,
    val destinationLoaded: Boolean = false,
    val destinationSubmitting: Boolean = false,
    val destinationWriteAttempted: Boolean = false,
) {
    val hasNext get() = loaded && offset.toLong() + 100 < totalCount && offset <= Int.MAX_VALUE - 100
    val hasPrevious get() = loaded && browseWindowStart > 0
    val destinationHasNext get() = destinationLoaded &&
        destinationOffset.toLong() + 100 < destinationTotal &&
        destinationOffset <= Int.MAX_VALUE - 100
}

/** Page navigation yields only to obsolete GETs, never in-flight writes. */
internal fun DriveState.hasActiveNativeTransfer(): Boolean =
    fileUploadActive || fileDownloadActive

internal fun DriveState.canNavigateFiles(): Boolean =
    screen == Screen.FILES && (!loading || discardableReadInFlight) &&
        !hasActiveNativeTransfer() &&
        destinationKind == null && !browseBatchWriteAttempted

/** A lost batch DELETE ACK is resolved by a fresh GET, never by replaying DELETE. */
internal fun DriveState.canReconcileBatchBrowse(): Boolean =
    screen == Screen.FILES && filesSection == FilesSection.BROWSE &&
        browseBatchWriteAttempted && !loading && !hasActiveNativeTransfer() &&
        destinationKind == null

private fun DriveState.withoutGallerySelection(): DriveState = copy(
    gallerySelectionMode = false, gallerySelectedItems = emptyList(),
    galleryMetadataWriteAttempted = false,
)

private fun DriveState.withoutDestination(): DriveState = copy(
    destinationKind = null, destinationSource = null, destinationSources = emptyList(),
    destinationPath = emptyList(),
    destinationFolders = emptyList(), destinationOffset = 0, destinationTotal = 0,
    destinationLoaded = false, destinationSubmitting = false,
    destinationWriteAttempted = false,
)

/** One active intent; cancellation stops transport, generation also fences non-cooperative replies. */
class DriveController(
    private val scope: CoroutineScope,
    private val serviceFactory: (ServerAddress) -> XDriveService = { XDriveApi(it) },
    private val saveConnection: (String, Boolean) -> Unit = { _, _ -> },
    initialServer: String = "",
    initialAllowHttp: Boolean = false,
    private val routeSelector: suspend (ServerAddress, ConnectionRoute) -> String? = { address, route -> ConnectionRouteSelector().select(address, route) },
    private val routedServiceFactory: (ServerAddress, String) -> XDriveService = { address, ip -> XDriveApi(address, connectionIp = ip) },
    private val saveRoute: (String, ConnectionRoute) -> Unit = { _, _ -> },
    private val loadRoute: (String) -> ConnectionRoute = { ConnectionRoute() },
    private val sessionPersistence: DriveSessionPersistence? = null,
    private val transferClockMillis: () -> Long = { System.nanoTime() / 1_000_000L },
) : Closeable {
    private val mutableState = MutableStateFlow(DriveState(server = initialServer, allowHttp = initialAllowHttp,
        route = savedRoute(initialServer, initialAllowHttp)))
    val state = mutableState.asStateFlow()
    private var address: ServerAddress? = null
    private var api: XDriveService? = null
    private var session: AuthSession? = null // Never part of UI state or saved state.
    private var keepLogin = false
    private var generation = 0L
    private var active: Job? = null
    private val galleryThumbnailLimit = Semaphore(4)
    private var activeVideoPlayback: OwnerVideoPlayback? = null
    private var galleryViewerEpoch = 0L
    private var galleryViewerPageJob: Job? = null
    private var filesPdfEpoch = 0L
    private var audioViewerEpoch = 0L
    private var audioPlaybackRequestEpoch = 0L
    private var textPreviewEpoch = 0L
    private var textPreviewJob: Job? = null
    private var retryPath: List<DriveNode>? = null
    private var retryOffset = 0
    private var retryAppend = false
    private var retryPrepend = false
    private var nextNativeTransferId = 0L

    /** These records observe the existing Owner-authenticated SAF reader/writer.
     * They do not own an extra HTTP client, upload queue or independent retry. */
    private fun beginNativeTransfer(
        kind: NativeTransferKind, filename: String, totalBytes: Long,
    ): Long {
        val id = ++nextNativeTransferId
        val now = transferClockMillis()
        val item = NativeTransferEntry(id, kind, filename, totalBytes,
            startedAtMillis = now)
        mutableState.value = state.value.copy(
            nativeTransfers = state.value.nativeTransfers.withStartedTransfer(item))
        return id
    }

    private fun nativeTransferProgress(id: Long, bytes: Long) {
        val current = state.value
        if (current.nativeTransfers.none {
                it.id == id && it.status == NativeTransferStatus.RUNNING
            }) return
        val now = transferClockMillis()
        mutableState.value = current.copy(nativeTransfers =
            current.nativeTransfers.updateTransfer(id) {
                it.withConfirmedBytes(bytes, now)
            })
    }

    private fun finishNativeTransfer(
        id: Long, outcome: NativeTransferStatus, finalBytes: Long? = null,
    ) {
        val current = state.value
        if (current.nativeTransfers.none {
                it.id == id && it.status == NativeTransferStatus.RUNNING
            }) return
        val now = transferClockMillis()
        mutableState.value = current.copy(nativeTransfers =
            current.nativeTransfers.updateTransfer(id) {
                it.finish(outcome, now, finalBytes)
            })
    }

    /** Unknown upload finalize ACK must not be represented as a safe retry. */
    private fun terminateNativeTransferOnCancellation() {
        val record = state.value.nativeTransfers.firstOrNull {
            it.status == NativeTransferStatus.RUNNING
        } ?: return
        val outcome = if (record.kind == NativeTransferKind.UPLOAD)
            NativeTransferStatus.UNCONFIRMED else NativeTransferStatus.CANCELLED
        finishNativeTransfer(record.id, outcome)
    }

    fun clearNativeTransferHistory() {
        val current = state.value
        mutableState.value = current.copy(nativeTransfers =
            current.nativeTransfers.filter { it.status == NativeTransferStatus.RUNNING })
    }

    fun savedRoute(input: String, allowHttp: Boolean = false): ConnectionRoute = try {
        loadRoute(ServerAddress.parse(input, allowHttp).url)
    } catch (_: IllegalArgumentException) { ConnectionRoute() }

    fun connect(input: String, allowHttp: Boolean, route: ConnectionRoute = ConnectionRoute()) {
        if (state.value.screen != Screen.CONNECT) return
        try {
            val next = ServerAddress.parse(input, allowHttp)
            route.validate(next)
            invalidate()
            (api as? Closeable)?.close()
            api = null
            address = null
            mutableState.value = DriveState(server = next.url, allowHttp = allowHttp, route = route)
            if (!route.enabled) install(next, allowHttp, route, null)
            else request { ticket ->
                val ip = routeSelector(next, route) ?: throw ApiException(0, "Unable to select route", ApiFailureReason.CONNECTION)
                checkCurrent(ticket)
                install(next, allowHttp, route, ip)
            }
        } catch (_: IllegalArgumentException) {
            mutableState.value = state.value.copy(error = "服务器地址或内网 IP 配置无效。请检查完整服务器 URL；可选内网 IP 须为私有地址，不能与 IP 形式的服务器地址同时配置。")
        }
    }

    private fun install(next: ServerAddress, allowHttp: Boolean, route: ConnectionRoute, ip: String?) {
        api = if (ip == null) serviceFactory(next) else routedServiceFactory(next, ip)
        address = next
        saveConnection(next.url, allowHttp)
        saveRoute(next.url, route)
        mutableState.value = DriveState(screen = Screen.LOGIN, server = next.url, allowHttp = allowHttp, route = route, connectionIp = ip)
    }

    private fun persistRefreshSession() {
        val stored = sessionPersistence ?: return
        val current = session ?: return
        try {
            if (keepLogin && state.value.server.startsWith("https://")) stored.save(state.value.server, current)
            else stored.clear()
        } catch (_: Exception) {
            // Never continue claiming a durable login when refresh rotation could not be committed.
            runCatching { stored.clear() }
        }
    }

    /**
     * On cold start, authenticate the same saved Server and Owner with one refresh.
     * Connectivity failure keeps the encrypted credential for a later retry.
     * Invalid/revoked credentials are discarded and return to manual login.
     */
    fun restoreSession() {
        val vault = sessionPersistence ?: return
        if (state.value.screen != Screen.CONNECT || state.value.loading) return
        request { ticket ->
            val saved = try { vault.load() } catch (_: Exception) { null } ?: return@request
            checkCurrent(ticket)
            val server = try { ServerAddress.parse(saved.server) } catch (_: Exception) {
                runCatching { vault.clear() }
                return@request
            }
            val originalRoute = loadRoute(server.url)
            val route = ConnectionRoute(lanIp = originalRoute.lanIp)
            var candidate: XDriveService? = null
            try {
                route.validate(server)
                val ip = if (route.enabled) routeSelector(server, route) else null
                checkCurrent(ticket)
                val restoredApi = if (ip == null) serviceFactory(server) else routedServiceFactory(server, ip)
                candidate = restoredApi
                val restored = restoredApi.refresh(saved.refreshToken)
                checkCurrent(ticket)
                if (restored.username != saved.username) throw ApiException(401, "Owner mismatch")
                api = restoredApi
                address = server
                session = restored
                keepLogin = true
                mutableState.value = DriveState(
                    screen = if (restored.mustChangePassword) Screen.PASSWORD else Screen.FILES,
                    server = server.url, route = route, connectionIp = ip, username = restored.username,
                )
                persistRefreshSession()
                // A valid refreshed session survives a later transient directory read error.
                // Let request() report it without turning a network outage into logout.
                if (!restored.mustChangePassword) {
                    try { loadWithin(restoredApi, emptyList(), 0, ticket) }
                    catch (failure: Exception) {
                        if (failure is ApiException && failure.statusCode == 401) throw failure
                        if (failure is CancellationException) throw failure
                        mutableState.value = state.value.copy(error = safeError(failure))
                    }
                }
            } catch (cancelled: CancellationException) {
                if (candidate !== api) (candidate as? Closeable)?.close()
                throw cancelled
            } catch (failure: Exception) {
                if (candidate === api) {
                    session = null
                    api = null
                }
                (candidate as? Closeable)?.close()
                if (failure is ApiException && failure.statusCode in listOf(401, 403)) {
                    runCatching { vault.clear() }
                    mutableState.value = DriveState(screen = Screen.LOGIN, server = server.url,
                        route = route, username = saved.username,
                        error = "登录已失效，请重新输入密码。")
                } else {
                    // Network outage is NOT logout; preserve the refresh token on disk.
                    mutableState.value = DriveState(screen = Screen.CONNECT, server = server.url,
                        route = route, username = saved.username,
                        error = "无法自动恢复登录，请检查网络或直接登录。")
                }
            }
        }
    }

    /** One-page native login. Never persist or route credentials until HTTPS identity checks finish. */
    fun connectAndLogin(
        serverInput: String, allowHttp: Boolean, lanIp: String,
        username: String, password: String, rememberSession: Boolean,
    ) {
        if (state.value.screen !in listOf(Screen.CONNECT, Screen.LOGIN) || state.value.loading) return
        if (username.isBlank() || password.isEmpty()) {
            mutableState.value = state.value.copy(error = "请输入用户名和密码。")
            return
        }
        val next = try { ServerAddress.parse(serverInput, allowHttp) } catch (_: IllegalArgumentException) {
            mutableState.value = state.value.copy(error = "请输入完整有效的 HTTPS 服务器地址。")
            return
        }
        val route = ConnectionRoute(lanIp = lanIp.trim())
        try { route.validate(next) } catch (_: IllegalArgumentException) {
            mutableState.value = state.value.copy(error = "内网 IP 无效，或服务器已直接使用 IP 地址。")
            return
        }
        request { ticket ->
            val ip = if (route.enabled) routeSelector(next, route) else null
            checkCurrent(ticket)
            val candidate = if (ip == null) serviceFactory(next) else routedServiceFactory(next, ip)
            try {
                val result = candidate.login(username.trim(), password)
                checkCurrent(ticket)
                val oldApi = api
                api = candidate
                address = next
                session = result
                keepLogin = rememberSession && next.url.startsWith("https://")
                saveConnection(next.url, allowHttp)
                saveRoute(next.url, route)
                mutableState.value = DriveState(
                    screen = if (result.mustChangePassword) Screen.PASSWORD else Screen.FILES,
                    server = next.url, allowHttp = allowHttp, route = route, connectionIp = ip,
                    username = result.username,
                )
                persistRefreshSession()
                if (oldApi !== candidate) (oldApi as? Closeable)?.close()
                if (!result.mustChangePassword) loadWithin(candidate, emptyList(), 0, ticket)
            } finally {
                if (api !== candidate) (candidate as? Closeable)?.close()
            }
        }
    }

    fun login(username: String, password: String) = loginWithPreference(username, password, true)

    fun loginWithPreference(username: String, password: String, rememberSession: Boolean) {
        if (state.value.screen != Screen.LOGIN || state.value.loading) return
        if (username.isBlank() || password.isEmpty()) {
            mutableState.value = state.value.copy(error = "请输入用户名和密码。")
            return
        }
        request {
            if (api == null && state.value.route.enabled) {
                val next = address ?: return@request
                val ip = routeSelector(next, state.value.route) ?: throw ApiException(0, "Unable to select route", ApiFailureReason.CONNECTION)
                checkCurrent(it)
                api = routedServiceFactory(next, ip)
                mutableState.value = state.value.copy(connectionIp = ip)
            }
            val service = api ?: return@request
            val result = service.login(username.trim(), password)
            checkCurrent(it)
            session = result
            keepLogin = rememberSession && state.value.server.startsWith("https://")
            mutableState.value = state.value.copy(
                screen = if (result.mustChangePassword) Screen.PASSWORD else Screen.FILES,
                username = result.username,
            )
            persistRefreshSession()
            if (!result.mustChangePassword) loadWithin(service, emptyList(), 0, it)
        }
    }

    fun changePassword(current: String, replacement: String) {
        if (state.value.screen != Screen.PASSWORD || state.value.loading) return
        if (current.isEmpty() || replacement.isEmpty()) {
            mutableState.value = state.value.copy(error = "请输入当前密码和新密码。")
            return
        }
        val service = api ?: return
        request { ticket ->
            val result = authenticated(service, ticket, allowPasswordChange = true) {
                service.changePassword(it, current, replacement)
            }
            checkCurrent(ticket)
            session = result
            persistRefreshSession()
            mutableState.value = state.value.copy(screen = if (result.mustChangePassword) Screen.PASSWORD else Screen.FILES)
            if (!result.mustChangePassword) loadWithin(service, emptyList(), 0, ticket)
        }
    }

    fun open(node: DriveNode) {
        if (!state.value.canNavigateFiles() || state.value.filesSection != FilesSection.BROWSE ||
            state.value.browseSelectionMode ||
            state.value.filesPdfViewer != null || state.value.filesAudioViewer != null ||
            state.value.items.none { it == node }) return
        if (node.isDirectory) load(state.value.path + node, 0)
        else if (fileKind(node.name, false) in setOf("image", "video") &&
            node.revision > 0 && node.size > 0) openFilesMedia(node)
        else if (fileKind(node.name, false) == "pdf" &&
            node.revision > 0 && node.size > 0) openFilesPdf(node)
        else if (fileKind(node.name, false) == "audio" &&
            node.revision > 0 && node.size > 0) openFilesAudio(node)
        else showDetails(node)
    }

    /** No synthetic Gallery Range is queried. A singleton presentation adapter
     * lets all existing secure image/video/Live Viewers keep their contracts. */
    private fun filesNodeVisible(current: DriveState, node: DriveNode): Boolean {
        if (current.screen != Screen.FILES || node.id <= 0 ||
            node.revision <= 0 || node.type != "file" ||
            node.size <= 0 || current.destinationKind != null) return false
        return if (current.filesSection == FilesSection.BROWSE)
            current.loaded && current.items.any { it == node }
        else current.collectionLoaded && current.collectionItems.any { it.node == node }
    }

    /** Enter one current Owner PDF without changing loaded Files rows/viewport. */
    private fun openFilesPdf(node: DriveNode) {
        val current = state.value
        if (!filesNodeVisible(current, node) || !current.canNavigateFiles() ||
            current.browseSelectionMode || current.filesPdfViewer != null ||
            current.filesAudioViewer != null ||
            fileKind(node.name, false) != "pdf" || session == null || api == null) return
        if (current.discardableReadInFlight) invalidate()
        filesPdfEpoch++
        mutableState.value = state.value.copy(filesPdfViewer = node,
            loading = false, discardableReadInFlight = false,
            filesPdfBytes = 0, selected = null, error = null)
    }

    fun dismissFilesPdfViewer() {
        if (state.value.filesPdfViewer == null) return
        filesPdfEpoch++
        mutableState.value = state.value.copy(filesPdfViewer = null, filesPdfBytes = 0)
    }

    /** Caller creates and deletes its private seekable temporary file. A
     * subsequent logout, refresh, navigation or app switch fences all results. */
    suspend fun downloadFilesPdf(node: DriveNode, output: () -> OutputStream): Long {
        val ticket = generation
        val epoch = filesPdfEpoch
        val current = state.value
        val service = api ?: throw CancellationException()
        if (current.filesPdfViewer != node || !filesNodeVisible(current, node) ||
            fileKind(node.name, false) != "pdf" || session == null)
            throw CancellationException()
        if (node.size !in 1L..(64L * 1024 * 1024))
            throw ApiException(413, "PDF exceeds native preview limit")
        try {
            val count = authenticated(service, ticket) { token ->
                service.filesPdfDownload(token, node, output) { received ->
                    if (ticket == generation && filesPdfEpoch == epoch &&
                        state.value.filesPdfViewer == node &&
                        filesNodeVisible(state.value, node)) {
                        mutableState.value = state.value.copy(
                            filesPdfBytes = received.coerceIn(0L, node.size))
                    }
                }
            }
            checkCurrent(ticket)
            if (filesPdfEpoch != epoch || state.value.filesPdfViewer != node ||
                !filesNodeVisible(state.value, node)) throw CancellationException()
            if (count != node.size)
                throw ApiException(0, "Incomplete PDF", ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = state.value.copy(filesPdfBytes = count)
            return count
        } catch (failure: ApiException) {
            if (failure.statusCode == 401 && ticket == generation &&
                filesPdfEpoch == epoch && state.value.filesPdfViewer == node)
                endSession(changeServer = false)
            throw failure
        }
    }

    /** Audio uses current Files' verified row and only one foreground player.
     * No second media transport or local media bytes. */
    private fun openFilesAudio(node: DriveNode) {
        val current = state.value
        if (!filesNodeVisible(current, node) || !current.canNavigateFiles() ||
            current.browseSelectionMode || current.filesAudioViewer != null ||
            current.filesPdfViewer != null ||
            fileKind(node.name, false) != "audio" || session == null ||
            api == null) return
        if (current.discardableReadInFlight) invalidate()
        audioViewerEpoch++
        mutableState.value = state.value.copy(filesAudioViewer = node, error = null,
            loading = false, discardableReadInFlight = false,
            selected = null, fileTextPreview = null, fileTextPreviewError = null)
    }

    /** Async re-verification runs on the caller's Compose effect and is fenced
     * against logout, Files navigation, A→B→A and late/noncooperative replies.
     * A verified source is tracked by the existing active media resource owner. */
    suspend fun openFilesAudioPlayback(node: DriveNode): OwnerVideoPlayback? {
        val current = state.value
        if (current.filesAudioViewer != node || !filesNodeVisible(current, node) ||
            fileKind(node.name, false) != "audio" || session == null) return null
        val ticket = generation
        val epoch = audioViewerEpoch
        // A manual retry may overlap a noncooperative older GET for the same
        // Node/Owner/revision. Only the most recently requested stream wins.
        val requestEpoch = ++audioPlaybackRequestEpoch
        val service = api ?: return null
        var resource: OwnerVideoPlayback? = null
        try {
            resource = authenticated(service, ticket) { token ->
                service.filesAudioPlayback(token, node)
            }
            checkCurrent(ticket)
            if (epoch != audioViewerEpoch ||
                requestEpoch != audioPlaybackRequestEpoch ||
                state.value.filesAudioViewer != node ||
                !filesNodeVisible(state.value, node)) throw CancellationException()
            closeActiveVideoPlayback()
            activeVideoPlayback = resource
            return resource
        } catch (failure: Throwable) {
            resource?.close()
            throw failure
        }
    }

    /** Keep the loaded Files section and scroll position. Disposing the
     * player also closes its pinned HTTP session (close is idempotent). */
    fun dismissFilesAudioViewer() {
        if (state.value.filesAudioViewer == null) return
        audioViewerEpoch++
        audioPlaybackRequestEpoch++
        closeActiveVideoPlayback()
        mutableState.value = state.value.copy(filesAudioViewer = null)
    }

    private fun openFilesMedia(node: DriveNode) {
        val current = state.value
        if (!filesNodeVisible(current, node) || !current.canNavigateFiles() ||
            current.browseSelectionMode ||
            current.filesAudioViewer != null || current.filesPdfViewer != null ||
            session == null ||
            fileKind(node.name, false) !in setOf("image", "video")) return
        val service = api ?: return
        // Owner-only media detail is a disposable GET. A second tapped file
        // must retire an obsolete A request (including A→B→A races).
        request(discardableRead = true) { ticket ->
            val media = authenticated(service, ticket) { token ->
                service.filesMediaItem(token, node)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (!filesNodeVisible(latest, node) || latest.galleryViewer != null)
                throw CancellationException()
            if (media.node != node || media.mediaKind !in setOf("image", "video"))
                throw ApiException(0, "Files media identity changed",
                    ApiFailureReason.INVALID_RESPONSE)
            closeActiveVideoPlayback()
            galleryViewerEpoch++
            mutableState.value = latest.copy(
                screen = Screen.GALLERY, viewerReturnToFiles = true,
                galleryPrimaryTab = GalleryPrimaryTab.LIBRARY,
                galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                gallerySelectedAlbum = null, galleryItems = listOf(media),
                galleryOffset = 0, galleryTotal = 1, galleryLoaded = true,
                gallerySearchQuery = "", galleryMediaKind = "",
                galleryTimelineSets = null, galleryJumpIndex = null,
                galleryPageIntent = "", gallerySelected = null, galleryViewer = media)
        }
    }

    /** Long-press details may include folders; never use a stale/foreign row. */
    fun showDetails(node: DriveNode) {
        val current = state.value
        if (!current.canNavigateFiles() ||
            current.filesPdfViewer != null || current.filesAudioViewer != null) return
        val visible = if (current.filesSection == FilesSection.BROWSE) current.items.any { it == node }
            else current.collectionItems.any { it.node == node }
        if (!visible) return
        // The details surface belongs to the current UI generation, not a late append.
        if (state.value.discardableReadInFlight) {
            invalidate()
            mutableState.value = state.value.copy(loading = false, discardableReadInFlight = false)
        }
        stopTextPreview()
        mutableState.value = state.value.copy(selected = node,
            fileTextPreview = null, fileTextPreviewLoading = false, fileTextPreviewError = null)
        if (!node.isDirectory && node.revision > 0 && nativeTextPreviewCandidate(node.name))
            retryTextPreview()
    }

    private fun stopTextPreview() {
        textPreviewEpoch++
        textPreviewJob?.cancel()
        textPreviewJob = null
    }

    fun dismissDetails() {
        stopTextPreview()
        mutableState.value = state.value.copy(selected = null,
            fileTextPreview = null, fileTextPreviewLoading = false, fileTextPreviewError = null)
    }

    /** Read the existing Go 1 MiB endpoint without entering the global
     * mutation/paging request queue. Independent cancellation and generation
     * checks prevent an A->B->A private-text replay. */
    fun retryTextPreview() {
        val current = state.value
        val node = current.selected ?: return
        if (current.screen != Screen.FILES || current.destinationKind != null ||
            node.isDirectory || node.revision <= 0 || !nativeTextPreviewCandidate(node.name) ||
            session == null || current.fileTextPreviewLoading) return
        val service = api ?: return
        stopTextPreview()
        val previewTicket = textPreviewEpoch
        val ownerTicket = generation
        mutableState.value = current.copy(fileTextPreview = null,
            fileTextPreviewLoading = true, fileTextPreviewError = null)
        textPreviewJob = scope.launch {
            try {
                val preview = authenticated(service, ownerTicket) {
                    service.textFilePreview(it, node)
                }
                checkCurrent(ownerTicket)
                val latest = state.value
                if (textPreviewEpoch == previewTicket && latest.screen == Screen.FILES &&
                    latest.selected == node) {
                    mutableState.value = latest.copy(fileTextPreview = preview,
                        fileTextPreviewLoading = false, fileTextPreviewError = null)
                }
            } catch (_: CancellationException) {
                // Dismiss/Owner navigation cancels the actual read and its UI.
            } catch (failure: Exception) {
                val latest = state.value
                if (ownerTicket != generation || textPreviewEpoch != previewTicket ||
                    latest.screen != Screen.FILES || latest.selected != node) return@launch
                if (failure is ApiException && failure.statusCode == 401) {
                    endSession(changeServer = false)
                    return@launch
                }
                val message = when ((failure as? ApiException)?.statusCode) {
                    415 -> "当前文件不是可预览的 UTF-8 文本。"
                    404, 412 -> "文件已变化或不存在，请刷新目录。"
                    else -> safeError(failure)
                }
                mutableState.value = latest.copy(fileTextPreview = null,
                    fileTextPreviewLoading = false, fileTextPreviewError = message)
            }
        }
    }

    /** Mutations only target the current Owner's confirmed browse directory;
     * never the Search/Recent collection, stale rows or the root itself. */
    private fun editableBrowseState(node: DriveNode? = null): DriveState? {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.loading || !current.loaded || current.path.isEmpty() || session == null) return null
        if (current.destinationKind != null || current.browseSelectionMode ||
            current.browseBatchWriteAttempted) return null
        if (node != null && (node.parentId != current.path.last().id ||
            node.revision <= 0 || current.items.none { it == node })) return null
        return current
    }

    /** SAF launches only after verifying the current authenticated Owner row.
     * A delayed picker return never authorizes an old node after navigation. */
    fun prepareFileExport(node: DriveNode): Boolean {
        val current = state.value
        val visibleOwnerRow = when (current.screen) {
            Screen.FILES -> editableBrowseState(node) != null
            Screen.GALLERY -> current.galleryLoaded && !current.loading &&
                current.gallerySelected?.node == node &&
                current.galleryItems.any { it.node == node } && session != null
            else -> false
        }
        if (!visibleOwnerRow || node.isDirectory || node.revision <= 0 || node.size < 0 ||
            current.fileExportPending != null || current.fileDownloadActive ||
            current.fileUploadActive || current.fileUploadPickerParent != null) return false
        mutableState.value = current.copy(
            fileExportPending = node, fileExportOrigin = current.screen,
            fileDownloadBytes = 0, fileDownloadTotal = node.size,
            fileDownloadSaved = false, fileDownloadError = null, error = null)
        return true
    }

    fun cancelFileExport() {
        if (state.value.fileDownloadActive) return
        mutableState.value = state.value.copy(fileExportPending = null, fileExportOrigin = null)
    }

    /** Caller owns the SAF URI; failure/cancellation must remove the partial document.
     * Download is read-only and never retries a request with an uncertain response. */
    fun saveFileExport(openOutput: () -> OutputStream, discardOutput: () -> Unit) {
        val current = state.value
        val node = current.fileExportPending
        // The OS picker may return after navigating to a different app, Range
        // or folder. Require the exact original surface and current Owner row.
        val verifiedSurface = when (current.fileExportOrigin) {
            Screen.FILES -> current.screen == Screen.FILES &&
                current.filesSection == FilesSection.BROWSE && current.loaded &&
                current.path.isNotEmpty() && node?.parentId == current.path.last().id &&
                current.items.any { it == node }
            Screen.GALLERY -> current.screen == Screen.GALLERY && current.galleryLoaded &&
                current.gallerySelected?.node == node &&
                current.galleryItems.any { it.node == node }
            else -> false
        }
        val valid = node != null && verifiedSurface &&
            !current.loading && !current.fileDownloadActive &&
            !current.fileUploadActive && current.destinationKind == null &&
            !node.isDirectory && node.revision > 0 && node.size >= 0 && session != null
        if (!valid) {
            discardOutput()
            if (!current.fileDownloadActive) mutableState.value = current.copy(fileExportPending = null, fileExportOrigin = null)
            return
        }
        val service = api ?: run {
            discardOutput()
            mutableState.value = current.copy(fileExportPending = null, fileExportOrigin = null)
            return
        }
        val owned = node!!
        mutableState.value = current.copy(
            fileExportPending = null, fileExportOrigin = null, fileDownloadActive = true,
            fileDownloadSaved = false, fileDownloadError = null,
            gallerySelected = if (current.screen == Screen.GALLERY) null else current.gallerySelected,
            fileDownloadBytes = 0, fileDownloadTotal = owned.size)
        request(isFileDownload = true) { ticket ->
            val transferId = beginNativeTransfer(NativeTransferKind.DOWNLOAD, owned.name, owned.size)
            var complete = false
            try {
                val written = authenticatedMutation(ticket) { token ->
                    service.downloadFile(token, owned, openOutput) { bytes ->
                        if (ticket == generation) {
                            mutableState.value = state.value.copy(fileDownloadBytes = bytes)
                            nativeTransferProgress(transferId, bytes)
                        }
                    }
                }
                checkCurrent(ticket)
                complete = true
                finishNativeTransfer(transferId, NativeTransferStatus.COMPLETED, written)
                mutableState.value = state.value.copy(
                    fileDownloadBytes = written, fileDownloadActive = false,
                    fileDownloadSaved = true, error = null)
            } finally {
                if (!complete) discardOutput()
                if (ticket == generation)
                    mutableState.value = state.value.copy(fileDownloadActive = false)
            }
        }
    }

    fun cancelFileDownload() {
        if (!state.value.fileDownloadActive) return
        invalidate() // Cancels the same OkHttp call; its finally removes partial SAF output.
        mutableState.value = state.value.copy(
            loading = false, fileDownloadActive = false,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadSaved = false, fileDownloadError = "下载已取消。",
            fileDownloadBytes = 0, fileDownloadTotal = 0, error = null)
    }


    /** The OS chooser does not retain an Owner reference or a URI in UI state. */
    fun prepareFileUpload(): Boolean {
        val current = editableBrowseState() ?: return false
        if (current.fileUploadPickerParent != null || current.fileUploadActive ||
            current.fileDownloadActive || current.fileExportPending != null) return false
        mutableState.value = current.copy(fileUploadPickerParent = current.path.last().id,
            fileUploadCommitted = false, error = null)
        return true
    }

    fun cancelFileUploadPicker() {
        mutableState.value = state.value.copy(fileUploadPickerParent = null)
    }

    /** SAF callback may return after navigation/logout. Refuse old Owner paths
     * before requesting even an upload session; bytes never enter UI state. */
    fun acceptFileUpload(name: String, size: Long, openInput: () -> InputStream) {
        val current = state.value
        val parent = current.path.lastOrNull()
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.fileUploadPickerParent == null || current.fileUploadPickerParent != parent?.id ||
            current.fileDownloadActive || current.fileUploadActive || current.loading ||
            !current.loaded || current.browseSelectionMode || current.destinationKind != null ||
            session == null) {
            mutableState.value = current.copy(fileUploadPickerParent = null)
            return
        }
        if (!validDriveNodeName(name) || size < 0L) {
            mutableState.value = current.copy(fileUploadPickerParent = null,
                error = "所选文件名称或大小无效，无法上传。")
            return
        }
        val service = api ?: return
        val path = current.path.toList()
        val destination = parent!!
        mutableState.value = current.copy(fileUploadPickerParent = null,
            fileUploadActive = true, fileUploadCommitted = false,
            fileUploadBytes = 0, fileUploadTotal = size)
        request(isFileUpload = true) { ticket ->
            val transferId = beginNativeTransfer(NativeTransferKind.UPLOAD, name, size)
            val result = authenticatedMutation(ticket) { token ->
                service.uploadFile(token, destination, name, size, openInput) { confirmed ->
                    if (ticket == generation) {
                        mutableState.value = state.value.copy(fileUploadBytes = confirmed)
                        nativeTransferProgress(transferId, confirmed)
                    }
                }
            }
            checkCurrent(ticket)
            // Server finalize returned an exact successful Node ACK; later
            // Browse reconciliation can fail without making the upload uncertain.
            finishNativeTransfer(transferId, NativeTransferStatus.COMPLETED, size)
            mutableState.value = state.value.copy(
                fileUploadActive = false, fileUploadCommitted = true,
                fileUploadBytes = size)
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                fresh.copy(
                    items = (fresh.items + result).distinctBy { it.id },
                    totalCount = fresh.totalCount + 1,
                    fileUploadCommitted = true, fileUploadActive = false)
            }
        }
    }

    fun cancelFileUpload() {
        if (!state.value.fileUploadActive) return
        invalidate() // Also cancels chunk/finalize HTTP and closes the SAF stream.
        mutableState.value = state.value.copy(
            loading = false, fileUploadActive = false, fileUploadPickerParent = null,
            fileUploadCommitted = false, fileUploadBytes = 0, fileUploadTotal = 0,
            error = "上传已取消或结果未确认，请刷新目录核对后再尝试。")
    }

    /** Real Owner-checked target folder picker. All folders come from
     * XDriveService.root/children, never synthetic paths or arbitrary IDs. */
    /** Browse-only, in-memory iOS Files selection. Server batch mutation limit
     * is 200, with no selection carried across Owner, directory or logout. */
    fun setBrowseSelectionMode(enabled: Boolean) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.loading || current.destinationKind != null ||
            current.browseBatchWriteAttempted || !current.loaded ||
            (enabled && current.error != null)) return
        mutableState.value = current.copy(
            browseSelectionMode = enabled, browseSelectedIds = emptySet(), error = null)
    }

    fun toggleBrowseSelection(node: DriveNode) {
        val current = state.value
        if (!current.browseSelectionMode || current.screen != Screen.FILES ||
            current.filesSection != FilesSection.BROWSE || current.loading ||
            !current.loaded || current.destinationKind != null ||
            current.browseBatchWriteAttempted || current.path.isEmpty() ||
            node.parentId != current.path.last().id ||
            node.revision <= 0 || current.items.none { it == node }) return
        val selected = current.browseSelectedIds
        if (node.id in selected) {
            mutableState.value = current.copy(browseSelectedIds = selected - node.id,
                error = if (current.error == "一次最多选择 200 项。") null else current.error)
        } else if (current.error != null) {
            return
        } else if (selected.size >= 200) {
            mutableState.value = current.copy(error = "一次最多选择 200 项。")
        } else {
            mutableState.value = current.copy(browseSelectedIds = selected + node.id)
        }
    }

    fun trashSelectedBrowseNodes() {
        val current = state.value
        if (!current.browseSelectionMode || current.screen != Screen.FILES ||
            current.filesSection != FilesSection.BROWSE || current.loading ||
            current.destinationKind != null || current.browseBatchWriteAttempted ||
            !current.loaded || current.error != null || current.path.isEmpty()) return
        val ids = current.browseSelectedIds
        if (ids.isEmpty() || ids.size > 200) return
        val nodes = current.items.filter { it.id in ids && it.revision > 0 &&
            it.parentId == current.path.last().id }
        if (nodes.size != ids.size) return
        val service = api ?: return
        val path = current.path.toList()
        mutableState.value = current.copy(browseBatchWriteAttempted = true)
        request { ticket ->
            authenticatedMutation(ticket) { service.trashNodes(it, nodes) }
            checkCurrent(ticket)
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                fresh.copy(items = fresh.items.filterNot { it.id in ids },
                    totalCount = (fresh.totalCount - ids.size).coerceAtLeast(0),
                    browseSelectionMode = false, browseSelectedIds = emptySet(),
                    browseBatchWriteAttempted = false)
            }
        }
    }

    /** Atomic 1–200 batch Copy/Move. Source rows and revisions are frozen
     * from the already-authenticated visible Files selection; no per-file HTTP
     * writes, no guessed Node and no cross-Owner selection. */
    fun chooseSelectedDestination(kind: FilesTransferKind) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            !current.loaded || current.loading || current.destinationKind != null ||
            !current.browseSelectionMode || current.error != null ||
            current.browseBatchWriteAttempted || current.path.isEmpty() ||
            current.filesPdfViewer != null ||
            current.browseSelectedIds.size !in 1..200 || session == null) return
        val sourceID = current.path.last().id
        val rows = current.items.filter { it.id in current.browseSelectedIds &&
            it.parentId == sourceID && it.revision > 0 }
        if (rows.size != current.browseSelectedIds.size ||
            rows.map { it.id }.toSet().size != rows.size) return
        val service = api ?: return
        mutableState.value = current.copy(destinationKind = kind,
            destinationSource = rows.first(), destinationSources = rows,
            destinationPath = emptyList(), destinationFolders = emptyList(),
            destinationOffset = 0, destinationTotal = 0,
            destinationLoaded = false, destinationSubmitting = false,
            destinationWriteAttempted = false)
        request { ticket ->
            val root = authenticated(service, ticket) { service.root(it) }
            checkCurrent(ticket)
            loadDestination(service, listOf(root), 0, ticket)
        }
    }

    fun chooseDestination(node: DriveNode, kind: FilesTransferKind) {
        val current = editableBrowseState(node) ?: return
        val service = api ?: return
        mutableState.value = current.copy(
            destinationKind = kind, destinationSource = node,
            destinationSources = emptyList(),
            destinationPath = emptyList(), destinationFolders = emptyList(),
            destinationOffset = 0, destinationTotal = 0, destinationLoaded = false,
            destinationSubmitting = false, destinationWriteAttempted = false)
        request { ticket ->
            val root = authenticated(service, ticket) { service.root(it) }
            checkCurrent(ticket)
            loadDestination(service, listOf(root), 0, ticket)
        }
    }

    fun dismissDestination() {
        val current = state.value
        if (current.destinationKind == null || current.destinationSubmitting) return
        invalidate() // Cancel remote folder enumeration, not an in-flight write.
        mutableState.value = current.withoutDestination().copy(loading = false, error = null)
    }

    fun enterDestinationFolder(node: DriveNode) {
        val current = state.value
        if (current.destinationKind == null || !current.destinationLoaded ||
            current.loading || current.destinationFolders.none { it == node } ||
            !node.isDirectory) return
        val sources = current.destinationSources.ifEmpty {
            listOfNotNull(current.destinationSource)
        }
        if (sources.any { it.isDirectory && it.id == node.id }) return
        val service = api ?: return
        val path = current.destinationPath + node
        // Record the *requested* destination before the GET starts. If the
        // Server rejects/times out, Retry must read this same child, not the
        // previously displayed parent folder.
        mutableState.value = current.copy(
            destinationPath = path, destinationFolders = emptyList(),
            destinationOffset = 0, destinationTotal = 0, destinationLoaded = false)
        request { ticket -> loadDestination(service, path, 0, ticket) }
    }

    fun backDestinationFolder() {
        val current = state.value
        if (current.destinationKind == null || current.loading ||
            current.destinationPath.size < 2) return
        val service = api ?: return
        val path = current.destinationPath.dropLast(1)
        mutableState.value = current.copy(
            destinationPath = path, destinationFolders = emptyList(),
            destinationOffset = 0, destinationTotal = 0, destinationLoaded = false)
        request { ticket -> loadDestination(service, path, 0, ticket) }
    }

    fun loadMoreDestination() {
        val current = state.value
        if (current.destinationKind == null || !current.destinationHasNext ||
            current.loading || current.error != null || current.destinationPath.isEmpty()) return
        val service = api ?: return
        val path = current.destinationPath.toList()
        val next = current.destinationOffset + 100
        request { ticket -> loadDestination(service, path, next, ticket, append = true) }
    }

    fun retryDestination() {
        val current = state.value
        if (current.destinationKind == null || current.loading ||
            current.destinationSubmitting || current.destinationWriteAttempted) return
        val service = api ?: return
        if (current.destinationPath.isEmpty()) {
            // Re-read the same trusted root without discarding frozen batch
            // identities or accidentally restarting the single-file picker.
            request { ticket ->
                val root = authenticated(service, ticket) { service.root(it) }
                checkCurrent(ticket)
                loadDestination(service, listOf(root), 0, ticket)
            }
            return
        }
        val path = current.destinationPath.toList()
        request { ticket -> loadDestination(service, path, 0, ticket) }
    }

    private suspend fun loadDestination(
        service: XDriveService, path: List<DriveNode>, offset: Int, ticket: Long,
        append: Boolean = false,
    ) {
        checkCurrent(ticket)
        if (path.isEmpty() || path.any { !it.isDirectory }) throw ApiException(
            0, "Invalid target folder path", ApiFailureReason.INVALID_RESPONSE)
        val page = authenticated(service, ticket) { service.children(it, path.last().id, offset) }
        checkCurrent(ticket)
        val current = state.value
        if (current.destinationKind == null || current.destinationSource == null) throw CancellationException()
        if (append && (current.destinationPath != path ||
                current.destinationOffset + 100 != offset || !current.destinationLoaded))
            throw CancellationException()
        if (page.offset != offset || (page.items.isEmpty() && page.totalCount > offset))
            throw ApiException(0, "Invalid destination page", ApiFailureReason.INVALID_RESPONSE)
        val folders = page.items.filter { it.isDirectory }
        val merged = if (append) (current.destinationFolders + folders).distinctBy { it.id } else folders
        // A legitimate later 100-item range may contain files only. The
        // Server advances the full (folders-first) NodeRange offset, so zero
        // new folders is not evidence of stalled pagination.
        mutableState.value = current.copy(
            destinationPath = path, destinationFolders = merged,
            destinationOffset = offset, destinationTotal = page.totalCount,
            destinationLoaded = true, error = null,
        )
    }

    /** Server commits batch Copy/Move in one SQL transaction. No token
     * refresh/replay for either individual or batch physical writes. */
    fun commitDestination() {
        val current = state.value
        val source = current.destinationSource ?: return
        val kind = current.destinationKind ?: return
        val frozenBatch = current.destinationSources
        val sources = frozenBatch.ifEmpty { listOf(source) }
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.loading || current.destinationSubmitting || current.destinationWriteAttempted ||
            !current.destinationLoaded || current.error != null ||
            current.destinationPath.isEmpty() || current.path.isEmpty() ||
            sources.size !in 1..200 || sources.map { it.id }.toSet().size != sources.size ||
            sources.any { it.parentId != current.path.last().id || it.revision <= 0 ||
                current.items.none { visible -> visible == it } }) return
        if (frozenBatch.isNotEmpty() && (!current.browseSelectionMode ||
            current.browseSelectedIds != frozenBatch.map { it.id }.toSet())) return
        val targetID = current.destinationPath.last().id
        if (kind == FilesTransferKind.MOVE && sources.any { it.parentId == targetID }) return
        if (sources.any { it.isDirectory &&
            current.destinationPath.any { target -> target.id == it.id } }) return
        val service = api ?: return
        val path = current.path.toList()
        val selectedIds = sources.map { it.id }.toSet()
        mutableState.value = current.copy(
            destinationSubmitting = true, destinationWriteAttempted = true)
        request { ticket ->
            val results = authenticatedMutation(ticket) { token ->
                if (frozenBatch.isNotEmpty()) {
                    if (kind == FilesTransferKind.COPY)
                        service.batchCopyNodes(token, frozenBatch, targetID)
                    else service.batchMoveNodes(token, frozenBatch, targetID)
                } else {
                    listOf(if (kind == FilesTransferKind.COPY)
                        service.copyNode(token, source, targetID)
                    else service.moveNode(token, source, targetID))
                }
            }
            checkCurrent(ticket)
            mutableState.value = state.value.withoutDestination().copy(
                browseSelectionMode = false, browseSelectedIds = emptySet(),
                browseBatchWriteAttempted = false)
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                if (kind == FilesTransferKind.MOVE) fresh.copy(
                    items = fresh.items.filterNot { it.id in selectedIds },
                    totalCount = (fresh.totalCount - sources.size).coerceAtLeast(0L))
                else if (targetID == path.last().id) fresh.copy(
                    items = (fresh.items + results).distinctBy { it.id },
                    totalCount = fresh.totalCount + results.size)
                else fresh
            }
        }
    }

    fun createFolder(name: String) {
        val current = editableBrowseState() ?: return
        if (!validDriveNodeName(name)) {
            mutableState.value = current.copy(error = "文件夹名称不符合要求：请检查保留字符、末尾空格及 255 字节限制。")
            return
        }
        val service = api ?: return
        val path = current.path.toList()
        val parentID = path.last().id
        request { ticket ->
            val created = authenticatedMutation(ticket) { service.createDirectory(it, parentID, name) }
            checkCurrent(ticket)
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                fresh.copy(items = (fresh.items + created).distinctBy { it.id },
                    totalCount = fresh.totalCount + 1)
            }
        }
    }

    fun renameBrowseNode(node: DriveNode, name: String) {
        val current = editableBrowseState(node) ?: return
        if (!validDriveNodeName(name)) {
            mutableState.value = current.copy(error = "名称不符合要求：请检查保留字符、末尾空格及 255 字节限制。")
            return
        }
        if (name == node.name) return
        val service = api ?: return
        val path = current.path.toList()
        request { ticket ->
            val renamed = authenticatedMutation(ticket) { service.renameNode(it, node, name) }
            checkCurrent(ticket)
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                fresh.copy(items = fresh.items.map { if (it.id == node.id) renamed else it })
            }
        }
    }

    /** The underlying Go endpoint moves an active subtree into Trash.
     * The UI asks for confirmation before invoking this destructive action. */
    fun moveBrowseNodeToTrash(node: DriveNode) {
        val current = editableBrowseState(node) ?: return
        val service = api ?: return
        val path = current.path.toList()
        request { ticket ->
            authenticatedMutation(ticket) { service.trashNode(it, node) }
            checkCurrent(ticket)
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                fresh.copy(items = fresh.items.filterNot { it.id == node.id },
                    totalCount = (fresh.totalCount - 1).coerceAtLeast(0))
            }
        }
    }

    /** Single physical write attempt: unlike idempotent Owner reads, a lost
     * response must never cause a token-refresh replay of POST/PATCH/DELETE. */
    private suspend fun <T> authenticatedMutation(
        ticket: Long, block: suspend (String) -> T,
    ): T {
        checkCurrent(ticket)
        val current = session ?: throw CancellationException()
        val result = block(current.accessToken)
        checkCurrent(ticket)
        return result
    }

    private suspend fun reconcileBrowseAfterCommit(
        service: XDriveService, path: List<DriveNode>, ticket: Long,
        provisional: (DriveState) -> DriveState,
    ) {
        checkCurrent(ticket)
        val current = state.value
        if (current.filesSection != FilesSection.BROWSE || current.path != path)
            throw CancellationException()
        // Server already ACKed. Never re-issue a mutation merely because the
        // subsequent read fails; show a committed-but-stale notice instead.
        mutableState.value = provisional(current)
        try {
            loadWithin(service, path, 0, ticket)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            checkCurrent(ticket)
            if (failure is ApiException && failure.statusCode == 401) throw failure
            mutableState.value = state.value.copy(
                error = "操作已提交，但目录刷新失败。请点刷新读取最新状态。")
        }
    }

    fun changeFilesSection(next: FilesSection) {
        val current = state.value
        if (!current.canNavigateFiles() ||
            current.filesSection == next || next == FilesSection.SEARCH) return
        invalidate() // Unmount/cancel old Owner range/collection before switching.
        mutableState.value = current.copy(filesSection = next, selected = null,
            loading = false, discardableReadInFlight = false, error = null, collectionItems = emptyList(), collectionLoaded = false,
            searchQuery = "", searchNextCursor = "",
            browseSelectionMode = false, browseSelectedIds = emptySet(),
            fileExportPending = null, fileDownloadSaved = false,
            fileUploadPickerParent = null, fileUploadCommitted = false,
            fileUploadActive = false)
        if (next == FilesSection.BROWSE) {
            if (!state.value.loaded) load(state.value.path, 0)
        } else loadCollection(next)
    }

    /** PWA global search targets the Server's entire Owner tree, never this
     * directory's loaded 100 rows. The query/cursor are scoped to one ticket. */
    fun submitGlobalSearch(input: String) {
        val current = state.value
        if (!current.canNavigateFiles()) return
        val query = input.trim()
        if (query.codePointCount(0, query.length) < 2 || query.toByteArray(Charsets.UTF_8).size > 256) {
            mutableState.value = current.copy(error = "搜索需要至少两个字符，且不能超过 256 字节。")
            return
        }
        invalidate()
        mutableState.value = current.copy(filesSection = FilesSection.SEARCH, selected = null,
            loading = false, error = null, collectionItems = emptyList(), collectionLoaded = false,
            searchQuery = query, searchNextCursor = "",
            browseSelectionMode = false, browseSelectedIds = emptySet(),
            fileExportPending = null, fileDownloadSaved = false,
            fileUploadPickerParent = null, fileUploadCommitted = false,
            fileUploadActive = false,
            searchReturnSection = if (current.filesSection == FilesSection.SEARCH)
                current.searchReturnSection else current.filesSection)
        loadCollection(FilesSection.SEARCH)
    }

    private fun loadCollection(section: FilesSection = state.value.filesSection) {
        val service = api ?: return
        if (session == null || state.value.screen != Screen.FILES ||
            section == FilesSection.BROWSE || state.value.filesSection != section) return
        val query = state.value.searchQuery
        request(discardableRead = true) { ticket ->
            val page = authenticated(service, ticket) { token ->
                when (section) {
                    FilesSection.RECENT -> FileSearchPage(service.fileRecent(token), "")
                    FilesSection.FAVORITES -> FileSearchPage(service.fileFavorites(token), "")
                    FilesSection.SEARCH -> service.searchFiles(token, query)
                    FilesSection.BROWSE -> throw CancellationException()
                }
            }
            checkCurrent(ticket)
            if (state.value.filesSection != section || state.value.searchQuery != query) return@request
            mutableState.value = state.value.copy(collectionItems = page.items,
                searchNextCursor = page.nextCursor, collectionLoaded = true)
        }
    }

    fun loadMoreSearch(retryFailed: Boolean = false) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.SEARCH ||
            current.loading || (!retryFailed && current.error != null) ||
            !current.collectionLoaded || current.searchNextCursor.isBlank()) return
        val service = api ?: return
        if (session == null) return
        val query = current.searchQuery
        val cursor = current.searchNextCursor
        request(discardableRead = true) { ticket ->
            val page = authenticated(service, ticket) { token -> service.searchFiles(token, query, cursor) }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.filesSection != FilesSection.SEARCH || latest.searchQuery != query ||
                latest.searchNextCursor != cursor) return@request
            val merged = (latest.collectionItems + page.items).distinctBy { it.node.id }
            if (page.nextCursor == cursor || (page.items.isEmpty() && page.nextCursor.isNotEmpty()) ||
                (merged.size == latest.collectionItems.size && page.nextCursor.isNotEmpty()))
                throw ApiException(0, "Search pagination cannot progress", ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(collectionItems = merged,
                searchNextCursor = page.nextCursor, collectionLoaded = true)
        }
    }

    fun openCollectionItem(item: DriveCollectionItem) {
        val current = state.value
        if (!current.canNavigateFiles() || current.filesSection == FilesSection.BROWSE ||
            current.filesAudioViewer != null || current.filesPdfViewer != null ||
            current.collectionItems.none { it == item }) return
        if (item.node.isDirectory) openCollectionFolder(item)
        else if (fileKind(item.node.name, false) in setOf("image", "video") &&
            item.node.revision > 0 && item.node.size > 0) openFilesMedia(item.node)
        else if (fileKind(item.node.name, false) == "pdf" &&
            item.node.revision > 0 && item.node.size > 0) openFilesPdf(item.node)
        else if (fileKind(item.node.name, false) == "audio" &&
            item.node.revision > 0 && item.node.size > 0) openFilesAudio(item.node)
        else showDetails(item.node)
    }

    /** Navigate using an authenticated Owner-scoped breadcrumb, recheck root
     * and last directory with the same Server API. Never trust a display path. */
    private fun openCollectionFolder(item: DriveCollectionItem) {
        val current = state.value
        if (!current.canNavigateFiles() || current.filesSection == FilesSection.BROWSE ||
            !item.node.isDirectory || current.collectionItems.none { it == item }) return
        // Search files already carry directory-only breadcrumbs; recent and
        // favorites include the file leaf. Reuse the actual parent in both.
        val crumbs = if (item.node.isDirectory || item.crumbs.lastOrNull()?.id != item.node.id)
            item.crumbs else item.crumbs.dropLast(1)
        if (crumbs.isEmpty() || crumbs.size > 512) return
        val service = api ?: return
        if (session == null) return
        val candidate = crumbs.mapIndexed { index, crumb ->
            DriveNode(id = crumb.id, parentId = crumbs.getOrNull(index - 1)?.id, name = crumb.name, type = "dir")
        }
        invalidate()
        mutableState.value = current.copy(filesSection = FilesSection.BROWSE,
            collectionItems = emptyList(), collectionLoaded = false, error = null, loading = false,
            selected = null, searchQuery = "", searchNextCursor = "")
        request(discardableRead = true) { ticket ->
            val root = authenticated(service, ticket) { service.root(it) }
            checkCurrent(ticket)
            if (root.id != candidate.first().id)
                throw ApiException(0, "Stale breadcrumb root", ApiFailureReason.INVALID_RESPONSE)
            loadWithin(service, listOf(root) + candidate.drop(1), 0, ticket)
        }
    }

    /** Exact Show in Folder: the Server returns current Owner location and
     * ordinal. Never enumerate 100k siblings or trust a stale Search breadcrumb.
     * Keep results visible on failure instead of selecting a wrong row. */
    fun locateCollectionItem(item: DriveCollectionItem) {
        val current = state.value
        if (!current.canNavigateFiles() || current.filesSection == FilesSection.BROWSE ||
            current.collectionItems.none { it == item } || session == null) return
        val service = api ?: return
        val section = current.filesSection
        val arrangement = current.filesArrangement
        request(discardableRead = true) { ticket ->
            val location = authenticated(service, ticket) {
                service.nodeLocation(it, item.node.id)
            }
            checkCurrent(ticket)
            val parent = location.parentDirectories
            val root = authenticated(service, ticket) { service.root(it) }
            checkCurrent(ticket)
            if (parent.isEmpty() || root.id != parent.first().id)
                throw ApiException(0, "Node location changed", ApiFailureReason.INVALID_RESPONSE)
            val position = authenticated(service, ticket) {
                service.childPositionArranged(it, location.parentId, location.nodeId, arrangement)
            }
            checkCurrent(ticket)
            if (position.revision != location.revision)
                throw ApiException(0, "Node position changed", ApiFailureReason.INVALID_RESPONSE)
            val pageStart = (position.index / 100) * 100
            val page = authenticated(service, ticket) {
                service.childrenArranged(it, location.parentId, pageStart, arrangement)
            }
            checkCurrent(ticket)
            // The position response is O(1). For a grouped jump into a deep
            // 100k directory, fetch only the first bounded page to obtain Go's
            // full group-index metadata, never enumerate preceding siblings.
            val groups = if (arrangement.group != "none" && pageStart > 0) {
                val first = authenticated(service, ticket) {
                    service.childrenArranged(it, location.parentId, 0, arrangement)
                }
                checkCurrent(ticket)
                if (first.offset != 0 || first.totalCount != page.totalCount ||
                    (first.totalCount > 0L && first.groups.isEmpty()))
                    throw ApiException(0, "Owner directory group index changed",
                        ApiFailureReason.INVALID_RESPONSE)
                first.groups
            } else page.groups
            val localIndex = position.index - pageStart
            if (page.offset != pageStart || page.totalCount <= position.index.toLong() ||
                localIndex !in page.items.indices)
                throw ApiException(0, "Located range changed", ApiFailureReason.INVALID_RESPONSE)
            val exactNode = page.items[localIndex]
            if (exactNode.id != item.node.id || exactNode.revision != position.revision ||
                exactNode.parentId != location.parentId ||
                exactNode.isDirectory != item.node.isDirectory)
                throw ApiException(0, "Located item changed", ApiFailureReason.INVALID_RESPONSE)
            val latest = state.value
            if (latest.screen != Screen.FILES || latest.filesSection != section ||
                latest.collectionItems.none { it == item }) throw CancellationException()
            val path = parent.mapIndexed { index, crumb ->
                if (index == 0) root else DriveNode(
                    id = crumb.id, parentId = parent[index - 1].id,
                    name = crumb.name, type = "dir",
                )
            }
            retryPrepend = false
            retryPath = path
            retryOffset = pageStart
            retryAppend = false
            mutableState.value = latest.copy(
                filesSection = FilesSection.BROWSE, path = path,
                items = page.items, offset = pageStart, browseWindowStart = pageStart,
                totalCount = page.totalCount, loaded = true,
                filesGroups = groups,
                focusedBrowseNodeId = exactNode.id, focusedBrowseIndex = localIndex,
                focusedBrowseEpoch = latest.focusedBrowseEpoch + 1,
                selected = null, error = null,
                collectionItems = emptyList(), collectionLoaded = false,
                searchQuery = "", searchNextCursor = "",
                browseSelectionMode = false, browseSelectedIds = emptySet(),
                browseBatchWriteAttempted = false,
                fileExportPending = null, fileUploadPickerParent = null,
            )
        }
    }

    fun favoriteFile(node: DriveNode) {
        val current = state.value
        val visible = if (current.filesSection == FilesSection.BROWSE) current.items.any { it == node }
            else current.collectionItems.any { it.node == node }
        val service = api ?: return
        if (current.screen != Screen.FILES || node.isDirectory || !visible || session == null) return
        request { ticket ->
            authenticated(service, ticket) { service.favoriteFile(it, node.id) }
            checkCurrent(ticket)
            // Existing Server is authoritative. The UI does not pretend that
            // a failed/uncertain PUT has changed collection membership.
            mutableState.value = state.value.copy(error = null)
        }
    }

    fun unfavoriteFile(node: DriveNode) {
        val current = state.value
        val service = api ?: return
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.FAVORITES ||
            current.collectionItems.none { it.node == node } || session == null) return
        request { ticket ->
            authenticated(service, ticket) { service.unfavoriteFile(it, node.id) }
            checkCurrent(ticket)
            mutableState.value = state.value.copy(
                collectionItems = state.value.collectionItems.filterNot { it.node.id == node.id })
        }
    }


    /** Owner-scoped deleted roots. This is a separate Files subview, not Gallery. */
    fun openTrash() {
        val current = state.value
        if (!current.canNavigateFiles() || session == null || api == null) return
        invalidate()
        mutableState.value = current.copy(screen = Screen.TRASH, loading = false,
            error = null, selected = null, fileExportPending = null,
            fileUploadPickerParent = null, browseSelectionMode = false,
            browseSelectedIds = emptySet(), trashItems = emptyList(),
            trashTotal = 0, trashLoaded = false, trashRestoreAttempted = false)
        readTrash(0, append = false)
    }

    fun closeTrash() {
        val current = state.value
        if (current.screen != Screen.TRASH || current.trashRestoreAttempted ||
            current.hasActiveNativeTransfer()) return
        invalidate()
        mutableState.value = current.copy(screen = Screen.FILES, loading = false,
            error = null, trashItems = emptyList(), trashTotal = 0,
            trashLoaded = false, trashRestoreAttempted = false,
            items = emptyList(), loaded = false)
        // The restored item may now exist in the previous Owner directory.
        load(state.value.path, 0)
    }

    fun refreshTrash() {
        if (state.value.screen != Screen.TRASH || state.value.loading) return
        readTrash(0, append = false)
    }

    fun loadMoreTrash() {
        val current = state.value
        if (current.screen != Screen.TRASH || !current.trashLoaded ||
            current.loading || current.error != null || current.trashRestoreAttempted ||
            current.trashItems.size.toLong() >= current.trashTotal ||
            current.trashItems.size > Int.MAX_VALUE - 100) return
        readTrash(current.trashItems.size, append = true)
    }

    private fun readTrash(offset: Int, append: Boolean) {
        val current = state.value
        if (current.screen != Screen.TRASH || current.loading || session == null) return
        val service = api ?: return
        request { ticket ->
            val page = authenticated(service, ticket) { service.trashPage(it, offset) }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.TRASH) throw CancellationException()
            if (append && (!latest.trashLoaded || page.offset != latest.trashItems.size ||
                page.totalCount != latest.trashTotal ||
                page.items.any { row -> latest.trashItems.any { it.node.id == row.node.id } }))
                throw ApiException(0, "Trash changed while paging", ApiFailureReason.INVALID_RESPONSE)
            // A Server count is not evidence of rows. Treat an empty nonterminal
            // range as stale/invalid instead of repeatedly paging the same offset.
            // Keep the last successful rows and wait for an explicit GET refresh.
            if (page.items.isEmpty() && page.totalCount > offset.toLong())
                throw ApiException(0, "Empty Trash range with remaining count", ApiFailureReason.INVALID_RESPONSE)
            val rows = if (append) latest.trashItems + page.items else page.items
            mutableState.value = latest.copy(trashItems = rows,
                trashTotal = page.totalCount, trashLoaded = true,
                trashRestoreAttempted = false, error = null)
        }
    }

    fun restoreTrashItem(item: TrashEntry) {
        val current = state.value
        if (current.screen != Screen.TRASH || current.loading ||
            !current.trashLoaded || current.trashRestoreAttempted ||
            current.trashItems.none { it == item }) return
        val service = api ?: return
        if (session == null) return
        // A POST may have committed despite losing its response: no auto retry.
        mutableState.value = current.copy(trashRestoreAttempted = true)
        request { ticket ->
            authenticatedMutation(ticket) { service.restoreTrash(it, item.node) }
            checkCurrent(ticket)
            val acknowledged = state.value
            mutableState.value = acknowledged.copy(
                trashItems = acknowledged.trashItems.filterNot { it.node.id == item.node.id },
                trashTotal = (acknowledged.trashTotal - 1).coerceAtLeast(0),
                trashLoaded = false, trashRestoreAttempted = false, error = null)
            try {
                val page = authenticated(service, ticket) { service.trashPage(it, 0) }
                checkCurrent(ticket)
                val latest = state.value
                if (latest.screen != Screen.TRASH) throw CancellationException()
                mutableState.value = latest.copy(
                    trashItems = page.items, trashTotal = page.totalCount,
                    trashLoaded = true, error = null)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                checkCurrent(ticket)
                if (failure is ApiException && failure.statusCode == 401) throw failure
                mutableState.value = state.value.copy(trashLoaded = false,
                    error = "已恢复到原文件夹，但回收站刷新失败。请刷新确认最新列表。")
            }
        }
    }

    /** Native Gallery is a second app surface, not another Files section.
     * Files' verified Owner path remains in memory for a return to browsing. */
    fun openGallery() {
        val current = state.value
        if (!current.canNavigateFiles() || session == null || api == null) return
        invalidate()
        mutableState.value = current.withoutGallerySelection().copy(
            screen = Screen.GALLERY, loading = false, selected = null, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadSaved = false, fileDownloadError = null, fileUploadPickerParent = null,
            browseSelectionMode = false, browseSelectedIds = emptySet(),
            galleryPrimaryTab = GalleryPrimaryTab.LIBRARY,
            galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
            gallerySelectedAlbum = null,
            galleryMapOpen = false, galleryMapLoaded = false, galleryMapOverview = null,
            galleryBd09Requested = false, galleryBd09Cells = null,
            galleryItems = emptyList(), galleryOffset = 0, galleryTotal = 0,
            galleryLoaded = false, gallerySearchQuery = "", galleryMediaKind = "",
            gallerySortBy = "captured", gallerySortDir = "asc",
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = current.galleryJumpEpoch + 1, galleryPageIntent = "",
            gallerySelected = null, galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    /** iOS PWA More → 显示地图: native Owner GPS *summary*, not a Baidu
     * basemap. The 64 real WGS84 sample points are kept in memory only. */
    fun openGalleryMapOverview() {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryMapOpen ||
            current.galleryPrimaryTab != GalleryPrimaryTab.LIBRARY ||
            current.gallerySelectedAlbum != null || current.galleryViewer != null ||
            current.gallerySelectionMode || current.gallerySelected != null ||
            current.hasActiveNativeTransfer() || current.galleryMetadataWriteAttempted ||
            current.galleryAlbumCreateAttempted || current.galleryAlbumEditAttempted ||
            session == null || api == null) return
        invalidate() // The old Photo Range is a disposable GET.
        mutableState.value = current.withoutGallerySelection().copy(
            galleryMapOpen = true, galleryMapLoaded = false, galleryMapOverview = null,
            galleryBd09Requested = false, galleryBd09Cells = null,
            loading = false, error = null, gallerySelected = null, galleryViewer = null)
        loadGalleryMapOverview()
    }

    fun retryGalleryMapOverview() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryMapOpen ||
            current.loading || current.hasActiveNativeTransfer() ||
            current.galleryMetadataWriteAttempted) return
        if (current.galleryBd09Requested) loadGalleryBd09MapCells()
        else loadGalleryMapOverview()
    }

    /** A real Server-signed 8x8 BD09 index, requested only after the
     * verified WGS84 overview is visible. Never treat WGS84 as BD09. */
    fun openGalleryVerifiedBd09Cells() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryMapOpen ||
            !current.galleryMapLoaded || current.galleryMapOverview == null ||
            current.galleryBd09Requested || current.loading ||
            current.hasActiveNativeTransfer() || current.galleryMetadataWriteAttempted ||
            session == null || api == null) return
        mutableState.value = current.copy(
            galleryBd09Requested = true, galleryBd09Cells = null, error = null)
        loadGalleryBd09MapCells()
    }

    /** Returning to GPS never reloads or reprojects BD09 as WGS84.
     * In-flight results are discarded by generation even if transport
     * cancellation is non-cooperative. */
    fun showGalleryGpsOverview() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryMapOpen ||
            !current.galleryBd09Requested || current.hasActiveNativeTransfer()) return
        invalidate()
        mutableState.value = current.copy(
            galleryBd09Requested = false, galleryBd09Cells = null,
            loading = false, discardableReadInFlight = false, error = null)
        if (!state.value.galleryMapLoaded) loadGalleryMapOverview()
    }

    private fun loadGalleryBd09MapCells() {
        val service = api ?: return
        if (session == null || state.value.screen != Screen.GALLERY ||
            !state.value.galleryMapOpen || !state.value.galleryBd09Requested) return
        request(discardableRead = true) { ticket ->
            val cells = authenticated(service, ticket) { token ->
                service.baiduNativeMapCells(token, OwnerBd09Bounds.WORLD)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY || !latest.galleryMapOpen ||
                !latest.galleryBd09Requested) throw CancellationException()
            mutableState.value = latest.copy(galleryBd09Cells = cells, error = null)
        }
    }

    private fun loadGalleryMapOverview() {
        val service = api ?: return
        if (session == null || state.value.screen != Screen.GALLERY ||
            !state.value.galleryMapOpen) return
        request(discardableRead = true) { ticket ->
            val overview = authenticated(service, ticket) { token ->
                service.placesMapOverview(token, OwnerMapBounds.WORLD, false)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY || !latest.galleryMapOpen)
                throw CancellationException()
            mutableState.value = latest.copy(
                galleryMapLoaded = true, galleryMapOverview = overview, error = null)
        }
    }

    fun closeGalleryMapOverview() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryMapOpen ||
            current.hasActiveNativeTransfer()) return
        invalidate()
        mutableState.value = current.copy(galleryMapOpen = false,
            galleryMapLoaded = false, galleryMapOverview = null,
            galleryBd09Requested = false, galleryBd09Cells = null,
            loading = false, discardableReadInFlight = false,
            error = null)
        // If the first Gallery GET was replaced by Map, re-read it on return.
        // Otherwise retain the exact authenticated photo Range and scroll anchor.
        if (!state.value.galleryLoaded) loadGallery(initialLatest = true)
    }

    fun openFilesApp() {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.hasActiveNativeTransfer() ||
            current.galleryMetadataWriteAttempted ||
            current.galleryAlbumCreateAttempted || current.galleryAlbumEditAttempted) return
        invalidate() // Cancels the outstanding Gallery Range and item thumbnails.
        mutableState.value = current.withoutGallerySelection().copy(
            screen = Screen.FILES, loading = false,
            discardableReadInFlight = false, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = false, fileDownloadSaved = false,
            fileDownloadError = null, fileDownloadBytes = 0, fileDownloadTotal = 0,
            galleryPrimaryTab = GalleryPrimaryTab.LIBRARY,
            galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
            gallerySelectedAlbum = null,
            galleryMapOpen = false, galleryMapLoaded = false, galleryMapOverview = null,
            galleryBd09Requested = false, galleryBd09Cells = null,
            galleryItems = emptyList(), galleryOffset = 0, galleryTotal = 0,
            galleryLoaded = false, gallerySearchQuery = "", galleryMediaKind = "",
            gallerySortBy = "captured", gallerySortDir = "asc",
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = current.galleryJumpEpoch + 1, galleryPageIntent = "",
            gallerySelected = null, galleryViewer = null)
        if (!state.value.loaded) refresh()
    }


    /** Session-scoped real PhotoCollections; never derive from sparse tiles. */
    fun openGalleryCollections() {
        val previous = state.value
        if (previous.screen != Screen.GALLERY || session == null || api == null ||
            previous.galleryViewer != null || previous.fileUploadActive ||
            previous.fileDownloadActive ||
            previous.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS ||
            previous.galleryMetadataWriteAttempted ||
            previous.galleryAlbumCreateAttempted || previous.galleryAlbumEditAttempted) return
        invalidate()
        mutableState.value = previous.withoutGallerySelection().copy(
            galleryPrimaryTab = GalleryPrimaryTab.COLLECTIONS,
            gallerySelectedAlbum = null, loading = false, error = null,
            galleryItems = emptyList(), galleryLoaded = false, galleryOffset = 0,
            galleryTotal = 0, galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = previous.galleryJumpEpoch + 1, galleryPageIntent = "",
            gallerySelected = null, galleryViewer = null)
        if (!state.value.galleryAlbumsLoaded) readGalleryAlbums()
    }

    private fun readGalleryAlbums() {
        val current = state.value
        val service = api ?: return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            current.gallerySelectedAlbum != null || current.loading || session == null) return
        request { ticket ->
            val albums = authenticated(service, ticket) { service.galleryAlbums(it) }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY ||
                latest.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
                latest.gallerySelectedAlbum != null) throw CancellationException()
            mutableState.value = latest.copy(galleryAlbums = albums,
                galleryAlbumsLoaded = true, galleryAlbumCreateAttempted = false,
                galleryAlbumCreateCommittedNeedsRefresh = false,
                galleryAlbumEditAttempted = false,
                galleryAlbumEditCommittedNeedsRefresh = false, error = null)
        }
    }

    /** Fetch eligible album destinations without navigating away from selection. */
    fun loadGalleryAlbumsForSelection() {
        val current = state.value
        val service = api ?: return
        if (current.screen != Screen.GALLERY || !current.gallerySelectionMode ||
            !current.galleryLoaded || current.gallerySelectedItems.isEmpty() ||
            current.galleryViewer != null || current.loading ||
            current.galleryMetadataWriteAttempted || session == null) return
        mutableState.value = current.copy(galleryAlbums = emptyList(),
            galleryAlbumsLoaded = false)
        request { ticket ->
            val albums = authenticated(service, ticket) { service.galleryAlbums(it) }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY || !latest.gallerySelectionMode ||
                latest.galleryViewer != null || latest.gallerySelectedItems.isEmpty())
                throw CancellationException()
            mutableState.value = latest.copy(
                galleryAlbums = albums, galleryAlbumsLoaded = true, error = null)
        }
    }

    /** Create a real empty manual PhotoCollection, never a local-only album.
     * A missing POST ACK freezes another write until explicit read-only GET. */
    fun createGalleryManualAlbum(input: String) {
        val current = state.value
        val service = api ?: return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            current.gallerySelectedAlbum != null || !current.galleryAlbumsLoaded ||
            current.loading || current.error != null ||
            current.galleryAlbumCreateAttempted ||
            current.galleryAlbumCreateCommittedNeedsRefresh ||
            current.galleryAlbumEditAttempted || current.galleryAlbumEditCommittedNeedsRefresh ||
            current.galleryMetadataWriteAttempted || session == null) return
        val name = normalizeGalleryManualAlbumName(input)
        if (name == null) {
            mutableState.value = current.copy(error = "相册名称不能为空，且最多 200 个字符。")
            return
        }
        mutableState.value = current.copy(galleryAlbumCreateAttempted = true)
        request { ticket ->
            val created = authenticatedMutation(ticket) {
                service.createGalleryManualAlbum(it, name)
            }
            checkCurrent(ticket)
            if (created.kind != "manual" || created.name != name ||
                created.revision != 1L || created.itemCount != 0L ||
                created.albumFolderId != 0L || created.coverNodeId != null ||
                !created.id.startsWith("manual:") || created.id.length !in 8..512 ||
                created.id != created.id.trim() ||
                created.id.any { it.isISOControl() })
                throw ApiException(0, "Manual album ACK mismatch",
                    ApiFailureReason.INVALID_RESPONSE)
            val acknowledged = state.value
            mutableState.value = acknowledged.copy(
                galleryAlbumCreateAttempted = false,
                galleryAlbumCreateCommittedNeedsRefresh = true,
                galleryAlbums = emptyList(), galleryAlbumsLoaded = false, error = null)
            // ACK is final. Later failure may retry GET, never re-issue POST.
            val albums = authenticated(service, ticket) { service.galleryAlbums(it) }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY ||
                latest.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
                latest.gallerySelectedAlbum != null ||
                albums.none { it == created })
                throw ApiException(0, "Created manual album missing from Owner GET",
                    ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(galleryAlbums = albums,
                galleryAlbumsLoaded = true, galleryAlbumCreateAttempted = false,
                galleryAlbumCreateCommittedNeedsRefresh = false, error = null)
        }
    }

    /** Shared manual-album writer for rename/delete. One real Owner mutation,
     * one authoritative GET; uncertain result never triggers write replay. */
    private fun mutateGalleryManualAlbum(
        album: GalleryAlbum,
        change: suspend (XDriveService, String) -> Unit,
        verify: (List<GalleryAlbum>) -> Boolean,
    ) {
        val current = state.value
        val service = api ?: return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            current.gallerySelectedAlbum != null || !current.galleryAlbumsLoaded ||
            current.loading || current.error != null ||
            current.galleryAlbumCreateAttempted ||
            current.galleryAlbumCreateCommittedNeedsRefresh ||
            current.galleryAlbumEditAttempted ||
            current.galleryAlbumEditCommittedNeedsRefresh ||
            current.galleryMetadataWriteAttempted || session == null ||
            album.kind != "manual" || album.revision <= 0 ||
            current.galleryAlbums.none { it == album }) return
        mutableState.value = current.copy(galleryAlbumEditAttempted = true)
        request { ticket ->
            authenticatedMutation(ticket) { token -> change(service, token) }
            checkCurrent(ticket)
            mutableState.value = state.value.copy(
                galleryAlbumEditAttempted = false,
                galleryAlbumEditCommittedNeedsRefresh = true,
                galleryAlbumsLoaded = false, galleryAlbums = emptyList(),
                error = null)
            val albums = authenticated(service, ticket) { service.galleryAlbums(it) }
            checkCurrent(ticket)
            if (state.value.screen != Screen.GALLERY ||
                state.value.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
                state.value.gallerySelectedAlbum != null || !verify(albums))
                throw ApiException(0, "Manual album Owner GET mismatch",
                    ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = state.value.copy(galleryAlbums = albums,
                galleryAlbumsLoaded = true, galleryAlbumEditAttempted = false,
                galleryAlbumEditCommittedNeedsRefresh = false, error = null)
        }
    }

    fun renameGalleryManualAlbum(album: GalleryAlbum, newNameInput: String) {
        val newName = normalizeGalleryManualAlbumName(newNameInput) ?: return
        if (newName == album.name) return
        var updated: GalleryAlbum? = null
        mutateGalleryManualAlbum(album,
            change = { service, token ->
                updated = service.renameGalleryManualAlbum(token, album, newName)
                val renamed = updated
                if (renamed == null || renamed.id != album.id ||
                    renamed.kind != "manual" || renamed.name != newName ||
                    renamed.revision != album.revision + 1)
                    throw ApiException(0, "Manual album rename ACK mismatch",
                        ApiFailureReason.INVALID_RESPONSE)
            },
            verify = { albums -> albums.any { it == updated } },
        )
    }

    /** Deletes collection metadata/membership only; the media Nodes survive.
     * Caller must show explicit confirmation before invoking this method. */
    fun deleteGalleryManualAlbum(album: GalleryAlbum) =
        mutateGalleryManualAlbum(album,
            change = { service, token ->
                service.deleteGalleryManualAlbum(token, album)
            },
            verify = { albums -> albums.none { it.id == album.id } },
        )

    /** Restore the canonical Go automatic cover; it may still be a real
     * first-member photo rather than a null thumbnail. Uses the same
     * revision-fenced edit writer as rename, with GET-only recovery. */
    fun restoreGalleryAutomaticAlbumCover(album: GalleryAlbum) {
        var saved: GalleryAlbum? = null
        mutateGalleryManualAlbum(
            album,
            change = { service, token ->
                saved = service.gallerySetManualAlbumCover(token, album, 0)
                val result = saved
                if (result == null || result.id != album.id ||
                    result.kind != "manual" || result.name != album.name ||
                    result.itemCount != album.itemCount ||
                    result.albumFolderId != album.albumFolderId ||
                    result.revision !in album.revision..(album.revision + 1))
                    throw ApiException(0, "Manual album reset cover ACK mismatch",
                        ApiFailureReason.INVALID_RESPONSE)
            },
            verify = { albums -> albums.any { it == saved } },
        )
    }

    /** A visible Gallery refresh must really re-fetch its current Owner albums,
     * never expose an inert action on the Collections overview. */
    fun refreshGalleryAlbums() {
        val current = state.value
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            current.gallerySelectedAlbum != null || current.loading || session == null) return
        invalidate()
        mutableState.value = current.copy(
            loading = false, error = null, galleryAlbumsLoaded = false,
            galleryAlbums = emptyList())
        readGalleryAlbums()
    }

    fun retryGalleryAlbums() {
        val current = state.value
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            current.gallerySelectedAlbum != null || current.loading ||
            current.galleryAlbumsLoaded) return
        readGalleryAlbums()
    }

    fun openGalleryLibrary() {
        val previous = state.value
        if (previous.screen != Screen.GALLERY || session == null ||
            previous.galleryViewer != null || previous.fileUploadActive ||
            previous.fileDownloadActive || previous.galleryMetadataWriteAttempted ||
            previous.galleryAlbumCreateAttempted || previous.galleryAlbumEditAttempted ||
            (previous.galleryPrimaryTab == GalleryPrimaryTab.LIBRARY &&
                previous.gallerySelectedAlbum == null)) return
        invalidate()
        mutableState.value = previous.withoutGallerySelection().copy(galleryPrimaryTab = GalleryPrimaryTab.LIBRARY,
            gallerySelectedAlbum = null, loading = false, error = null,
            galleryItems = emptyList(), galleryLoaded = false, galleryOffset = 0,
            galleryTotal = 0, gallerySearchQuery = "", galleryMediaKind = "",
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = previous.galleryJumpEpoch + 1, galleryPageIntent = "",
            gallerySelected = null, galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    /** At most four Owner-authenticated Gallery thumbnails in flight across
     * photo tiles and Collection covers. An old Owner/tab/album must not
     * receive even a late non-cooperative detail or thumbnail response. */
    suspend fun galleryAlbumCover(album: GalleryAlbum): GalleryAlbumCover? {
        val ticket = generation
        val initial = state.value
        val service = api ?: return null
        if (initial.screen != Screen.GALLERY ||
            initial.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            initial.gallerySelectedAlbum != null || !initial.galleryAlbumsLoaded ||
            initial.galleryAlbums.none { it == album } || session == null) return null
        return galleryThumbnailLimit.withPermit {
            val cover = authenticated(service, ticket) {
                service.galleryAlbumCover(it, album)
            }
            checkCurrent(ticket)
            val current = state.value
            if (current.screen != Screen.GALLERY ||
                current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
                current.gallerySelectedAlbum != null || !current.galleryAlbumsLoaded ||
                current.galleryAlbums.none { it == album }) throw CancellationException()
            if (cover != null && (cover.nodeId != album.coverNodeId ||
                cover.revision <= 0 || cover.jpegBytes.isEmpty() ||
                cover.jpegBytes.size > 4 * 1024 * 1024))
                throw ApiException(0, "Invalid album cover", ApiFailureReason.INVALID_RESPONSE)
            cover
        }
    }

    fun openGalleryAlbum(album: GalleryAlbum) {
        val previous = state.value
        if (previous.screen != Screen.GALLERY || session == null ||
            previous.loading || previous.galleryViewer != null ||
            previous.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            previous.gallerySelectedAlbum != null || !previous.galleryAlbumsLoaded ||
            previous.galleryMetadataWriteAttempted ||
            previous.galleryAlbumCreateAttempted || previous.galleryAlbumEditAttempted ||
            previous.galleryAlbums.none { it == album }) return
        invalidate()
        mutableState.value = previous.withoutGallerySelection().copy(gallerySelectedAlbum = album,
            loading = false, error = null, galleryItems = emptyList(), galleryLoaded = false,
            galleryOffset = 0, galleryTotal = 0, gallerySearchQuery = "",
            galleryMediaKind = "", galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = previous.galleryJumpEpoch + 1, galleryPageIntent = "",
            gallerySelected = null, galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    fun closeGalleryAlbum() {
        val previous = state.value
        if (previous.screen != Screen.GALLERY ||
            previous.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            previous.gallerySelectedAlbum == null || previous.galleryViewer != null ||
            previous.hasActiveNativeTransfer() ||
            previous.galleryMetadataWriteAttempted) return
        invalidate()
        mutableState.value = previous.withoutGallerySelection().copy(gallerySelectedAlbum = null,
            loading = false, error = null, galleryItems = emptyList(), galleryLoaded = false,
            galleryOffset = 0, galleryTotal = 0, galleryTimelineSets = null,
            galleryJumpIndex = null, galleryJumpEpoch = previous.galleryJumpEpoch + 1,
            galleryPageIntent = "", gallerySelected = null, galleryViewer = null)
        // A successful membership mutation invalidates collection totals. Returning
        // from that album must re-read them; otherwise the overview spins forever.
        if (!state.value.galleryAlbumsLoaded) readGalleryAlbums()
    }

    /** Current Owner's bounded, loaded Gallery selection; not a query-wide promise. */
    fun setGallerySelectionMode(enabled: Boolean) {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            current.galleryViewer != null || current.viewerReturnToFiles ||
            current.gallerySelected != null || current.loading ||
            current.galleryMetadataWriteAttempted || session == null) return
        mutableState.value = current.copy(gallerySelectionMode = enabled,
            gallerySelectedItems = emptyList(),
            error = if (current.error == "一次最多选择 200 项。") null else current.error)
    }

    fun toggleGallerySelection(item: GalleryAsset) {
        val current = state.value
        if (!current.gallerySelectionMode || !current.galleryLoaded ||
            current.screen != Screen.GALLERY || current.loading ||
            current.galleryMetadataWriteAttempted || current.galleryViewer != null ||
            session == null || item.node.revision <= 0 ||
            item.mediaKind !in setOf("image", "video") ||
            current.galleryItems.none { it == item }) return
        val selected = current.gallerySelectedItems
        if (selected.any { it.node.id == item.node.id }) {
            mutableState.value = current.copy(
                gallerySelectedItems = selected.filterNot { it.node.id == item.node.id },
                error = if (current.error == "一次最多选择 200 项。") null else current.error)
        } else if (current.error != null) return
        else if (selected.size >= 200) {
            mutableState.value = current.copy(error = "一次最多选择 200 项。")
        } else mutableState.value = current.copy(gallerySelectedItems = selected + item)
    }

    /** Review-only edits to the frozen, selected current Owner media set.
     * Removal/clear never issues HTTP, reaches unselected nodes, or refreshes
     * the Gallery. The ordinary selection writer retains its strict snapshot. */
    fun removeGallerySelected(nodeId: Long) {
        val current = state.value
        if (nodeId <= 0 || current.screen != Screen.GALLERY ||
            !current.gallerySelectionMode || !current.galleryLoaded ||
            current.galleryViewer != null || current.loading ||
            current.galleryMetadataWriteAttempted || session == null ||
            current.gallerySelectedItems.none { it.node.id == nodeId }) return
        mutableState.value = current.copy(
            gallerySelectedItems = current.gallerySelectedItems.filterNot {
                it.node.id == nodeId
            },
            error = if (current.error == "一次最多选择 200 项。") null else current.error,
        )
    }

    fun clearGallerySelection() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.gallerySelectionMode ||
            !current.galleryLoaded || current.galleryViewer != null ||
            current.loading || current.galleryMetadataWriteAttempted || session == null) return
        mutableState.value = current.copy(
            gallerySelectedItems = emptyList(),
            error = if (current.error == "一次最多选择 200 项。") null else current.error,
        )
    }

    /** Shared, bounded Owner media metadata operation for favorite/tags.
     * Never replay a physical write on token refresh, failure, or missing ACK. */
    private fun submitGalleryMetadata(
        mutation: suspend (XDriveService, String, List<GalleryAsset>) -> Int,
        patch: (GalleryAsset, Set<Long>) -> GalleryAsset,
        invalidateAlbumsOnAck: Boolean = false,
    ) {
        val current = state.value
        if (!current.gallerySelectionMode || current.screen != Screen.GALLERY ||
            !current.galleryLoaded || current.loading || current.error != null ||
            current.galleryViewer != null || current.galleryMetadataWriteAttempted ||
            current.gallerySelectedItems.size !in 1..200 || session == null) return
        val selected = current.gallerySelectedItems.toList()
        val ids = selected.map { it.node.id }.toSet()
        if (ids.size != selected.size || selected.any { item ->
                item.node.revision <= 0 || current.galleryItems.none { it == item }
            }) return
        val service = api ?: return
        mutableState.value = current.copy(galleryMetadataWriteAttempted = true)
        request { ticket ->
            val acknowledged = authenticatedMutation(ticket) { token ->
                mutation(service, token, selected)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (acknowledged != selected.size ||
                latest.screen != Screen.GALLERY || !latest.gallerySelectionMode ||
                latest.gallerySelectedItems != selected ||
                selected.any { row -> latest.galleryItems.none { it == row } })
                throw ApiException(0, "Gallery metadata ACK mismatch",
                    ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(
                galleryItems = latest.galleryItems.map { item -> patch(item, ids) },
                galleryAlbums = if (invalidateAlbumsOnAck) emptyList() else latest.galleryAlbums,
                galleryAlbumsLoaded = if (invalidateAlbumsOnAck) false else latest.galleryAlbumsLoaded,
                gallerySelectionMode = false, gallerySelectedItems = emptyList(),
                galleryMetadataWriteAttempted = false, error = null)
        }
    }

    fun favoriteGallerySelected(favorite: Boolean) = submitGalleryMetadata(
        mutation = { service, token, selected ->
            service.galleryFavoriteBatch(token, selected, favorite)
        },
        patch = { item, ids ->
            if (item.node.id in ids) item.copy(favorite = favorite) else item
        },
    )

    /** The same frozen selection and fail-closed single-attempt contract as
     * favorite, using the Go/PWA metadata tag operation and no file writer. */
    fun tagGallerySelected(tags: List<String>) {
        val canonical = parseGalleryTagInput(tags.joinToString(",")) ?: return
        if (canonical != tags) return
        submitGalleryMetadata(
            mutation = { service, token, selected ->
                service.galleryTagsBatch(token, selected, canonical)
            },
            patch = { item, _ -> item }, // tags are re-read on next Owner GET
        )
    }

    /** If-Match protects existing manual album membership. Any uncertain
     * ACK freezes selection until explicit read-only Gallery reconciliation. */
    fun addGallerySelectedToAlbum(album: GalleryAlbum) {
        val current = state.value
        if (!current.galleryAlbumsLoaded || album.kind != "manual" ||
            album.revision <= 0 || current.galleryAlbums.none { it == album }) return
        submitGalleryMetadata(
            mutation = { service, token, selected ->
                val saved = service.galleryAddToManualAlbum(token, album, selected)
                if (saved.id != album.id || saved.kind != "manual" ||
                    saved.revision < album.revision)
                    throw ApiException(0, "Gallery album ACK mismatch",
                        ApiFailureReason.INVALID_RESPONSE)
                selected.size
            },
            patch = { item, _ -> item },
            invalidateAlbumsOnAck = true,
        )
    }

    /** Assign one current loaded member as a custom cover using only Go
     * PhotoCollection metadata. No original media/CAS or Android MediaStore
     * mutation. An uncertain PUT remains frozen until Owner GET reconciliation. */
    fun setGallerySelectedManualAlbumCover(item: GalleryAsset) {
        val current = state.value
        val album = current.gallerySelectedAlbum ?: return
        val service = api ?: return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            album.kind != "manual" || album.itemCount <= 0 ||
            album.revision <= 0 || !current.galleryLoaded ||
            !current.gallerySelectionMode || current.loading ||
            current.error != null || current.galleryViewer != null ||
            current.gallerySelectedItems != listOf(item) ||
            current.galleryItems.none { it == item } ||
            item.node.id <= 0 || item.node.revision <= 0 ||
            item.node.type != "file" || item.mediaKind !in setOf("image", "video") ||
            current.galleryMetadataWriteAttempted ||
            current.galleryAlbumCreateAttempted ||
            current.galleryAlbumEditAttempted || session == null) return
        mutableState.value = current.copy(galleryMetadataWriteAttempted = true)
        request { ticket ->
            val saved = authenticatedMutation(ticket) { token ->
                service.gallerySetManualAlbumCover(token, album, item.node.id)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (saved.id != album.id || saved.kind != "manual" ||
                saved.name != album.name || saved.albumFolderId != album.albumFolderId ||
                saved.itemCount != album.itemCount ||
                saved.revision !in album.revision..(album.revision + 1) ||
                saved.coverNodeId != item.node.id ||
                latest.screen != Screen.GALLERY ||
                latest.gallerySelectedAlbum != album ||
                latest.gallerySelectedItems != listOf(item) ||
                latest.galleryItems.none { it == item })
                throw ApiException(0, "Manual album cover ACK mismatch",
                    ApiFailureReason.INVALID_RESPONSE)
            // We show only the authoritative Go ACK (not a guessed image).
            // The Collections overview will GET fresh revision and cover.
            mutableState.value = latest.withoutGallerySelection().copy(
                gallerySelectedAlbum = saved,
                galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                error = null)
        }
    }

    /** A single selected, server-loaded member can leave the current manual
     * album. This never calls Node Trash or deletes original media bytes. */
    fun removeGallerySelectedAlbumMember(item: GalleryAsset) {
        val current = state.value
        val album = current.gallerySelectedAlbum ?: return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            album.kind != "manual" || album.revision <= 0 ||
            album.itemCount <= 0 || !current.galleryLoaded ||
            current.loading || current.error != null || !current.gallerySelectionMode ||
            current.gallerySelectedItems != listOf(item) ||
            current.galleryItems.none { it == item } ||
            item.node.revision <= 0 || item.node.type != "file" ||
            item.mediaKind !in setOf("image", "video") ||
            current.galleryMetadataWriteAttempted ||
            current.galleryAlbumCreateAttempted ||
            current.galleryAlbumEditAttempted ||
            session == null) return
        val service = api ?: return
        mutableState.value = current.copy(galleryMetadataWriteAttempted = true)
        request { ticket ->
            val saved = authenticatedMutation(ticket) { token ->
                service.galleryRemoveFromManualAlbum(token, album, item)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (saved.id != album.id || saved.kind != "manual" ||
                saved.revision != album.revision + 1 ||
                saved.itemCount != album.itemCount - 1 ||
                latest.screen != Screen.GALLERY ||
                latest.gallerySelectedAlbum != album ||
                latest.gallerySelectedItems != listOf(item) ||
                latest.galleryItems.none { it == item })
                throw ApiException(0, "Owner member removal ACK mismatch",
                    ApiFailureReason.INVALID_RESPONSE)
            // Only a verified ACK retires the selection gate. Never render a
            // locally filtered wall as if it were a Server-confirmed range.
            mutableState.value = latest.withoutGallerySelection().copy(
                gallerySelectedAlbum = saved,
                galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                galleryItems = emptyList(), galleryLoaded = false,
                galleryOffset = 0, galleryTotal = 0,
                galleryTimelineSets = null, galleryJumpIndex = null,
                galleryJumpEpoch = latest.galleryJumpEpoch + 1,
                galleryPageIntent = "", loading = false, error = null)
            loadGallery(initialLatest = true)
        }
    }

    /** A failed album-scoped selection write may have committed. Its next
     * operation must be GET album list THEN member Range, with no write replay.
     * This also retires an obsolete album revision before another edit. */
    private fun reconcileUncertainManualAlbumSelection() {
        val previous = state.value
        val selectedAlbum = previous.gallerySelectedAlbum ?: return
        val service = api ?: return
        if (previous.screen != Screen.GALLERY ||
            previous.galleryPrimaryTab != GalleryPrimaryTab.COLLECTIONS ||
            !previous.galleryMetadataWriteAttempted ||
            previous.loading || session == null) return
        request { ticket ->
            val albums = authenticated(service, ticket) { service.galleryAlbums(it) }
            checkCurrent(ticket)
            val album = albums.singleOrNull { it.id == selectedAlbum.id &&
                it.kind == selectedAlbum.kind } ?: throw ApiException(
                0, "Manual album unavailable after Owner reconciliation",
                ApiFailureReason.INVALID_RESPONSE)
            val page = fetchGalleryPage(service, ticket, 0, true,
                previous.gallerySearchQuery, previous.galleryMediaKind, album.id)
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY ||
                latest.gallerySelectedAlbum?.id != selectedAlbum.id ||
                !latest.galleryMetadataWriteAttempted)
                throw CancellationException()
            mutableState.value = latest.withoutGallerySelection().copy(
                gallerySelectedAlbum = album,
                galleryAlbums = albums, galleryAlbumsLoaded = true,
                galleryItems = page.items, galleryOffset = page.offset,
                galleryTotal = page.totalCount, galleryLoaded = true,
                galleryTimelineSets = page.timeline, galleryJumpIndex = null,
                galleryJumpEpoch = latest.galleryJumpEpoch + 1,
                galleryPageIntent = "", error = null)
        }
    }

    fun refreshGallery() {
        if (state.value.hasActiveNativeTransfer()) return
        if (state.value.galleryMetadataWriteAttempted && state.value.loading) return
        if (state.value.galleryMetadataWriteAttempted &&
            state.value.gallerySelectedAlbum != null) {
            reconcileUncertainManualAlbumSelection()
            return
        }
        if (state.value.screen != Screen.GALLERY ||
            (state.value.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS &&
                state.value.gallerySelectedAlbum == null)) return
        invalidate() // Stop prior Owner range before replacing its query intent.
        mutableState.value = state.value.withoutGallerySelection().copy(loading = false, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = false, fileDownloadSaved = false, fileDownloadError = null,
            galleryItems = emptyList(), galleryOffset = 0,
            galleryTotal = 0, galleryLoaded = false, gallerySelected = null,
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = state.value.galleryJumpEpoch + 1,
            galleryPageIntent = "", galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    /** All four iOS PWA sorts reload real Owner pages, never cached tile subsets. */
    fun changeGallerySort(by: String, dir: String) {
        if (by !in setOf("captured", "added") || dir !in setOf("asc", "desc")) return
        val current = state.value
        if (current.screen != Screen.GALLERY ||
            (current.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS &&
                current.gallerySelectedAlbum == null) ||
            current.galleryViewer != null || current.gallerySelected != null ||
            current.gallerySelectionMode || current.galleryMetadataWriteAttempted ||
            current.hasActiveNativeTransfer() || session == null || api == null ||
            (current.gallerySortBy == by && current.gallerySortDir == dir)) return
        invalidate() // Cancel old Owner pages, thumbnails and pending SAF picker.
        mutableState.value = current.withoutGallerySelection().copy(loading = false, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = false, fileDownloadSaved = false, fileDownloadError = null,
            fileDownloadBytes = 0, fileDownloadTotal = 0,
            gallerySortBy = by, gallerySortDir = dir, galleryItems = emptyList(),
            galleryOffset = 0, galleryTotal = 0, galleryLoaded = false,
            gallerySelected = null, galleryViewer = null,
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = current.galleryJumpEpoch + 1, galleryPageIntent = "")
        loadGallery(initialLatest = true)
    }

    /** A new Owner-wide query replaces the entire Gallery Range intent. */
    fun searchGallery(input: String) {
        val current = state.value
        if (current.gallerySelectionMode || current.galleryMetadataWriteAttempted ||
            current.hasActiveNativeTransfer()) return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.LIBRARY ||
            current.gallerySelectedAlbum != null || session == null || api == null) return
        val query = input.trim()
        if (query.length > 200 || query == current.gallerySearchQuery) return
        invalidate() // Cancel the previous query and prevent A→B→A stale replies.
        mutableState.value = current.withoutGallerySelection().copy(loading = false, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = false, fileDownloadSaved = false, fileDownloadError = null,
            fileDownloadBytes = 0, fileDownloadTotal = 0,
            gallerySearchQuery = query, galleryItems = emptyList(), galleryOffset = 0,
            galleryTotal = 0, galleryLoaded = false, gallerySelected = null,
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = current.galleryJumpEpoch + 1,
            galleryPageIntent = "", galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    /** Scope the entire Owner photo wall, including pagination and search,
     * to one Server-validated media kind. Never filter just the loaded tiles. */
    fun filterGalleryKind(kind: String) {
        if (kind != "" && kind != "image" && kind != "video") return
        val current = state.value
        if (current.gallerySelectionMode || current.galleryMetadataWriteAttempted ||
            current.hasActiveNativeTransfer()) return
        if (current.screen != Screen.GALLERY ||
            current.galleryPrimaryTab != GalleryPrimaryTab.LIBRARY ||
            current.gallerySelectedAlbum != null || session == null || api == null ||
            kind == current.galleryMediaKind) return
        invalidate() // Cancels prior Range/thumbnail/Viewer and fences stale replies.
        mutableState.value = current.withoutGallerySelection().copy(loading = false, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = false, fileDownloadSaved = false, fileDownloadError = null,
            fileDownloadBytes = 0, fileDownloadTotal = 0,
            galleryMediaKind = kind, galleryItems = emptyList(), galleryOffset = 0,
            galleryTotal = 0, galleryLoaded = false, gallerySelected = null,
            galleryTimelineSets = null, galleryJumpIndex = null,
            galleryJumpEpoch = current.galleryJumpEpoch + 1,
            galleryPageIntent = "", galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    /** Retry only the failed Owner GET; failed jumps retain their exact index. */
    fun retryGallery() {
        val current = state.value
        if (current.galleryMetadataWriteAttempted && !current.loading) {
            refreshGallery() // Re-read only; never replay the mutation.
            return
        }
        if (current.screen != Screen.GALLERY || current.loading ||
            (current.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS &&
                current.gallerySelectedAlbum == null)) return
        if (!current.galleryLoaded) {
            if (current.galleryJumpIndex != null) loadGalleryJump(current.galleryJumpIndex)
            else refreshGallery()
            return
        }
        if (current.error == null) return
        mutableState.value = current.copy(error = null)
        when (current.galleryPageIntent) {
            "newer" -> galleryLoadNewer()
            "older" -> galleryLoadOlder()
        }
    }

    fun galleryLoadOlder() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            current.loading || current.error != null || current.galleryOffset <= 0) return
        mutableState.value = current.copy(galleryPageIntent = "older")
        loadGallery(initialLatest = false)
    }

    /** A timeline jump starts at an exact Owner offset; append subsequent
     * verified pages instead of showing only its initial 60 photos. */
    fun galleryLoadNewer() {
        val current = state.value
        val nextOffset = current.galleryOffset.toLong() + current.galleryItems.size
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            current.loading || current.error != null ||
            nextOffset >= current.galleryTotal || nextOffset > Int.MAX_VALUE) return
        val offset = nextOffset.toInt()
        val service = api ?: return
        val search = current.gallerySearchQuery
        val kind = current.galleryMediaKind
        val albumId = current.gallerySelectedAlbum?.id
        mutableState.value = current.copy(galleryPageIntent = "newer")
        request { ticket ->
            val page = fetchGalleryPage(service, ticket, offset, false, search, kind, albumId)
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY || latest.gallerySearchQuery != search ||
                latest.galleryMediaKind != kind || latest.gallerySelectedAlbum?.id != albumId)
                throw CancellationException()
            if (!latest.galleryLoaded || page.totalCount != latest.galleryTotal ||
                page.offset != offset || page.items.isEmpty() ||
                latest.galleryOffset.toLong() + latest.galleryItems.size != offset.toLong() ||
                page.items.any { item -> latest.galleryItems.any { it.node.id == item.node.id } })
                throw ApiException(0, "Gallery newer range changed", ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(galleryItems = latest.galleryItems + page.items,
                error = null, galleryPageIntent = "")
        }
    }

    /** Jump ONLY by a Server-indexed Owner time group. */
    fun jumpGalleryToGroup(scale: String, key: String) {
        val current = state.value
        if (current.gallerySelectionMode || current.galleryMetadataWriteAttempted ||
            current.hasActiveNativeTransfer()) return
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            current.gallerySearchQuery.isNotEmpty() ||
            current.gallerySortBy != "captured" || current.gallerySortDir != "asc" ||
            session == null || api == null) return
        val group = current.galleryTimelineSets?.forScale(scale)
            ?.firstOrNull { it.key == key && it.itemCount > 0 } ?: return
        if (group.startIndex.toLong() >= current.galleryTotal) return
        invalidate()
        mutableState.value = current.withoutGallerySelection().copy(loading = false, error = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = false, fileDownloadSaved = false, fileDownloadError = null,
            fileDownloadBytes = 0, fileDownloadTotal = 0,
            galleryItems = emptyList(), galleryOffset = group.startIndex,
            galleryLoaded = false, gallerySelected = null, galleryViewer = null,
            galleryJumpIndex = group.startIndex,
            galleryJumpEpoch = current.galleryJumpEpoch + 1, galleryPageIntent = "jump")
        loadGalleryJump(group.startIndex)
    }

    private fun loadGalleryJump(offset: Int) {
        val current = state.value
        val service = api ?: return
        if (current.screen != Screen.GALLERY || current.loading ||
            current.galleryJumpIndex != offset || session == null) return
        val total = current.galleryTotal
        val search = current.gallerySearchQuery
        val kind = current.galleryMediaKind
        val albumId = current.gallerySelectedAlbum?.id
        request { ticket ->
            val page = fetchGalleryPage(service, ticket, offset, false, search, kind, albumId)
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY || latest.galleryJumpIndex != offset ||
                latest.gallerySearchQuery != search || latest.galleryMediaKind != kind ||
                latest.gallerySelectedAlbum?.id != albumId)
                throw CancellationException()
            if (page.offset != offset || page.totalCount != total || page.items.isEmpty() ||
                offset.toLong() + page.items.size > total)
                throw ApiException(0, "Gallery timeline range changed", ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(galleryItems = page.items, galleryLoaded = true,
                galleryOffset = page.offset, galleryPageIntent = "", error = null)
        }
    }

    private suspend fun fetchGalleryPage(
        service: XDriveService, ticket: Long, offset: Int, initialLatest: Boolean,
        search: String, kind: String, albumId: String? = null,
    ): GalleryPage = authenticated(service, ticket) {
        val sortBy = state.value.gallerySortBy
        val sortDir = state.value.gallerySortDir
        when {
            sortBy != "captured" || sortDir != "asc" ->
                service.gallerySortedPage(it, offset, initialLatest, search, kind, albumId,
                    sortBy, sortDir)
            albumId != null -> service.galleryAlbumPage(it, albumId, offset, initialLatest)
            kind.isNotEmpty() -> service.galleryKindPage(it, offset, initialLatest, search, kind)
            search.isNotEmpty() -> service.gallerySearchPage(it, offset, initialLatest, search)
            else -> service.galleryPage(it, offset, initialLatest)
        }
    }

    private fun loadGallery(initialLatest: Boolean) {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.loading || session == null) return
        val service = api ?: return
        val requestedOffset = if (initialLatest) 0 else (current.galleryOffset - 60).coerceAtLeast(0)
        val search = current.gallerySearchQuery
        val kind = current.galleryMediaKind
        val albumId = current.gallerySelectedAlbum?.id
        if (current.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS && albumId == null) return
        request { ticket ->
            val page = fetchGalleryPage(service, ticket, requestedOffset, initialLatest, search, kind, albumId)
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY || latest.gallerySearchQuery != search ||
                latest.galleryMediaKind != kind || latest.gallerySelectedAlbum?.id != albumId)
                throw CancellationException()
            if (initialLatest) {
                mutableState.value = latest.copy(
                    galleryItems = page.items, galleryOffset = page.offset,
                    galleryTotal = page.totalCount, galleryLoaded = true, error = null,
                    galleryTimelineSets = page.timeline, galleryJumpIndex = null,
                    galleryPageIntent = "")
            } else {
                // Offset < 60 requires a fixed-size page overlapping the existing
                // first rows. Validate exact IDs and revisions before prepending.
                val prefix = latest.galleryOffset - requestedOffset
                if (!latest.galleryLoaded || prefix <= 0 ||
                    page.totalCount != latest.galleryTotal || page.offset != requestedOffset ||
                    page.items.size < prefix) throw ApiException(
                    0, "Gallery range changed", ApiFailureReason.INVALID_RESPONSE)
                val overlap = page.items.drop(prefix)
                if (overlap.size > latest.galleryItems.size ||
                    overlap != latest.galleryItems.take(overlap.size))
                    throw ApiException(0, "Gallery overlapping range changed", ApiFailureReason.INVALID_RESPONSE)
                val incoming = page.items.take(prefix)
                if (incoming.any { item -> latest.galleryItems.any { it.node.id == item.node.id } })
                    throw ApiException(0, "Gallery duplicate Owner node", ApiFailureReason.INVALID_RESPONSE)
                mutableState.value = latest.copy(
                    galleryItems = incoming + latest.galleryItems,
                    galleryOffset = page.offset, galleryLoaded = true,
                    error = null, galleryPageIntent = "")
            }
        }
    }

    /** Files rows use exactly the Gallery Owner/revision JPEG transport,
     * sharing its four-request semaphore and enforcing the current visible
     * Files section before/after I/O. No original-file fallback. */
    suspend fun filesThumbnail(node: DriveNode): ByteArray? {
        val ticket = generation
        val service = api ?: return null
        val token = session?.accessToken ?: return null
        fun visible(): Boolean {
            val current = state.value
            if (current.screen != Screen.FILES || !nativeFileThumbnailCandidate(node)) return false
            val rows = if (current.filesSection == FilesSection.BROWSE) current.items
                else current.collectionItems.map { it.node }
            return rows.any { it == node }
        }
        if (!visible()) return null
        return try {
            galleryThumbnailLimit.withPermit {
                checkCurrent(ticket)
                if (api !== service || session?.accessToken != token || !visible()) return@withPermit null
                val raw = service.galleryThumbnail(token, node.id, node.revision)
                checkCurrent(ticket)
                if (api !== service || session?.accessToken != token || !visible()) null else raw
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null // Optional derivative absent/invalid; preserve the file glyph.
        }
    }

    /** Thumbnails reuse the live Owner session and the pinned API client.
     * They are individually cancellable (when tiles unmount) and at most four
     * concurrent requests. Never cache Bearer tokens or private bytes on disk. */
    suspend fun galleryThumbnail(item: GalleryAsset): ByteArray? {
        val ticket = generation
        val current = state.value
        val service = api ?: return null
        val token = session?.accessToken ?: return null
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            current.galleryItems.none { it == item } ||
            item.node.revision <= 0) return null
        return try {
            galleryThumbnailLimit.withPermit {
                checkCurrent(ticket)
                val raw = service.galleryThumbnail(token, item.node.id, item.node.revision)
                checkCurrent(ticket)
                if (state.value.screen != Screen.GALLERY ||
                    state.value.galleryItems.none { it == item }) null else raw
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null // Optional derived image absent; never expose raw Owner response.
        }
    }


    /** The Viewer may fall back to the existing small JPEG thumbnail when the
     * verified original exceeds 32 MiB or cannot decode on this device.
     * Never fetch an old Owner's thumbnail into an A -> B -> A Viewer session. */
    suspend fun galleryViewerThumbnail(item: GalleryAsset): ByteArray? {
        val epoch = galleryViewerEpoch
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryViewer != item ||
            current.galleryItems.none { it == item } ||
            item.mediaKind !in setOf("image", "video") ||
            item.node.type != "file" || item.node.revision <= 0 || !item.hasThumbnail) return null
        val bytes = galleryThumbnail(item) // Reuse 4 MiB bound, Owner Bearer and cancellation.
        if (galleryViewerEpoch != epoch || state.value.screen != Screen.GALLERY ||
            state.value.galleryViewer != item) throw CancellationException()
        return bytes
    }

    /** Gallery image Viewer is backed by the same revisioned Owner file API
     * used for SAF export. Opening a video must not fake native playback. */
    fun openGalleryViewer(item: GalleryAsset) {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.loading ||
            !current.galleryLoaded || current.gallerySelectionMode ||
            item.mediaKind !in setOf("image", "video") ||
            item.node.type != "file" || item.node.revision <= 0 ||
            current.galleryItems.none { it == item }) return
        cancelGalleryViewerPage()
        closeActiveVideoPlayback()
        galleryViewerEpoch++
        mutableState.value = state.value.copy(galleryViewer = item, gallerySelected = null)
    }

    /** A private Owner media session, tied to this one currently opened video.
     * It never survives exit, logout, account switch or Server switch. */
    fun openGalleryVideoPlayback(video: GalleryAsset): OwnerVideoPlayback? {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryViewer != video ||
            video.mediaKind != "video" || !current.galleryLoaded ||
            current.galleryItems.none { it == video } || video.node.revision <= 0) return null
        val token = session?.accessToken ?: return null
        val service = api ?: return null
        return try {
            val resource = service.galleryVideoPlayback(token, video.node)
            closeActiveVideoPlayback()
            activeVideoPlayback = resource
            resource
        } catch (_: Exception) {
            null
        }
    }

    /** The Go Server alone validates the Live Photo .livp or exact still/MOV
     * pair. A ticket only exists for the current authenticated Owner/Revision.
     * Never reuse the ordinary /files/:id/content Node ETag for these bytes. */
    suspend fun openGalleryLivePhotoPlayback(item: GalleryAsset): OwnerVideoPlayback? {
        val ticket = generation
        val epoch = galleryViewerEpoch
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryViewer != item ||
            !current.galleryLoaded || current.galleryItems.none { it == item } ||
            !item.livePhoto || item.mediaKind != "image" ||
            item.node.type != "file" || item.node.revision <= 0) return null
        val service = api ?: return null
        val resource = authenticated(service, ticket) { token ->
            service.galleryLivePhotoMotionPlayback(token, item.node)
        }
        try {
            checkCurrent(ticket)
            if (galleryViewerEpoch != epoch ||
                state.value.screen != Screen.GALLERY ||
                state.value.galleryViewer != item ||
                state.value.galleryItems.none { it == item }) throw CancellationException()
            closeActiveVideoPlayback()
            activeVideoPlayback = resource
            return resource
        } catch (cancelled: CancellationException) {
            resource.close()
            throw cancelled
        } catch (error: Exception) {
            resource.close()
            throw error
        }
    }

    fun closeGalleryVideoPlayback(resource: OwnerVideoPlayback) {
        if (activeVideoPlayback === resource) activeVideoPlayback = null
        resource.close()
    }

    private fun closeActiveVideoPlayback() {
        activeVideoPlayback?.close()
        activeVideoPlayback = null
    }

    /** Immediate verified image/video neighbors, never invent a missing Range.
     * The native Compose host already selects the correct image or Media3
     * renderer; do not skip videos or cross an unloaded Owner Range. */
    fun galleryViewerNeighbor(direction: Int): GalleryAsset? {
        val current = state.value
        val selected = current.galleryViewer ?: return null
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            direction !in listOf(-1, 1)) return null
        val index = current.galleryItems.indexOfFirst { it == selected }
        if (index < 0) return null
        return current.galleryItems.getOrNull(index + direction)?.takeIf {
            it.mediaKind in setOf("image", "video") && it.node.type == "file" &&
                it.node.revision > 0 && it.node.id > 0
        }
    }

    /** A Viewer swipe may cross exactly one unloaded Owner Range page.
     * The visible neighbor is never guessed from a thumbnail or local index.
     * While a page is pending, do not dispatch another swipe. */
    fun galleryViewerCanShift(direction: Int): Boolean {
        val current = state.value
        if (direction !in listOf(-1, 1) || current.screen != Screen.GALLERY ||
            current.viewerReturnToFiles ||
            !current.galleryLoaded || current.galleryViewer == null ||
            current.gallerySelected != null || current.galleryViewerPageBusy ||
            current.loading) return false
        if (galleryViewerNeighbor(direction) != null) return true
        val index = current.galleryItems.indexOfFirst { it == current.galleryViewer }
        if (index < 0) return false
        return if (direction == -1) {
            index == 0 && current.galleryOffset > 0
        } else {
            val end = current.galleryOffset.toLong() + current.galleryItems.size
            index == current.galleryItems.lastIndex && end < current.galleryTotal &&
                end <= Int.MAX_VALUE.toLong()
        }
    }

    /** Stop a speculative boundary GET before Owner, route, Viewer or item
     * identity changes. A noncooperative reply still fails the generation
     * and Viewer epoch checks below. */
    private fun cancelGalleryViewerPage() {
        galleryViewerPageJob?.cancel()
        galleryViewerPageJob = null
        val current = state.value
        if (current.galleryViewerPageDirection != 0 || current.galleryViewerPageBusy ||
            current.galleryViewerPageError != null) mutableState.value = current.copy(
                galleryViewerPageDirection = 0, galleryViewerPageBusy = false,
                galleryViewerPageError = null)
    }

    /** Only the same authenticated album/search/kind and stable total can extend
     * the currently opened Viewer. This independent read does not invalidate
     * the current image/Media3 player while the page is loading. */
    private fun loadViewerBoundary(direction: Int, starting: DriveState) {
        val source = starting.galleryViewer ?: return
        val service = api ?: return
        val ticket = generation
        val epoch = galleryViewerEpoch
        val before = starting.galleryItems
        val firstOffset = starting.galleryOffset
        val requested = if (direction == -1) (firstOffset - 60).coerceAtLeast(0)
            else (firstOffset.toLong() + before.size).toInt()
        val search = starting.gallerySearchQuery
        val kind = starting.galleryMediaKind
        val albumId = starting.gallerySelectedAlbum?.id
        val total = starting.galleryTotal
        mutableState.value = starting.copy(galleryViewerPageDirection = direction,
            galleryViewerPageBusy = true, galleryViewerPageError = null)
        galleryViewerPageJob = scope.launch {
            try {
                val page = fetchGalleryPage(service, ticket, requested, false, search, kind, albumId)
                checkCurrent(ticket)
                val latest = state.value
                if (galleryViewerEpoch != epoch || latest.screen != Screen.GALLERY ||
                    latest.galleryViewer != source || !latest.galleryLoaded ||
                    latest.galleryItems != before || latest.galleryOffset != firstOffset ||
                    latest.galleryTotal != total || latest.gallerySearchQuery != search ||
                    latest.galleryMediaKind != kind ||
                    latest.gallerySelectedAlbum?.id != albumId ||
                    latest.gallerySelected != null ||
                    !latest.galleryViewerPageBusy ||
                    latest.galleryViewerPageDirection != direction) throw CancellationException()
                if (page.offset != requested || page.totalCount != total ||
                    page.items.isEmpty() || requested.toLong() + page.items.size > total)
                    throw ApiException(0, "Viewer Owner range changed",
                        ApiFailureReason.INVALID_RESPONSE)
                val additions = if (direction == -1) {
                    val prefix = firstOffset - requested
                    val overlap = page.items.drop(prefix)
                    if (prefix <= 0 || page.items.size < prefix ||
                        overlap.size > before.size ||
                        overlap != before.take(overlap.size))
                        throw ApiException(0, "Viewer older range changed",
                            ApiFailureReason.INVALID_RESPONSE)
                    page.items.take(prefix)
                } else {
                    if (firstOffset.toLong() + before.size != requested.toLong())
                        throw ApiException(0, "Viewer newer offset changed",
                            ApiFailureReason.INVALID_RESPONSE)
                    page.items
                }
                if (additions.isEmpty() ||
                    additions.map { it.node.id }.toSet().size != additions.size ||
                    additions.any { added ->
                        added.node.id <= 0 || added.node.revision <= 0 ||
                            added.node.type != "file" ||
                            added.mediaKind !in setOf("image", "video") ||
                            before.any { it.node.id == added.node.id }
                    }) throw ApiException(0, "Viewer neighbor is not a verified Owner item",
                    ApiFailureReason.INVALID_RESPONSE)
                val next = if (direction == -1) additions.last() else additions.first()
                closeActiveVideoPlayback() // Close only when a genuine new item is ready.
                galleryViewerEpoch++ // Fence original/Live bytes from the previous item.
                mutableState.value = latest.copy(
                    galleryItems = if (direction == -1) additions + before else before + additions,
                    galleryOffset = if (direction == -1) requested else firstOffset,
                    galleryViewer = next, gallerySelected = null,
                    galleryViewerPageDirection = 0, galleryViewerPageBusy = false,
                    galleryViewerPageError = null)
            } catch (_: CancellationException) {
                // The Viewer or Owner changed. Never publish a delayed page.
            } catch (failure: Exception) {
                if (ticket == generation && galleryViewerEpoch == epoch &&
                    state.value.screen == Screen.GALLERY &&
                    state.value.galleryViewer == source &&
                    state.value.gallerySelected == null &&
                    state.value.galleryViewerPageBusy) {
                    if (failure is ApiException && failure.statusCode == 401) {
                        endSession(changeServer = false)
                    } else {
                        mutableState.value = state.value.copy(
                            galleryViewerPageBusy = false,
                            galleryViewerPageError =
                                "无法加载相邻媒体，请重试；若图库内容已变更，请返回图库刷新。")
                    }
                }
            } finally {
                if (galleryViewerPageJob === kotlin.coroutines.coroutineContext[Job])
                    galleryViewerPageJob = null
            }
        }
    }

    /** Loaded neighbors switch synchronously; missing range neighbors fetch
     * exactly one verified page with a visible error/retry state. */
    fun shiftGalleryViewer(direction: Int) {
        if (!galleryViewerCanShift(direction)) return
        val next = galleryViewerNeighbor(direction)
        if (next == null) {
            loadViewerBoundary(direction, state.value)
            return
        }
        cancelGalleryViewerPage()
        closeActiveVideoPlayback() // Cancel native Range before Compose retires Media3.
        galleryViewerEpoch++
        mutableState.value = state.value.copy(galleryViewer = next, gallerySelected = null)
    }

    fun dismissGalleryViewer() {
        val current = state.value
        if (current.galleryViewer == null) return
        cancelGalleryViewerPage()
        closeActiveVideoPlayback()
        galleryViewerEpoch++ // Reject stale non-cooperative results, including A -> B -> A.
        val latest = state.value
        mutableState.value = if (latest.viewerReturnToFiles) latest.copy(
            screen = Screen.FILES, viewerReturnToFiles = false,
            galleryViewer = null, gallerySelected = null,
            galleryItems = emptyList(), galleryOffset = 0, galleryTotal = 0,
            galleryLoaded = false, galleryTimelineSets = null,
            galleryPageIntent = "", galleryJumpIndex = null)
        else latest.copy(galleryViewer = null, gallerySelected = null)
    }

    /** Read a *single* compressed photo, never a second remote media transport.
     * The 32 MiB cap bounds temporary RAM. No raw bytes/token go to UI state,
     * disk cache, saved state or logging. Large originals need tiled decoding. */
    suspend fun galleryImageBytes(
        item: GalleryAsset,
        onProgress: (Long, Long?) -> Unit = { _, _ -> },
    ): ByteArray {
        val ticket = generation
        val epoch = galleryViewerEpoch
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryViewer != item ||
            item.mediaKind != "image" || item.node.type != "file" ||
            item.node.revision <= 0) throw CancellationException()
        val service = api ?: throw CancellationException()
        val currentProgress: (Long, Long?) -> Unit = { received, total ->
            if (ticket == generation && galleryViewerEpoch == epoch &&
                state.value.screen == Screen.GALLERY &&
                state.value.galleryViewer == item) onProgress(received, total)
        }
        // A reliable .livp is a ZIP *container*; decoding the entire Node as
        // an image is wrong. Go verifies the embedded still and returns only
        // its current signed, capped image resource. The suffix is only a
        // resource-selection hint; Go remains authoritative on validity.
        val embeddedStill = item.livePhoto &&
            item.node.name.endsWith(".livp", ignoreCase = true)
        if (embeddedStill) {
            val still = authenticated(service, ticket) { token ->
                service.galleryLivePhotoStill(token, item.node, currentProgress)
            }
            checkCurrent(ticket)
            if (galleryViewerEpoch != epoch || state.value.screen != Screen.GALLERY ||
                state.value.galleryViewer != item) throw CancellationException()
            return still
        }
        if (item.node.size !in 1L..(32L * 1024 * 1024)) {
            throw ApiException(413, "Image exceeds bounded native preview size")
        }
        val buffer = ByteArrayOutputStream(minOf(item.node.size.toInt(), 1024 * 1024))
        val count = authenticated(service, ticket) { token ->
            service.downloadFile(token, item.node, { buffer }) { received ->
                currentProgress(received, item.node.size)
            }
        }
        checkCurrent(ticket)
        if (galleryViewerEpoch != epoch || state.value.screen != Screen.GALLERY ||
            state.value.galleryViewer != item) throw CancellationException()
        if (count != item.node.size || buffer.size().toLong() != count)
            throw ApiException(0, "Image length mismatch", ApiFailureReason.INVALID_RESPONSE)
        return buffer.toByteArray()
    }

    fun showGalleryInfo(item: GalleryAsset) {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryItems.none { it == item }) return
        // Opening Info is a user navigation decision. It must retire any
        // outstanding Viewer boundary GET before the dialog is displayed.
        cancelGalleryViewerPage()
        mutableState.value = state.value.copy(gallerySelected = item)
    }

    fun dismissGalleryInfo() {
        mutableState.value = state.value.copy(gallerySelected = null,
            fileExportPending = null, fileExportOrigin = null)
    }

    /** Jump to an already-visited ancestor without trusting an unverified path. */
    fun navigateToAncestor(index: Int) {
        val current = state.value
        if (!current.canNavigateFiles() || current.filesSection != FilesSection.BROWSE ||
            index < 0 || index >= current.path.lastIndex) return
        load(current.path.take(index + 1), 0)
    }

    fun back() {
        val current = state.value
        // Until native transfers are durable, user navigation cannot discard
        // an in-flight SAF document. The explicit cancel control remains available.
        if (current.hasActiveNativeTransfer()) return
        if (current.screen == Screen.TRASH) {
            closeTrash()
            return
        }
        if (current.screen == Screen.GALLERY) {
            when {
                current.galleryMapOpen -> closeGalleryMapOverview()
                current.gallerySelectionMode -> {
                    if (current.galleryMetadataWriteAttempted) {
                        if (!current.loading) refreshGallery() // GET-only reconciliation
                    } else setGallerySelectionMode(false)
                }
                current.gallerySelected != null -> dismissGalleryInfo()
                current.galleryViewer != null -> dismissGalleryViewer()
                current.gallerySelectedAlbum != null -> closeGalleryAlbum()
                current.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS -> openGalleryLibrary()
                else -> openFilesApp()
            }
            return
        }
        if (current.filesPdfViewer != null) {
            dismissFilesPdfViewer()
            return
        }
        if (current.filesAudioViewer != null) {
            dismissFilesAudioViewer()
            return
        }
        if (current.destinationKind != null) dismissDestination()
        else if (current.browseSelectionMode) {
            mutableState.value = current.copy(
                browseSelectionMode = false, browseSelectedIds = emptySet())
        }
        else if (current.selected != null) dismissDetails()
        else if (current.filesSection == FilesSection.SEARCH) changeFilesSection(current.searchReturnSection)
        else if (current.filesSection != FilesSection.BROWSE) changeFilesSection(FilesSection.BROWSE)
        else if (current.path.size > 1 && current.canNavigateFiles())
            load(current.path.dropLast(1), 0)
    }
    // Refresh from first Server-authoritative browse page, or restart the
    // bounded current Recent/Favorites/Search query; never mix stale cursors.
    fun refresh() {
        val current = state.value
        if (!current.canNavigateFiles() && !current.canReconcileBatchBrowse()) return
        // Read the full authoritative first page after a lost write ACK.
        if (current.filesSection == FilesSection.BROWSE) load(current.path, 0)
        else loadCollection()
    }
    fun retry() {
        val current = state.value
        if (current.canReconcileBatchBrowse()) {
            load(current.path, 0) // GET-only; never replay the uncertain batch DELETE.
            return
        }
        if (!current.canNavigateFiles()) return
        if (current.filesSection == FilesSection.BROWSE) {
            if (retryPrepend) loadPrevious(retryFailed = true)
            else load(retryPath ?: state.value.path, retryOffset, retryAppend)
        }
        else if (state.value.filesSection == FilesSection.SEARCH &&
            state.value.collectionLoaded && state.value.searchNextCursor.isNotBlank())
            loadMoreSearch(retryFailed = true)
        else loadCollection()
    }
    fun loadMore() {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.destinationKind != null || current.loading || current.error != null ||
            !current.hasNext || current.path.isEmpty() ||
            current.fileExportPending != null) return
        load(current.path, current.offset + 100, append = true)
    }
    /** Prepend a single authenticated page on reverse scroll, preserving the
     * visible item and original exact selected Node using stable Lazy keys. */
    fun loadPrevious(retryFailed: Boolean = false) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.destinationKind != null || current.loading ||
            (current.error != null && !retryFailed) || !current.hasPrevious ||
            current.fileExportPending != null || session == null) return
        val service = api ?: return
        val expected = current.browseWindowStart
        val offset = (expected - 100).coerceAtLeast(0)
        val path = current.path
        retryPrepend = true
        request(discardableRead = true) { ticket ->
            val page = authenticated(service, ticket) {
                service.childrenArranged(it, path.last().id, offset, current.filesArrangement)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.FILES || latest.filesSection != FilesSection.BROWSE ||
                latest.path != path || !latest.loaded || latest.browseWindowStart != expected ||
                page.offset != offset || page.totalCount != latest.totalCount ||
                page.items.size != expected - offset ||
                page.items.any { row -> latest.items.any { it.id == row.id } })
                throw ApiException(0, "Previous directory range changed", ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(
                items = page.items + latest.items, browseWindowStart = offset,
                filesGroups = if (offset == 0) page.groups else latest.filesGroups,
                focusedBrowseIndex = latest.focusedBrowseIndex + page.items.size,
                error = null,
            )
            retryPrepend = false
        }
    }

    // Compatibility entry points; native Files UI uses loadMore instead.
    fun nextPage() { if (state.value.filesSection == FilesSection.BROWSE && state.value.hasNext && !state.value.loading) load(state.value.path, state.value.offset + 100) }
    fun previousPage() { if (state.value.filesSection == FilesSection.BROWSE && state.value.offset > 0 && !state.value.loading) load(state.value.path, (state.value.offset - 100).coerceAtLeast(0)) }

    /** A new sort is committed only after its first Server-authenticated Range
     * arrives. Failed sorts preserve the previous rows/order/scroll snapshot. */
    fun changeFilesArrangement(target: FileBrowseArrangement) {
        val current = state.value
        if (!current.canNavigateFiles() || current.filesSection != FilesSection.BROWSE ||
            current.path.isEmpty() || !current.loaded || current.browseSelectionMode ||
            current.error != null || current.filesArrangement == target ||
            current.filesPdfViewer != null || current.filesAudioViewer != null ||
            session == null) return
        val service = api ?: return
        val path = current.path.toList()
        request(discardableRead = true) { ticket ->
            val page = authenticated(service, ticket) {
                service.childrenArranged(it, path.last().id, 0, target)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.FILES || latest.filesSection != FilesSection.BROWSE ||
                latest.path != path || latest.filesArrangement != current.filesArrangement)
                throw CancellationException()
            if (page.offset != 0 || page.totalCount < 0 ||
                (target.group != "none" && page.totalCount > 0L &&
                    page.groups.isEmpty()) ||
                page.items.size.toLong() != minOf(100L, page.totalCount) ||
                page.items.map { it.id }.toSet().size != page.items.size ||
                page.items.any { it.parentId != path.last().id })
                throw ApiException(0, "Changed Files arrangement Range invalid",
                    ApiFailureReason.INVALID_RESPONSE)
            mutableState.value = latest.copy(
                filesArrangement = target, items = page.items, loaded = true,
                offset = 0, browseWindowStart = 0, totalCount = page.totalCount,
                filesGroups = page.groups,
                focusedBrowseNodeId = null, focusedBrowseIndex = 0,
                focusedBrowseEpoch = latest.focusedBrowseEpoch + 1,
                browseSelectionMode = false, browseSelectedIds = emptySet(),
                selected = null, error = null,
                fileExportPending = null, fileDownloadSaved = false,
            )
            retryPath = path
            retryOffset = 0
            retryAppend = false
            retryPrepend = false
        }
    }

    private fun load(path: List<DriveNode>, offset: Int, append: Boolean = false) {
        val service = api ?: return
        if (session == null || state.value.filesSection != FilesSection.BROWSE) return
        retryPath = path.toList()
        retryOffset = offset
        retryAppend = append
        retryPrepend = false
        request(discardableRead = true) { loadWithin(service, path, offset, it, append) }
    }

    private suspend fun loadWithin(service: XDriveService, path: List<DriveNode>, offset: Int, ticket: Long, append: Boolean = false) {
        // Login, owner switch, an ancestor jump and folder short-tap all enter
        // here without load(); a failed previous-page retry must not survive.
        if (!append) retryPrepend = false
        retryPath = path.toList()
        retryOffset = offset
        retryAppend = append
        val resolved = if (path.isEmpty()) listOf(authenticated(service, ticket) { service.root(it) }) else path
        checkCurrent(ticket)
        val arrangement = state.value.filesArrangement
        val page = authenticated(service, ticket) {
            service.childrenArranged(it, resolved.last().id, offset, arrangement)
        }
        checkCurrent(ticket)
        val previous = state.value
        if (append && (!previous.loaded || previous.path != resolved || page.offset != offset))
            throw ApiException(0, "Directory page changed", ApiFailureReason.INVALID_RESPONSE)
        if (append && arrangement.group != "none" && previous.filesGroups.isNotEmpty() &&
            (previous.totalCount != page.totalCount ||
                page.items.any { incoming -> previous.items.any { it.id == incoming.id } }))
            throw ApiException(0, "Grouped Owner directory changed during pagination",
                ApiFailureReason.INVALID_RESPONSE)
        // Do not spin through thousands of speculative empty/duplicate pages
        // when a stale count disagrees with the actual Server range.
        if (page.items.isEmpty() && page.totalCount > offset)
            throw ApiException(0, "Empty range with remaining count", ApiFailureReason.INVALID_RESPONSE)
        if (arrangement.group != "none" && offset == 0 &&
            page.totalCount > 0L && page.groups.isEmpty())
            throw ApiException(0, "Owner Files group index missing",
                ApiFailureReason.INVALID_RESPONSE)
        val rows = if (append) (previous.items + page.items).distinctBy { it.id } else page.items
        if (append && rows.size == previous.items.size && offset + 100L < page.totalCount)
            throw ApiException(0, "Repeated range without progress", ApiFailureReason.INVALID_RESPONSE)
        mutableState.value = previous.copy(
            path = resolved, items = rows, offset = page.offset, totalCount = page.totalCount,
            filesGroups = if (arrangement.group == "none") emptyList()
                else if (page.offset == 0) page.groups
                else if (previous.path == resolved &&
                    previous.filesArrangement == arrangement) previous.filesGroups
                else emptyList(),
            loaded = true, selected = null, error = null,
            browseWindowStart = if (append) previous.browseWindowStart else page.offset,
            focusedBrowseNodeId = if (append) previous.focusedBrowseNodeId else null,
            focusedBrowseIndex = if (append) previous.focusedBrowseIndex else 0,
            browseSelectionMode = if (append) previous.browseSelectionMode else false,
            browseSelectedIds = if (append) previous.browseSelectedIds else emptySet(),
            browseBatchWriteAttempted = if (append) previous.browseBatchWriteAttempted else false,
            fileExportPending = if (append) previous.fileExportPending else null,
            fileDownloadSaved = if (append) previous.fileDownloadSaved else false,
            fileUploadPickerParent = if (append) previous.fileUploadPickerParent else null,
            fileUploadActive = if (append) previous.fileUploadActive else false,
            fileUploadCommitted = previous.fileUploadCommitted && resolved == previous.path,
        )
    }

    private suspend fun <T> authenticated(
        service: XDriveService, ticket: Long, allowPasswordChange: Boolean = false, block: suspend (String) -> T,
    ): T {
        checkCurrent(ticket)
        val current = session ?: throw CancellationException()
        try {
            return block(current.accessToken)
        } catch (failure: ApiException) {
            if (failure.statusCode != 401 ||
                (allowPasswordChange && failure.reason == ApiFailureReason.CURRENT_PASSWORD_INCORRECT)) throw failure
        }
        checkCurrent(ticket)
        val refreshed = try {
            service.refresh(current.refreshToken)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // A lost refresh ACK can already have rotated the token. Do not keep an uncertain session.
            throw ApiException(401, "Session refresh failed")
        }
        checkCurrent(ticket)
        session = refreshed
        persistRefreshSession()
        if (refreshed.mustChangePassword && !allowPasswordChange) {
            // A token refresh may require password rotation while the
            // destination picker is open. Clear its Owner-private folder rows
            // before rendering the password screen.
            mutableState.value = state.value.withoutDestination().copy(
                screen = Screen.PASSWORD, path = emptyList(),
                items = emptyList(), loaded = false, collectionItems = emptyList(),
                collectionLoaded = false, selected = null, fileExportPending = null,
                fileDownloadSaved = false, fileUploadPickerParent = null,
                fileUploadActive = false, fileUploadCommitted = false,
                galleryItems = emptyList(), galleryOffset = 0, galleryTotal = 0,
                galleryLoaded = false, gallerySelected = null, galleryViewer = null,
                galleryPrimaryTab = GalleryPrimaryTab.LIBRARY,
                galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                gallerySelectedAlbum = null, trashItems = emptyList(), trashTotal = 0,
                trashLoaded = false, trashRestoreAttempted = false)
            throw CancellationException()
        }
        return block(refreshed.accessToken)
    }

    /** Any new Owner request cancels the prior transport, including SAF export.
     * Only the originating download request is allowed to keep download chrome;
     * a folder change, refresh, search or other request clears it immediately. */
    private fun request(
        isFileDownload: Boolean = false, isFileUpload: Boolean = false,
        discardableRead: Boolean = false,
        block: suspend (Long) -> Unit,
    ) {
        invalidate()
        val ticket = generation
        val prior = state.value
        mutableState.value = prior.copy(
            loading = true, discardableReadInFlight = discardableRead &&
                !isFileDownload && !isFileUpload,
            error = null, selected = null,
            filesPdfViewer = null, filesPdfBytes = 0,
            filesAudioViewer = null,
            fileExportPending = null, fileExportOrigin = null,
            fileDownloadActive = isFileDownload && prior.fileDownloadActive,
            fileDownloadSaved = false, fileDownloadError = null,
            fileDownloadBytes = if (isFileDownload) prior.fileDownloadBytes else 0,
            fileDownloadTotal = if (isFileDownload) prior.fileDownloadTotal else 0,
            fileUploadPickerParent = null,
            fileUploadActive = isFileUpload && prior.fileUploadActive,
            fileUploadCommitted = false,
            fileUploadBytes = if (isFileUpload) prior.fileUploadBytes else 0,
            fileUploadTotal = if (isFileUpload) prior.fileUploadTotal else 0,
        )
        active = scope.launch {
            try {
                block(ticket)
            } catch (_: CancellationException) {
                // Obsolete work is not an error; finally only affects its own generation.
            } catch (failure: Exception) {
                if (ticket == generation) {
                    val running = state.value.nativeTransfers.firstOrNull {
                        it.status == NativeTransferStatus.RUNNING
                    }
                    if (running != null) {
                        finishNativeTransfer(running.id,
                            if (isFileDownload) NativeTransferStatus.FAILED
                            else NativeTransferStatus.UNCONFIRMED)
                    }
                    if (failure is ApiException && failure.statusCode == 401 &&
                        failure.reason != ApiFailureReason.CURRENT_PASSWORD_INCORRECT && session != null) {
                        session = null
                        keepLogin = false
                        runCatching { sessionPersistence?.clear() }
                        retryPath = null
                        retryAppend = false
                        if (state.value.route.enabled) { (api as? Closeable)?.close(); api = null }
                        mutableState.value = DriveState(
                            screen = Screen.LOGIN, server = state.value.server, allowHttp = state.value.allowHttp,
                            route = state.value.route,
                            error = "登录已失效，请重新登录。",
                        )
                    } else if (isFileDownload) {
                        // Gallery/Files export errors are not Gallery Range errors:
                        // do not offer a misleading "retry older photos" action.
                        mutableState.value = state.value.copy(
                            fileDownloadActive = false, fileDownloadSaved = false,
                            fileDownloadError = safeError(failure))
                    } else if (state.value.fileUploadActive) {
                        // Finalize or its ACK may have been lost. Unfreeze controls,
                        // but never imply that a new upload is safe to auto-retry.
                        mutableState.value = state.value.copy(
                            fileUploadActive = false, fileUploadCommitted = false,
                            fileUploadPickerParent = null,
                            error = if (failure is ApiException && failure.statusCode == 409)
                                "上传目标名称冲突，请刷新目录后决定如何处理。"
                            else "上传结果未确认，请刷新目录检查；不要自动重复上传。",
                        )
                    } else if (state.value.trashRestoreAttempted) {
                        mutableState.value = state.value.copy(trashLoaded = false,
                            error = "恢复结果未确认，请刷新回收站核对，勿重复提交。")
                    } else if (state.value.galleryAlbumCreateAttempted) {
                        mutableState.value = state.value.copy(
                            galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                            error = "新建相册结果未确认，请刷新相册核对；不要重复提交。")
                    } else if (state.value.galleryAlbumCreateCommittedNeedsRefresh) {
                        mutableState.value = state.value.copy(
                            galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                            error = "相册已创建，但列表刷新失败；请只重试读取相册。")
                    } else if (state.value.galleryAlbumEditAttempted) {
                        mutableState.value = state.value.copy(
                            galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                            error = "相册操作结果未确认，请只刷新相册核对；不要重复提交。")
                    } else if (state.value.galleryAlbumEditCommittedNeedsRefresh) {
                        mutableState.value = state.value.copy(
                            galleryAlbums = emptyList(), galleryAlbumsLoaded = false,
                            error = "相册操作已提交，但列表刷新失败；请只重试读取相册。")
                    } else if (state.value.galleryMetadataWriteAttempted) {
                        mutableState.value = state.value.copy(
                            error = "图库批量操作结果未确认，请刷新核对后再操作；切勿重复提交。")
                    } else if (state.value.browseBatchWriteAttempted) {
                        // The Server may have committed an atomic batch before
                        // its ACK was lost. Do not leave the stale selection
                        // actionable; only a new GET can re-enable mutation.
                        mutableState.value = state.value.copy(
                            loaded = false, error = "批量操作结果未确认，请刷新目录核对后再操作。")
                    } else if (state.value.destinationWriteAttempted) {
                        // A lost copy/move ACK may have committed on the Server.
                        // Freeze further writes against this browse snapshot
                        // until the user explicitly returns and reloads it.
                        mutableState.value = state.value.copy(
                            loaded = false, error = "操作结果未确认，请取消并刷新原目录，切勿重复提交。")
                    } else mutableState.value = state.value.copy(error = safeError(failure))
                }
            } finally {
                if (ticket == generation) mutableState.value =
                    state.value.copy(loading = false, discardableReadInFlight = false,
                        destinationSubmitting = false)
            }
        }
    }

    fun logout() = endSession(changeServer = false)
    fun changeServer() = endSession(changeServer = true)

    private fun endSession(changeServer: Boolean) {
        val oldApi = api
        val oldSession = session
        invalidate()
        session = null
        keepLogin = false
        runCatching { sessionPersistence?.clear() }
        retryPath = null
        retryOffset = 0
        retryAppend = false
        api = if (!changeServer && !state.value.route.enabled) address?.let(serviceFactory) else null
        mutableState.value = DriveState(
            screen = if (changeServer) Screen.CONNECT else Screen.LOGIN,
            server = state.value.server, allowHttp = state.value.allowHttp,
            route = state.value.route,
        )
        scope.launch {
            try {
                if (oldSession != null && oldApi != null) withTimeout(10_000) { oldApi.logout(oldSession.refreshToken) }
            } catch (_: Exception) {
                // Local logout is certain, remote revocation is best effort. No raw server errors.
            } finally {
                if (oldApi !== api) (oldApi as? Closeable)?.close()
            }
        }
    }

    private fun invalidate() {
        cancelGalleryViewerPage()
        // This method also runs for logout, route switching and a superseding
        // Owner operation. Fence the old transfer before cancelling its Job.
        terminateNativeTransferOnCancellation()
        generation++
        active?.cancel()
        active = null
        stopTextPreview()
        val current = state.value
        if (current.fileTextPreview != null || current.fileTextPreviewLoading ||
            current.fileTextPreviewError != null)
            mutableState.value = current.copy(fileTextPreview = null,
                fileTextPreviewLoading = false, fileTextPreviewError = null)
        closeActiveVideoPlayback()
        filesPdfEpoch++
        audioViewerEpoch++
        audioPlaybackRequestEpoch++
    }
    private fun checkCurrent(ticket: Long) { if (ticket != generation) throw CancellationException() }
    override fun close() { invalidate(); session = null; (api as? Closeable)?.close(); api = null }

    private fun safeError(failure: Exception): String {
        when ((failure as? ApiException)?.reason) {
            ApiFailureReason.DNS -> return "服务器域名 DNS 解析失败。请检查域名和网络；内网连接可填写可选的内网 IP。"
            ApiFailureReason.CONNECTION -> return "连接被拒绝或不可达。请检查所选网络和服务器端口。"
            ApiFailureReason.TIMEOUT -> return "连接超时，请检查所选网络后重新连接。"
            ApiFailureReason.TLS -> return "HTTPS 证书验证失败。请检查域名与证书；不会自动切换连接。"
            ApiFailureReason.INVALID_RESPONSE -> return "服务器响应无效，请检查地址和服务状态。"
            else -> Unit
        }
        if (failure is ApiException && failure.reason == ApiFailureReason.CURRENT_PASSWORD_INCORRECT) {
            return "当前密码不正确，请重新输入。"
        }
        return when ((failure as? ApiException)?.statusCode) {
        400 -> "请求未被接受，请检查输入后重试。"
        401 -> "用户名或密码不正确，或登录已失效。"
        403 -> "当前账户无权执行此操作，请检查账户状态。"
        404 -> "文件夹不存在或已被移动，请刷新后重试。"
        409 -> "名称冲突或文件版本已变化，请刷新后重试。"
        412, 428 -> "文件版本校验失败，请刷新后重试。"
        429 -> "请求过于频繁，请稍后重试。"
        in 500..599 -> "服务器暂时不可用，请稍后重试。"
        else -> "连接失败或服务器响应无效。请检查网络、地址及 HTTPS 证书。"
        }
    }
}
