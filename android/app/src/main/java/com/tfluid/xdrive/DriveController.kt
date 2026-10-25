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

enum class Screen { CONNECT, LOGIN, PASSWORD, FILES, GALLERY }
enum class FilesSection { RECENT, BROWSE, FAVORITES, SEARCH }
enum class FilesTransferKind { COPY, MOVE }

data class DriveState(
    val screen: Screen = Screen.CONNECT,
    val server: String = "",
    val allowHttp: Boolean = false,
    val route: ConnectionRoute = ConnectionRoute(),
    val connectionIp: String? = null,
    val username: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val path: List<DriveNode> = emptyList(),
    val items: List<DriveNode> = emptyList(),
    val offset: Int = 0,
    val totalCount: Long = 0,
    val loaded: Boolean = false,
    val selected: DriveNode? = null,
    val filesSection: FilesSection = FilesSection.BROWSE,
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
    val fileDownloadActive: Boolean = false,
    val fileDownloadSaved: Boolean = false,
    val fileDownloadBytes: Long = 0,
    val fileDownloadTotal: Long = 0,
    val fileUploadPickerParent: Long? = null,
    val fileUploadActive: Boolean = false,
    val fileUploadCommitted: Boolean = false,
    val fileUploadBytes: Long = 0,
    val fileUploadTotal: Long = 0,
    val galleryItems: List<GalleryAsset> = emptyList(),
    val galleryOffset: Int = 0,
    val galleryTotal: Long = 0,
    val galleryLoaded: Boolean = false,
    val gallerySelected: GalleryAsset? = null,
    val galleryViewer: GalleryAsset? = null,
    val destinationKind: FilesTransferKind? = null,
    val destinationSource: DriveNode? = null,
    val destinationPath: List<DriveNode> = emptyList(),
    val destinationFolders: List<DriveNode> = emptyList(),
    val destinationOffset: Int = 0,
    val destinationTotal: Long = 0,
    val destinationLoaded: Boolean = false,
    val destinationSubmitting: Boolean = false,
    val destinationWriteAttempted: Boolean = false,
) {
    val hasNext get() = loaded && offset.toLong() + 100 < totalCount && offset <= Int.MAX_VALUE - 100
    val destinationHasNext get() = destinationLoaded &&
        destinationOffset.toLong() + 100 < destinationTotal &&
        destinationOffset <= Int.MAX_VALUE - 100
}

