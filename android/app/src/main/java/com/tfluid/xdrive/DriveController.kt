package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.Closeable
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class Screen { CONNECT, LOGIN, PASSWORD, FILES }

data class DriveState(
    val screen: Screen = Screen.CONNECT,
    val server: String = "",
    val allowHttp: Boolean = false,
    val username: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val path: List<DriveNode> = emptyList(),
    val items: List<DriveNode> = emptyList(),
    val offset: Int = 0,
    val totalCount: Long = 0,
    val loaded: Boolean = false,
    val selected: DriveNode? = null,
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
) : Closeable {
    private val mutableState = MutableStateFlow(DriveState(server = initialServer, allowHttp = initialAllowHttp))
    val state = mutableState.asStateFlow()
    private var address: ServerAddress? = null
    private var api: XDriveService? = null
    private var session: AuthSession? = null // Never part of UI state or saved state.
    private var generation = 0L
    private var active: Job? = null
    private var retryPath: List<DriveNode>? = null
    private var retryOffset = 0

    fun connect(input: String, allowHttp: Boolean) {
        if (state.value.screen != Screen.CONNECT) return
        try {
            val next = ServerAddress.parse(input, allowHttp)
            val service = serviceFactory(next)
            invalidate()
            (api as? Closeable)?.close()
            api = service
            address = next
            saveConnection(next.url, allowHttp)
            mutableState.value = DriveState(screen = Screen.LOGIN, server = next.url, allowHttp = allowHttp)
        } catch (_: IllegalArgumentException) {
            mutableState.value = state.value.copy(error = "请输入有效的服务器地址，例如 https://drive.example；HTTP 需要明确允许。")
        }
    }

    fun login(username: String, password: String) {
        if (state.value.screen != Screen.LOGIN || state.value.loading) return
        if (username.isBlank() || password.isEmpty()) {
            mutableState.value = state.value.copy(error = "请输入用户名和密码。")
            return
        }
        val service = api ?: return
        request {
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
        if (state.value.screen != Screen.FILES || state.value.items.none { it == node }) return
        if (node.isDirectory) load(state.value.path + node, 0)
        else mutableState.value = state.value.copy(selected = node)
    }

    fun dismissDetails() { mutableState.value = state.value.copy(selected = null) }
    fun back() {
        if (state.value.selected != null) dismissDetails()
        else if (state.value.path.size > 1) load(state.value.path.dropLast(1), 0)
    }
    fun refresh() { if (state.value.screen == Screen.FILES) load(state.value.path, state.value.offset) }
    fun retry() { if (state.value.screen == Screen.FILES) load(retryPath ?: state.value.path, retryOffset) }
    fun nextPage() { if (state.value.hasNext && !state.value.loading) load(state.value.path, state.value.offset + 100) }
    fun previousPage() { if (state.value.offset > 0 && !state.value.loading) load(state.value.path, (state.value.offset - 100).coerceAtLeast(0)) }

    private fun load(path: List<DriveNode>, offset: Int) {
        val service = api ?: return
        if (session == null) return
        retryPath = path.toList()
        retryOffset = offset
        request { loadWithin(service, path, offset, it) }
    }

    private suspend fun loadWithin(service: XDriveService, path: List<DriveNode>, offset: Int, ticket: Long) {
        retryPath = path.toList()
        retryOffset = offset
        val resolved = if (path.isEmpty()) listOf(authenticated(service, ticket) { service.root(it) }) else path
        checkCurrent(ticket)
        val page = authenticated(service, ticket) { service.children(it, resolved.last().id, offset) }
        checkCurrent(ticket)
        mutableState.value = state.value.copy(
            path = resolved, items = page.items, offset = page.offset, totalCount = page.totalCount,
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
            mutableState.value = state.value.copy(screen = Screen.PASSWORD, path = emptyList(), items = emptyList(), loaded = false)
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
                        mutableState.value = DriveState(
                            screen = Screen.LOGIN, server = state.value.server, allowHttp = state.value.allowHttp,
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
        api = if (!changeServer) address?.let(serviceFactory) else null
        mutableState.value = DriveState(
            screen = if (changeServer) Screen.CONNECT else Screen.LOGIN,
            server = state.value.server, allowHttp = state.value.allowHttp,
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
