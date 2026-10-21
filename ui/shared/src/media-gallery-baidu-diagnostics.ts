/**
 * Map diagnostics are anonymous, bounded process-local observations, NOT
 * provider logs. Never retain URLs, errors, response bodies, credentials,
 * photo identity, GPS or external-script data here.
 */
export const XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS = 15 * 60 * 1000
const MAX_SCOPES = 8

export const xDriveBaiduMapDiagnosticDetails = {
  client_transport_missing: {
    title: '当前客户端没有完整的动态照片地图接口',
    action: '检查当前 Web / Desktop Agent 与 Server 版本；Desktop 使用独立 HTTPS 地图窗口，不得将 file: 页面直接接入 JSAPI。',
  },
  client_version_mismatch: {
    title: '地图 API 路由不受当前 Server 支持',
    action: '核对浏览器静态资源与正在运行的 Server / Agent 版本，并检查路由是否经 HTTPS 网关正确转发。',
  },
  status_access_denied: {
    title: '当前账户无法读取地图发布状态（HTTP 401/403）',
    action: '重新登录并检查 Owner 会话和访问权限；不要通过图库分享令牌调用账户地图接口。',
  },
  status_rate_limited: {
    title: '地图状态请求受到限流（HTTP 429）',
    action: '查看 Server 配额与限流配置，等待冷却后重试。',
  },
  status_unavailable: {
    title: '读取 Server 动态地图状态失败',
    action: '检查 HTTPS 网关、Server 连通性和浏览器网络；不能把状态请求失败当作地图已授权。',
  },
  server_release_blocked: {
    title: 'Server 尚未签名放行 JSAPI 4.0',
    action: '优先查看下方 Server 返回的 release_blockers；不要仅凭已保存 Browser AK 或启用开关判断生效。',
  },
  camera_unavailable: {
    title: '当前没有可用于初始化地图的授权照片位置',
    action: '确认选中了含有效位置且已显式授权的照片；地图不会将聚合网格中心伪装为原始 GPS。',
  },
  session_denied: {
    title: '地图专用会话签发被拒绝（HTTP 401/403）',
    action: '检查当前 Owner 登录、SessionVersion、地图授权 Epoch 和 HTTPS Host-only Cookie 条件。',
  },
  session_rate_limited: {
    title: '地图会话签发受到限流（HTTP 429）',
    action: '查看 Server 地图配额和请求频率，冷却后重试；不要循环重新签发。',
  },
  session_unavailable: {
    title: '地图专用会话签发失败',
    action: '检查签名发布状态、Server 日志与网关 Cookie/HTTPS 配置；此处不展示原始响应。',
  },
  session_timeout: {
    title: '地图专用会话签发超过 8 秒',
    action: '检查 Server/HTTPS 网关延迟、会话服务与地图配额，避免重复快速签发；此处不是 SDK 加载超时。',
  },
  https_origin_required: {
    title: '当前页面不是可用于百度动态地图的 HTTPS 页面',
    action: '地图 Loader 明确拒绝 HTTP、file: 和不可信浏览器 Origin。请检查系统依赖中的 Caddy HTTPS 状态及实际访问入口；使用可信 HTTPS 地址访问，不要降低地图安全限制。',
  },
  sdk_timeout: {
    title: '百度 JSAPI SDK 初始化超时（8 秒）',
    action: '检查固定 /_BMapService/api?v=4.0 及受控子资源的可达性、CSP 和浏览器脚本策略。',
  },
  sdk_load_failed: {
    title: '百度 JSAPI SDK 加载或初始化失败',
    action: '检查 /_BMapService/ 脚本资源、SDK 子资源白名单和浏览器 CSP；Server 签名通过不等于 SDK 加载通过。',
  },
  map_binding_failed: {
    title: 'SDK 地图对象缺少所需的原生能力',
    action: '检查实际 JSAPI 版本及 Map、ClusterLayer、getBounds 支持；不可将 BD-09 边界当作 WGS84。',
  },
  viewport_denied: {
    title: '当前照片地图视窗查询被拒绝（HTTP 401/403/409）',
    action: '检查 Owner、逐照片授权、会话/签名 Epoch 或旧修订是否已经变更；重新打开地图获取新快照。',
  },
  viewport_rate_limited: {
    title: '地图视窗查询受到限流（HTTP 429）',
    action: '检查当前聚合请求的有界查询频率、配额和取消行为。',
  },
  viewport_unavailable: {
    title: '已授权地图视窗查询失败',
    action: '检查 /cells、/native-viewport 对应 Server 请求的状态、PostgreSQL 和 Go Context 取消；旧结果不可回写。',
  },
  session_renew_failed: {
    title: '地图专用会话续期失败',
    action: '检查两分钟会话续期、Owner 登录有效性、地图 Epoch、Cookie/HTTPS 及前后台恢复；已失败的地图应立即退回静态模式。',
  },
} as const

