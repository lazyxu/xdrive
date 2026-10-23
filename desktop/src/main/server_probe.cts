// Desktop's pre-login reachability check must use Electron's Chromium TLS path,
// not Node's fetch (which may ignore an OS-trusted private Caddy root CA).
// The injected fetcher comes from net.fetch in Electron Main, never Renderer.
export type DesktopServerProbeResult =
  | { ok: true; data: { version: string } }
  | { ok: false; error: { code: string; message: string; status?: number } }

type ProbeFetch = (url: string, options: RequestInit) => Promise<Response>

function failure(code: string, message: string, status?: number): DesktopServerProbeResult {
  return { ok: false, error: { code, message, ...(status === undefined ? {} : { status }) } }
}

function errorHints(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let i = 0; i < 3 && current && typeof current === 'object'; i++) {
    const entry = current as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown }
    for (const value of [entry.code, entry.message, entry.name]) {
      if (typeof value === 'string') parts.push(value)
    }
    current = entry.cause
  }
  return parts.join(' ').toUpperCase()
}

function networkFailure(error: unknown, timedOut: boolean): DesktopServerProbeResult {
  const hints = errorHints(error)
  if (timedOut || /ABORTERROR|ERR_TIMED_OUT|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(hints)) {
    return failure('server_timeout', '服务器连接超时。请检查局域网连接、8443 端口及防火墙。')
  }
  if (/ERR_CERT_COMMON_NAME_INVALID|ERR_TLS_CERT_ALTNAME_INVALID|HOSTNAME_MISMATCH/.test(hints)) {
    return failure('server_tls_name', 'HTTPS 证书与服务器地址不匹配；证书的 IP SAN 必须包含当前局域网 IP。')
  }
  if (/ERR_CERT_DATE_INVALID|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID/.test(hints)) {
    return failure('server_tls_date', 'HTTPS 证书已过期或系统时间不正确；请检查证书有效期和设备时间。')
  }
  if (/ERR_CERT|CERTIFICATE|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|DEPTH_ZERO_SELF_SIGNED/.test(hints)) {
    return failure('server_tls_trust', 'HTTPS 证书校验失败。请先通过可信渠道核验并信任 xDrive Caddy 的本地根 CA，不要跳过证书验证。')
  }
  if (/ERR_SSL|EPROTO|WRONG_VERSION_NUMBER/.test(hints)) {
    return failure('server_tls_protocol', 'HTTPS 握手失败；请确认该端口确实提供 HTTPS，且 Caddy 已启用 IP 入口。')
  }
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(hints)) {
    return failure('server_refused', '服务器拒绝连接；请检查 Caddy 是否监听 8443、端口映射及防火墙。')
  }
  if (/ENETUNREACH|EHOSTUNREACH|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED/.test(hints)) {
    return failure('server_network', '服务器网络不可达；请检查本机是否能访问该局域网 IP。')
  }
  return failure('server_unreachable', '服务器暂时无法连接；请检查地址、网络、端口、系统代理或证书。')
}

export async function probeDesktopServer(
  serverValue: string,
  fetcher: ProbeFetch,
  timeoutMs = 5_000,
): Promise<DesktopServerProbeResult> {
  let target: URL
  try {
    target = new URL(serverValue.trim())
  } catch {
    return failure('invalid_server', '服务器地址格式无效，请填写完整的 http(s) 地址。')
  }
  if (
    (target.protocol !== 'https:' && target.protocol !== 'http:') ||
    target.username || target.password || target.pathname !== '/' ||
    target.search || target.hash
  ) {
    return failure('invalid_server', '服务器地址必须是 HTTP(S) 根地址，不能包含用户名、密码、路径、查询参数或锚点。')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // No login secrets, browser cookies, cache or cross-host redirects are used.
    // In particular, never disable TLS verification for a private-IP endpoint.
    const response = await fetcher(target.origin + '/api/v1/version', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    if (response.status >= 300 && response.status < 400) {
      return failure('server_auth_redirect',
        '当前入口将 xDrive API 请求重定向至其他地址。请检查 IP HTTPS 与 Caddy 配置；登录凭据不会被自动转发。',
        response.status)
    }
    if (!response.ok) {
      return failure('server_http_error', '服务器返回 HTTP ' + response.status + '；请检查网关及 xDrive Server。', response.status)
    }
    const contentType = response.headers.get('content-type') || ''
    if (!/\bapplication\/json\b/i.test(contentType)) {
      return failure('server_invalid_response', '服务器未返回 xDrive API 的 JSON 响应；请检查地址及反向代理配置。')
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof (payload as { version?: unknown }).version !== 'string' ||
        !(payload as { version: string }).version.trim()) {
      return failure('server_invalid_response', '服务器版本接口响应异常；请确认连接的是 xDrive Server。')
    }
    return { ok: true, data: { version: (payload as { version: string }).version.trim() } }
  } catch (error) {
    return networkFailure(error, controller.signal.aborted)
  } finally {
    clearTimeout(timer)
  }
}
