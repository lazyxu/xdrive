/**
 * Map diagnostics are anonymous, bounded process-local observations, NOT
 * provider logs. Never retain URLs, errors, response bodies, credentials,
 * photo identity, GPS or external-script data here.
 */
export const XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS = 15 * 60 * 1000
const MAX_SCOPES = 8

export const xDriveBaiduMapDiagnosticDetails = {
  prototype_config_unavailable: {
    title: "图库无法读取 Browser AK 配置",
    action: "检查图库 /media/places/baidu-jsapi/prototype 的 HTTP 状态与 Server/Agent 连通性；HTTP 503 可能是 AK 未启用、密钥不可用或服务故障；Server 固定 Loader 校验通过不能证明此路由正常。",
  },
  prototype_config_denied: {
    title: "图库配置接口拒绝访问（HTTP 401/403）",
    action: "检查 Owner 登录状态、会话及访问权限，不要使用分享令牌读取地图配置。",
  },
  prototype_config_unsupported: {
    title: "图库配置接口不存在（HTTP 404/501）",
    action: "核对 Web/Mobile Web、Desktop Agent、Server 版本及代理转发规则。",
  },
  prototype_config_rate_limited: {
    title: "图库配置接口受到限流（HTTP 429）",
    action: "查看 Server 地图相关限流，并在冷却后重新打开地图。",
  },
  prototype_config_invalid: {
    title: "图库收到的 Browser AK 配置无效",
    action: "检查管理员启用状态和 Server 返回的 provider/配置结构，不展示 Browser AK 明文。",
  },
  prototype_ak_rotated: {
    title: "浏览器页面已加载另一修订的 Browser AK",
    action: "完整刷新当前图库页面以加载新修订，不能在一个 document 混用密钥。",
  },
  prototype_document_unavailable: {
    title: "浏览器文档无法运行地图 SDK",
    action: "检查当前 WebView/document 的生命周期和脚本执行环境。",
  },
  prototype_csp_script_blocked: {
    title: "浏览器 CSP 明确阻止百度 JSAPI",
    action: "浏览器强制执行的 script-src/script-src-elem 阻止 api.map.baidu.com；核对实际页面 CSP，勿禁用 CSP；诊断不保存完整脚本 URL 或 AK。",
  },
  prototype_sdk_script_failed: {
    title: "浏览器加载百度脚本失败（script.onerror）",
    action: "图库原型直接访问 api.map.baidu.com，不走 Server 固定 Loader。检查浏览器 Network/CSP、域名白名单、DNS/HTTPS 或百度响应状态；跨域 script.onerror 不能给出完整百度错误正文。",
  },
  prototype_sdk_script_timeout: {
    title: "百度 JSAPI 启动脚本加载超时（12 秒）",
    action: "检查当前浏览器的百度 CDN、DNS、代理及 HTTPS；固定 Server Loader 成功不代表客户端直连成功。",
  },
  prototype_sdk_callback_timeout: {
    title: "百度启动脚本已加载，但官方异步就绪回调未触发",
    action: "当前页面已请求 JSAPI4 的 callback 就绪通知，但在 12 秒内未收到；检查 SDK 后续资源、浏览器 CSP 与 Browser AK 授权，不能从 script.onload 推断 BMap 已就绪。固定 Server Loader 检测不代表浏览器初始化成功。",
  },
  prototype_sdk_namespace_missing: {
    title: "官方回调已触发，但 BMap 命名空间仍不可用",
    action: "检查百度动态子资源、Browser AK 域名权限、浏览器 CSP 和控制台。",
  },
  prototype_sdk_script_injection_failed: {
    title: "浏览器拒绝插入地图启动脚本",
    action: "检查当前文档、Trusted Types 和 CSP，不应关闭安全策略绕过。",
  },
  prototype_sdk_map_init_failed: {
    title: "百度 SDK 已加载，但原生地图/聚合层初始化失败",
    action: "检查 BMap.Map、地图相机、ClusterLayer SDK 能力与浏览器渲染容器。",
  },
  prototype_sdk_convert_failed: {
    title: "百度 SDK 的 WGS84→BD-09 官方坐标转换失败",
    action: "检查 BMap.Convertor 子资源、配额和回调；不使用不精确的客户端转换代替。",
  },
  prototype_sdk_layer_update_failed: {
    title: "百度地图聚合图层更新/视窗定位失败",
    action: "检查 ClusterLayer.setData、setViewport 及 SDK 运行时动态子资源。",
  },
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
  sdk_service_host_conflict: {
    title: '页面中已有不一致的百度地图代理地址',
    action: '本页先前声明的 _BMapSecurityConfig.serviceHost 与当前受信 HTTPS 代理不一致；检查是否重复加载不同版本或重复注入地图 SDK，不要绕过隔离和域名验证。',
  },
  sdk_cached_namespace_conflict: {
    title: '页面中已缓存的百度 SDK 被其他脚本替换',
    action: '当前页面 BMap 与本应用此前成功校验的 SDK 实例不一致；停止继续加载，并检查重复脚本或第三方代码干预。',
  },
  sdk_script_failed: {
    title: '浏览器无法加载百度 JSAPI 启动脚本',
    action: '实际浏览器的同源 /_BMapService/api?v=4.0 触发 script.onerror；可能是网关、HTTP 状态、CSP 或浏览器拦截。固定 Server Loader 检测成功不能排除该问题，需查看浏览器 Network/CSP 拒绝项（不要上传带密钥的 URL）。',
  },
  sdk_script_timeout: {
    title: '百度 JSAPI 启动脚本未在期限内响应',
    action: '实际浏览器脚本未触发 load/error；检查同源代理、网络超时、CSP 和上游延迟。该阶段还没有证据表明 BMap 已初始化。',
  },
  sdk_script_injection_failed: {
    title: '浏览器拒绝创建或插入 SDK 脚本',
    action: '注入固定的同源脚本时出现本地异常；检查 CSP、Trusted Types 与页面脚本策略，不得通过禁用安全策略解决。',
  },
  sdk_namespace_missing: {
    title: '启动脚本已加载，但未建立 BMap SDK 命名空间',
    action: '已触发启动脚本 load，但在受控等待期内仍没有 window.BMap；检查 JSAPI 启动后子资源、代理重写、CSP 和脚本执行错误。',
  },
  sdk_missing_map: {
    title: 'BMap 已存在，但缺少 Map 构造能力',
    action: '加载后检测不到 JSAPI 4.0 的 BMap.Map；检查 SDK 版本、实际响应及后续脚本依赖，不接受不完整地图对象。',
  },
  sdk_missing_point: {
    title: 'BMap 已存在，但缺少 Point 坐标能力',
    action: '加载后检测不到 BMap.Point；检查 SDK 版本与子资源完整性，不使用其他坐标库进行未经授权的替代。',
  },
  sdk_missing_convertor: {
    title: 'BMap 已存在，但缺少 Convertor 官方坐标转换',
    action: '加载后检测不到 BMap.Convertor；检查地图脚本/子资源版本，保持原始 WGS84 到 BD-09 的官方转换约束。',
  },
  sdk_missing_cluster_layer: {
    title: 'BMap 已存在，但缺少 ClusterLayer 聚合图层',
    action: '加载后检测不到 JSAPI 4.0 的 BMap.ClusterLayer；核对 JSAPI 版本及可视化子资源，不伪造聚合结果。',
  },
  sdk_coordinate_conversion_failed: {
    title: 'SDK 已加载，但官方坐标转换失败',
    action: 'BMap.Convertor 未能提供有效 WGS84→BD-09 坐标；检查官方转换服务/额度和浏览器 SDK 依赖，不能绕过为客户端近似转换。',
  },
  sdk_map_initialization_failed: {
    title: 'SDK 已就绪，但创建或定位原生地图失败',
    action: '脚本和必需 API 已就绪；失败发生在 new BMap.Map 或 centerAndZoom。检查容器可见性、浏览器 WebGL、SDK 子资源与控制台错误，不展示原始异常。',
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

/** Inspects only HTTP status, never raw provider errors or AK-bearing URLs. */
export function xDriveClassifyBaiduPrototypeConfigFailure(
  error: unknown,
): XDriveBaiduMapDiagnosticCode {
  let status: unknown
  try { if (error && typeof error === 'object') status = (error as { status?: unknown }).status }
  catch { /* untrusted getter */ }
  if (status === 401 || status === 403) return 'prototype_config_denied'
  if (status === 404 || status === 501) return 'prototype_config_unsupported'
  if (status === 429) return 'prototype_config_rate_limited'
  return 'prototype_config_unavailable'
}