export type XDriveBaiduMapDiagnosticCode = keyof typeof xDriveBaiduMapDiagnosticDetails
export type XDriveBaiduMapDiagnostic = Readonly<{
  code: XDriveBaiduMapDiagnosticCode
  recordedAt: number
}>

const entries = new Map<string, XDriveBaiduMapDiagnostic>()
const listeners = new Set<() => void>()
const validScope = (scope: unknown): scope is string =>
  typeof scope === 'string' && scope.length > 0 && scope.length <= 512 &&
  !/[\u0000-\u001f\u007f]/.test(scope)

function notify(): void {
  for (const callback of listeners) callback()
}

export function xDriveRecordBaiduMapDiagnostic(
  scope: string, code: XDriveBaiduMapDiagnosticCode,
): boolean {
  if (!validScope(scope) ||
      !Object.prototype.hasOwnProperty.call(xDriveBaiduMapDiagnosticDetails, code)) return false
  entries.delete(scope)
  entries.set(scope, { code, recordedAt: Date.now() })
  while (entries.size > MAX_SCOPES) entries.delete(entries.keys().next().value!)
  notify()
  return true
}

export function xDriveReadBaiduMapDiagnostic(
  scope: string,
): XDriveBaiduMapDiagnostic | null {
  if (!validScope(scope)) return null
  const value = entries.get(scope)
  if (!value) return null
  if (Date.now() - value.recordedAt >= XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS ||
      Date.now() < value.recordedAt) {
    entries.delete(scope)
    return null
  }
  return { ...value }
}

export function xDriveClearBaiduMapDiagnostic(scope: string): void {
  if (validScope(scope) && entries.delete(scope)) notify()
}

export function xDriveSubscribeBaiduMapDiagnostics(callback: () => void): () => void {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

/** Only a trusted HTTPS page may instantiate the browser SDK.
 * Never record or return the URL/hostname. */
export function xDriveBaiduMapHTTPSRequired(protocol: unknown): boolean {
  return protocol !== 'https:'
}

export function xDriveClassifyBaiduMapRequestFailure(
  phase: 'status' | 'session' | 'viewport', error: unknown,
): XDriveBaiduMapDiagnosticCode {
  // Deliberately inspect ONLY the numeric HTTP status; raw error strings,
  // credential-bearing URLs and provider responses must not enter this store.
  let status: unknown
  try {
    if (error && typeof error === 'object') {
      status = (error as { status?: unknown }).status
    }
  } catch { /* An untrusted getter is not diagnostic evidence. */ }
  if (status === 404 || status === 501) return 'client_version_mismatch'
  if (status === 429) return phase === 'status' ? 'status_rate_limited'
    : phase === 'session' ? 'session_rate_limited' : 'viewport_rate_limited'
  if (status === 401 || status === 403 || (phase === 'viewport' && status === 409)) {
    return phase === 'status' ? 'status_access_denied'
      : phase === 'session' ? 'session_denied' : 'viewport_denied'
  }
  return phase === 'status' ? 'status_unavailable'
    : phase === 'session' ? 'session_unavailable' : 'viewport_unavailable'
}