private fun DriveState.withoutDestination(): DriveState = copy(
    destinationKind = null, destinationSource = null, destinationPath = emptyList(),
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
) : Closeable {
    private val mutableState = MutableStateFlow(DriveState(server = initialServer, allowHttp = initialAllowHttp,
        route = savedRoute(initialServer, initialAllowHttp)))
    val state = mutableState.asStateFlow()
    private var address: ServerAddress? = null
    private var api: XDriveService? = null
    private var session: AuthSession? = null // Never part of UI state or saved state.
    private var generation = 0L
    private var active: Job? = null
    private val galleryThumbnailLimit = Semaphore(4)
    private var activeVideoPlayback: OwnerVideoPlayback? = null
    private var galleryViewerEpoch = 0L
    private var retryPath: List<DriveNode>? = null
    private var retryOffset = 0
    private var retryAppend = false

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
            mutableState.value = state.value.copy(error = "请检查服务器地址及连接设置。内网仅支持私有 IP，公网仅支持公共 IP；连接方式设置需要 HTTPS 域名。")
        }
    }

    private fun install(next: ServerAddress, allowHttp: Boolean, route: ConnectionRoute, ip: String?) {
        api = if (ip == null) serviceFactory(next) else routedServiceFactory(next, ip)
        address = next
        saveConnection(next.url, allowHttp)
        saveRoute(next.url, route)
        mutableState.value = DriveState(screen = Screen.LOGIN, server = next.url, allowHttp = allowHttp, route = route, connectionIp = ip)
    }

    fun login(username: String, password: String) {
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
            mutableState.value = state.value.copy(
                screen = if (result.mustChangePassword) Screen.PASSWORD else Screen.FILES,
                username = result.username,
            )
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
            mutableState.value = state.value.copy(screen = if (result.mustChangePassword) Screen.PASSWORD else Screen.FILES)
            if (!result.mustChangePassword) loadWithin(service, emptyList(), 0, ticket)
        }
    }

    fun open(node: DriveNode) {
        if (state.value.screen != Screen.FILES || state.value.filesSection != FilesSection.BROWSE ||
            state.value.destinationKind != null || state.value.browseSelectionMode ||
            state.value.items.none { it == node }) return
        if (node.isDirectory) load(state.value.path + node, 0)
        else showDetails(node)
    }

    /** Long-press details may include folders; never use a stale/foreign row. */
    fun showDetails(node: DriveNode) {
        val current = state.value
        if (current.screen != Screen.FILES || current.destinationKind != null) return
        val visible = if (current.filesSection == FilesSection.BROWSE) current.items.any { it == node }
            else current.collectionItems.any { it.node == node }
        if (!visible) return
        // The details surface belongs to the current UI generation, not a late append.
        if (state.value.loading) { invalidate(); mutableState.value = state.value.copy(loading = false) }
        mutableState.value = state.value.copy(selected = node)
    }

    fun dismissDetails() { mutableState.value = state.value.copy(selected = null) }

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
        val current = editableBrowseState(node) ?: return false
        if (node.isDirectory || current.fileExportPending != null ||
            current.fileDownloadActive || node.size < 0) return false
        mutableState.value = current.copy(
            fileExportPending = node, fileDownloadBytes = 0,
            fileDownloadTotal = node.size, fileDownloadSaved = false, error = null)
        return true
    }

    fun cancelFileExport() {
        if (state.value.fileDownloadActive) return
        mutableState.value = state.value.copy(fileExportPending = null)
    }

    /** Caller owns the SAF URI; failure/cancellation must remove the partial document.
     * Download is read-only and never retries a request with an uncertain response. */
    fun saveFileExport(openOutput: () -> OutputStream, discardOutput: () -> Unit) {
        val current = state.value
        val node = current.fileExportPending
        val valid = node != null && current.screen == Screen.FILES &&
            current.filesSection == FilesSection.BROWSE && current.loaded &&
            !current.loading && !current.fileDownloadActive &&
            current.destinationKind == null && current.path.isNotEmpty() &&
            current.items.any { it == node } && node.parentId == current.path.last().id &&
            !node.isDirectory && node.revision > 0 && session != null
        if (!valid) {
            discardOutput()
            if (!current.fileDownloadActive) mutableState.value = current.copy(fileExportPending = null)
            return
        }
        val service = api ?: run {
            discardOutput()
            mutableState.value = current.copy(fileExportPending = null)
            return
        }
        val owned = node!!
        mutableState.value = current.copy(
            fileExportPending = null, fileDownloadActive = true,
            fileDownloadSaved = false, fileDownloadBytes = 0, fileDownloadTotal = owned.size)
        request(isFileDownload = true) { ticket ->
            var complete = false
            try {
                val written = authenticatedMutation(ticket) { token ->
                    service.downloadFile(token, owned, openOutput) { bytes ->
                        if (ticket == generation) {
                            mutableState.value = state.value.copy(fileDownloadBytes = bytes)
                        }
                    }
                }
                checkCurrent(ticket)
                complete = true
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
            loading = false, fileDownloadActive = false, fileExportPending = null,
            fileDownloadSaved = false, fileDownloadBytes = 0, fileDownloadTotal = 0,
            error = "下载已取消。")
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
            val result = authenticatedMutation(ticket) { token ->
                service.uploadFile(token, destination, name, size, openInput) { confirmed ->
                    if (ticket == generation)
                        mutableState.value = state.value.copy(fileUploadBytes = confirmed)
                }
            }
            checkCurrent(ticket)
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

    fun chooseDestination(node: DriveNode, kind: FilesTransferKind) {
        val current = editableBrowseState(node) ?: return
        val service = api ?: return
        mutableState.value = current.copy(
            destinationKind = kind, destinationSource = node,
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
        if (current.destinationSource?.isDirectory == true &&
            node.id == current.destinationSource.id) return
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
        if (current.destinationPath.isEmpty()) {
            val node = current.destinationSource ?: return
            val kind = current.destinationKind
            dismissDestination()
            chooseDestination(node, kind)
            return
        }
        val service = api ?: return
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

    /** No token refresh/replay for either physical copy or move commit. */
    fun commitDestination() {
        val current = state.value
        val source = current.destinationSource ?: return
        val kind = current.destinationKind ?: return
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.loading || current.destinationSubmitting || current.destinationWriteAttempted ||
            !current.destinationLoaded || current.error != null || current.destinationPath.isEmpty() ||
            current.path.isEmpty() || current.items.none { it == source } ||
            source.parentId != current.path.last().id) return
        val targetID = current.destinationPath.last().id
        if (kind == FilesTransferKind.MOVE && source.parentId == targetID) return
        if (source.isDirectory && current.destinationPath.any { it.id == source.id }) return
        val service = api ?: return
        val path = current.path.toList()
        mutableState.value = current.copy(
            destinationSubmitting = true, destinationWriteAttempted = true)
        request { ticket ->
            val result = authenticatedMutation(ticket) {
                if (kind == FilesTransferKind.COPY) service.copyNode(it, source, targetID)
                else service.moveNode(it, source, targetID)
            }
            checkCurrent(ticket)
            mutableState.value = state.value.withoutDestination()
            reconcileBrowseAfterCommit(service, path, ticket) { fresh ->
                if (kind == FilesTransferKind.MOVE) fresh.copy(
                    items = fresh.items.filterNot { it.id == source.id },
                    totalCount = (fresh.totalCount - 1).coerceAtLeast(0))
                else if (targetID == path.last().id) fresh.copy(
                    items = (fresh.items + result).distinctBy { it.id },
                    totalCount = fresh.totalCount + 1)
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
        if (current.screen != Screen.FILES || current.destinationKind != null ||
            current.filesSection == next || next == FilesSection.SEARCH) return
        invalidate() // Unmount/cancel old Owner range/collection before switching.
        mutableState.value = current.copy(filesSection = next, selected = null,
            loading = false, error = null, collectionItems = emptyList(), collectionLoaded = false,
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
        if (current.screen != Screen.FILES || current.destinationKind != null) return
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
        request { ticket ->
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
        request { ticket ->
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
        if (current.screen != Screen.FILES || current.filesSection == FilesSection.BROWSE ||
            current.collectionItems.none { it == item }) return
        if (item.node.isDirectory) locateCollectionItem(item) else showDetails(item.node)
    }

    /** Navigate using an authenticated Owner-scoped breadcrumb, recheck root
     * and last directory with the same Server API. Never trust a display path. */
    fun locateCollectionItem(item: DriveCollectionItem) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection == FilesSection.BROWSE ||
            current.collectionItems.none { it == item }) return
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
        request { ticket ->
            val root = authenticated(service, ticket) { service.root(it) }
            checkCurrent(ticket)
            if (root.id != candidate.first().id)
                throw ApiException(0, "Stale breadcrumb root", ApiFailureReason.INVALID_RESPONSE)
            loadWithin(service, listOf(root) + candidate.drop(1), 0, ticket)
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


    /** Native Gallery is a second app surface, not another Files section.
     * Files' verified Owner path remains in memory for a return to browsing. */
    fun openGallery() {
        val current = state.value
        if (current.screen != Screen.FILES || session == null || api == null ||
            current.fileUploadActive || current.fileDownloadActive ||
            current.destinationKind != null || current.browseBatchWriteAttempted) return
        invalidate()
        mutableState.value = current.copy(
            screen = Screen.GALLERY, loading = false, selected = null, error = null,
            fileExportPending = null, fileUploadPickerParent = null,
            browseSelectionMode = false, browseSelectedIds = emptySet(),
            galleryItems = emptyList(), galleryOffset = 0, galleryTotal = 0,
            galleryLoaded = false, gallerySelected = null, galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    fun openFilesApp() {
        val current = state.value
        if (current.screen != Screen.GALLERY) return
        invalidate() // Cancels the outstanding Gallery Range and item thumbnails.
        mutableState.value = current.copy(
            screen = Screen.FILES, loading = false, error = null,
            galleryItems = emptyList(), galleryOffset = 0, galleryTotal = 0,
            galleryLoaded = false, gallerySelected = null, galleryViewer = null)
        if (!state.value.loaded) refresh()
    }

    fun refreshGallery() {
        if (state.value.screen != Screen.GALLERY) return
        invalidate() // Stop prior Owner range before replacing its query intent.
        mutableState.value = state.value.copy(loading = false, error = null,
            galleryItems = emptyList(), galleryOffset = 0,
            galleryTotal = 0, galleryLoaded = false, gallerySelected = null,
            galleryViewer = null)
        loadGallery(initialLatest = true)
    }

    /** Retry the failed original Range without resetting existing Owner rows. */
    fun retryGallery() {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.loading) return
        if (!current.galleryLoaded) {
            refreshGallery()
        } else if (current.error != null && current.galleryOffset > 0) {
            mutableState.value = current.copy(error = null)
            loadGallery(initialLatest = false)
        }
    }

    fun galleryLoadOlder() {
        val current = state.value
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            current.loading || current.error != null || current.galleryOffset <= 0) return
        loadGallery(initialLatest = false)
    }

    private fun loadGallery(initialLatest: Boolean) {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.loading || session == null) return
        val service = api ?: return
        val requestedOffset = if (initialLatest) 0 else (current.galleryOffset - 60).coerceAtLeast(0)
        request { ticket ->
            val page = authenticated(service, ticket) {
                service.galleryPage(it, requestedOffset, initialLatest)
            }
            checkCurrent(ticket)
            val latest = state.value
            if (latest.screen != Screen.GALLERY) throw CancellationException()
            if (initialLatest) {
                mutableState.value = latest.copy(
                    galleryItems = page.items, galleryOffset = page.offset,
                    galleryTotal = page.totalCount, galleryLoaded = true, error = null)
            } else {
                if (!latest.galleryLoaded || page.totalCount != latest.galleryTotal ||
                    page.offset != requestedOffset ||
                    page.offset + page.items.size != latest.galleryOffset ||
                    page.items.any { item ->
                        latest.galleryItems.any { it.node.id == item.node.id }
                    }) throw ApiException(0, "Gallery range changed", ApiFailureReason.INVALID_RESPONSE)
                mutableState.value = latest.copy(
                    galleryItems = page.items + latest.galleryItems,
                    galleryOffset = page.offset, galleryLoaded = true, error = null)
            }
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


    /** Gallery image Viewer is backed by the same revisioned Owner file API
     * used for SAF export. Opening a video must not fake native playback. */
    fun openGalleryViewer(item: GalleryAsset) {
        val current = state.value
        if (current.screen != Screen.GALLERY || current.loading ||
            !current.galleryLoaded || item.mediaKind !in setOf("image", "video") ||
            item.node.type != "file" || item.node.revision <= 0 ||
            current.galleryItems.none { it == item }) return
        closeActiveVideoPlayback()
        galleryViewerEpoch++
        mutableState.value = current.copy(galleryViewer = item, gallerySelected = null)
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

    fun closeGalleryVideoPlayback(resource: OwnerVideoPlayback) {
        if (activeVideoPlayback === resource) activeVideoPlayback = null
        resource.close()
    }

    private fun closeActiveVideoPlayback() {
        activeVideoPlayback?.close()
        activeVideoPlayback = null
    }

    /** Immediate verified image neighbors, never invent a missing Range. */
    fun galleryViewerNeighbor(direction: Int): GalleryAsset? {
        val current = state.value
        val selected = current.galleryViewer ?: return null
        if (current.screen != Screen.GALLERY || !current.galleryLoaded ||
            direction !in listOf(-1, 1)) return null
        val index = current.galleryItems.indexOfFirst { it == selected }
        if (index < 0) return null
        return current.galleryItems.getOrNull(index + direction)?.takeIf {
            it.mediaKind == "image" && it.node.type == "file" &&
                it.node.revision > 0 && it.node.id > 0
        }
    }

    /** A new image invalidates in-flight old original reads (including the
     * noncooperative old-A -> B -> A case) without refetching Gallery rows. */
    fun shiftGalleryViewer(direction: Int) {
        val next = galleryViewerNeighbor(direction) ?: return
        if (state.value.gallerySelected != null) return // Info dialog has priority.
        galleryViewerEpoch++
        mutableState.value = state.value.copy(galleryViewer = next, gallerySelected = null)
    }

    fun dismissGalleryViewer() {
        if (state.value.galleryViewer == null) return
        closeActiveVideoPlayback()
        galleryViewerEpoch++ // Reject stale non-cooperative results, including A -> B -> A.
        mutableState.value = state.value.copy(galleryViewer = null, gallerySelected = null)
    }

    /** Read a *single* compressed photo, never a second remote media transport.
     * The 32 MiB cap bounds temporary RAM. No raw bytes/token go to UI state,
     * disk cache, saved state or logging. Large originals need tiled decoding. */
    suspend fun galleryImageBytes(item: GalleryAsset): ByteArray {
        val ticket = generation
        val epoch = galleryViewerEpoch
        val current = state.value
        if (current.screen != Screen.GALLERY || current.galleryViewer != item ||
            item.mediaKind != "image" || item.node.type != "file" ||
            item.node.revision <= 0) throw CancellationException()
        if (item.node.size !in 1L..(32L * 1024 * 1024)) {
            throw ApiException(413, "Image exceeds bounded native preview size")
        }
        val service = api ?: throw CancellationException()
        val buffer = ByteArrayOutputStream(minOf(item.node.size.toInt(), 1024 * 1024))
        val count = authenticated(service, ticket) { token ->
            service.downloadFile(token, item.node, { buffer })
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
        mutableState.value = current.copy(gallerySelected = item)
    }

    fun dismissGalleryInfo() {
        mutableState.value = state.value.copy(gallerySelected = null)
    }

    /** Jump to an already-visited ancestor without trusting an unverified path. */
    fun navigateToAncestor(index: Int) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.destinationKind != null || index < 0 || index >= current.path.lastIndex) return
        load(current.path.take(index + 1), 0)
    }

    fun back() {
        val current = state.value
        if (current.screen == Screen.GALLERY) {
            when {
                current.gallerySelected != null -> dismissGalleryInfo()
                current.galleryViewer != null -> dismissGalleryViewer()
                else -> openFilesApp()
            }
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
        else if (current.path.size > 1) load(current.path.dropLast(1), 0)
    }
    // Refresh from first Server-authoritative browse page, or restart the
    // bounded current Recent/Favorites/Search query; never mix stale cursors.
    fun refresh() {
        if (state.value.screen != Screen.FILES || state.value.destinationKind != null) return
        if (state.value.filesSection == FilesSection.BROWSE) load(state.value.path, 0)
        else loadCollection()
    }
    fun retry() {
        if (state.value.screen != Screen.FILES || state.value.destinationKind != null) return
        if (state.value.filesSection == FilesSection.BROWSE)
            load(retryPath ?: state.value.path, retryOffset, retryAppend)
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
    // Compatibility entry points; native Files UI uses loadMore instead.
    fun nextPage() { if (state.value.filesSection == FilesSection.BROWSE && state.value.hasNext && !state.value.loading) load(state.value.path, state.value.offset + 100) }
    fun previousPage() { if (state.value.filesSection == FilesSection.BROWSE && state.value.offset > 0 && !state.value.loading) load(state.value.path, (state.value.offset - 100).coerceAtLeast(0)) }

    private fun load(path: List<DriveNode>, offset: Int, append: Boolean = false) {
        val service = api ?: return
        if (session == null || state.value.filesSection != FilesSection.BROWSE) return
        retryPath = path.toList()
        retryOffset = offset
        retryAppend = append
        request { loadWithin(service, path, offset, it, append) }
    }

    private suspend fun loadWithin(service: XDriveService, path: List<DriveNode>, offset: Int, ticket: Long, append: Boolean = false) {
        retryPath = path.toList()
        retryOffset = offset
        retryAppend = append
        val resolved = if (path.isEmpty()) listOf(authenticated(service, ticket) { service.root(it) }) else path
        checkCurrent(ticket)
        val page = authenticated(service, ticket) { service.children(it, resolved.last().id, offset) }
        checkCurrent(ticket)
        val previous = state.value
        if (append && (!previous.loaded || previous.path != resolved || page.offset != offset))
            throw ApiException(0, "Directory page changed", ApiFailureReason.INVALID_RESPONSE)
        // Do not spin through thousands of speculative empty/duplicate pages
        // when a stale count disagrees with the actual Server range.
        if (page.items.isEmpty() && page.totalCount > offset)
            throw ApiException(0, "Empty range with remaining count", ApiFailureReason.INVALID_RESPONSE)
        val rows = if (append) (previous.items + page.items).distinctBy { it.id } else page.items
        if (append && rows.size == previous.items.size && offset + 100L < page.totalCount)
            throw ApiException(0, "Repeated range without progress", ApiFailureReason.INVALID_RESPONSE)
        mutableState.value = previous.copy(
            path = resolved, items = rows, offset = page.offset, totalCount = page.totalCount,
            loaded = true, selected = null, error = null,
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
                galleryLoaded = false, gallerySelected = null, galleryViewer = null)
            throw CancellationException()
        }
        return block(refreshed.accessToken)
    }

    /** Any new Owner request cancels the prior transport, including SAF export.
     * Only the originating download request is allowed to keep download chrome;
     * a folder change, refresh, search or other request clears it immediately. */
    private fun request(
        isFileDownload: Boolean = false, isFileUpload: Boolean = false,
        block: suspend (Long) -> Unit,
    ) {
        invalidate()
        val ticket = generation
        val prior = state.value
        mutableState.value = prior.copy(
            loading = true, error = null, selected = null,
            fileExportPending = null,
            fileDownloadActive = isFileDownload && prior.fileDownloadActive,
            fileDownloadSaved = false,
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
                    if (failure is ApiException && failure.statusCode == 401 &&
                        failure.reason != ApiFailureReason.CURRENT_PASSWORD_INCORRECT && session != null) {
                        session = null
                        retryPath = null
                        retryAppend = false
                        if (state.value.route.enabled) { (api as? Closeable)?.close(); api = null }
                        mutableState.value = DriveState(
                            screen = Screen.LOGIN, server = state.value.server, allowHttp = state.value.allowHttp,
                            route = state.value.route,
                            error = "登录已失效，请重新登录。",
                        )
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
                    state.value.copy(loading = false, destinationSubmitting = false)
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
        generation++
        active?.cancel()
        active = null
        closeActiveVideoPlayback()
    }
    private fun checkCurrent(ticket: Long) { if (ticket != generation) throw CancellationException() }
    override fun close() { invalidate(); session = null; (api as? Closeable)?.close(); api = null }

    private fun safeError(failure: Exception): String {
        when ((failure as? ApiException)?.reason) {
            ApiFailureReason.DNS -> return "DNS 解析失败，未找到可用公网地址。可填写公网 IP。"
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
