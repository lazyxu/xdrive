package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.Closeable
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class Screen { CONNECT, LOGIN, PASSWORD, FILES }
enum class FilesSection { RECENT, BROWSE, FAVORITES }

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
) {
    val hasNext get() = loaded && offset.toLong() + 100 < totalCount && offset <= Int.MAX_VALUE - 100
}

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
            state.value.items.none { it == node }) return
        if (node.isDirectory) load(state.value.path + node, 0)
        else showDetails(node)
    }

    /** Long-press details may include folders; never use a stale/foreign row. */
    fun showDetails(node: DriveNode) {
        val current = state.value
        if (current.screen != Screen.FILES) return
        val visible = if (current.filesSection == FilesSection.BROWSE) current.items.any { it == node }
            else current.collectionItems.any { it.node == node }
        if (!visible) return
        // The details surface belongs to the current UI generation, not a late append.
        if (state.value.loading) { invalidate(); mutableState.value = state.value.copy(loading = false) }
        mutableState.value = state.value.copy(selected = node)
    }

    fun dismissDetails() { mutableState.value = state.value.copy(selected = null) }

    fun changeFilesSection(next: FilesSection) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection == next) return
        invalidate() // Unmount/cancel old Owner range/collection before switching.
        mutableState.value = current.copy(filesSection = next, selected = null,
            loading = false, error = null, collectionItems = emptyList(), collectionLoaded = false)
        if (next == FilesSection.BROWSE) {
            if (!state.value.loaded) load(state.value.path, 0)
        } else loadCollection(next)
    }

    private fun loadCollection(section: FilesSection = state.value.filesSection) {
        val service = api ?: return
        if (session == null || state.value.screen != Screen.FILES ||
            section == FilesSection.BROWSE || state.value.filesSection != section) return
        request { ticket ->
            val entries = authenticated(service, ticket) { token ->
                if (section == FilesSection.RECENT) service.fileRecent(token)
                else service.fileFavorites(token)
            }
            checkCurrent(ticket)
            if (state.value.filesSection != section) return@request
            mutableState.value = state.value.copy(collectionItems = entries, collectionLoaded = true)
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
        val crumbs = if (item.node.isDirectory) item.crumbs else item.crumbs.dropLast(1)
        if (crumbs.isEmpty() || crumbs.size > 512) return
        val service = api ?: return
        if (session == null) return
        val candidate = crumbs.mapIndexed { index, crumb ->
            DriveNode(id = crumb.id, parentId = crumbs.getOrNull(index - 1)?.id, name = crumb.name, type = "dir")
        }
        invalidate()
        mutableState.value = current.copy(filesSection = FilesSection.BROWSE,
            collectionItems = emptyList(), collectionLoaded = false, error = null, loading = false, selected = null)
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

    /** Jump to an already-visited ancestor without trusting an unverified path. */
    fun navigateToAncestor(index: Int) {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            index < 0 || index >= current.path.lastIndex) return
        load(current.path.take(index + 1), 0)
    }

    fun back() {
        val current = state.value
        if (current.selected != null) dismissDetails()
        else if (current.filesSection != FilesSection.BROWSE) changeFilesSection(FilesSection.BROWSE)
        else if (current.path.size > 1) load(current.path.dropLast(1), 0)
    }
    // Refresh from first Server-authoritative browse page, or reload the
    // selected Recent/Favorites collection; never mix a stale browse offset.
    fun refresh() {
        if (state.value.screen != Screen.FILES) return
        if (state.value.filesSection == FilesSection.BROWSE) load(state.value.path, 0)
        else loadCollection()
    }
    fun retry() {
        if (state.value.screen != Screen.FILES) return
        if (state.value.filesSection == FilesSection.BROWSE)
            load(retryPath ?: state.value.path, retryOffset, retryAppend)
        else loadCollection()
    }
    fun loadMore() {
        val current = state.value
        if (current.screen != Screen.FILES || current.filesSection != FilesSection.BROWSE ||
            current.loading || current.error != null || !current.hasNext || current.path.isEmpty()) return
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
            mutableState.value = state.value.copy(screen = Screen.PASSWORD, path = emptyList(),
                items = emptyList(), loaded = false, collectionItems = emptyList(), collectionLoaded = false)
            throw CancellationException()
        }
        return block(refreshed.accessToken)
    }

    private fun request(block: suspend (Long) -> Unit) {
        invalidate()
        val ticket = generation
        mutableState.value = state.value.copy(loading = true, error = null, selected = null)
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
                    } else mutableState.value = state.value.copy(error = safeError(failure))
                }
            } finally {
                if (ticket == generation) mutableState.value = state.value.copy(loading = false)
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

    private fun invalidate() { generation++; active?.cancel(); active = null }
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
        409 -> "内容已发生变化，请刷新后重试。"
        429 -> "请求过于频繁，请稍后重试。"
        in 500..599 -> "服务器暂时不可用，请稍后重试。"
        else -> "连接失败或服务器响应无效。请检查网络、地址及 HTTPS 证书。"
        }
    }
}
