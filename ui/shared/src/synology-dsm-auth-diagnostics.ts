/** Fixed CGI error labels only. Never accept a response body, username,
 * cookie, URI, Agent path, request header or arbitrary upstream diagnostic.
 */
const dsmReasonByStatus: Readonly<Record<number, readonly string[]>> = {
  401: ['dsm-session-rejected'],
  403: ['dsm-principal-unapproved', 'dsm-authority-unavailable', 'dsm-csrf-rejected'],
  503: [
    'agent-unavailable', 'server-connection-unavailable', 'nas-inventory-unavailable',
    'dsm-auth-environment', 'dsm-auth-timeout', 'dsm-auth-helper-failed',
    'dsm-auth-response-invalid', 'dsm-auth-unavailable',
  ],
}

export function xDriveDSMSafeFailureCode(status: number, header: string | null): string {
  if (!header || !dsmReasonByStatus[status]?.includes(header)) return ''
  return header
}

/** Shared DSM Backup, Source setup and NAS inventory diagnostics.
 * This is presentation only, never a fallback identity or Root permission.
 */
export function xDriveDSMAuthenticationFailureMessage(failure: unknown): string | null {
  const detail = failure instanceof Error ? failure.message : ''
  const status = (code: number, reason: string) =>
    detail.includes(`HTTP ${code}) [${reason}]`)
  if (status(401, 'dsm-session-rejected'))
    return 'DSM 原生认证确认当前会话未登录（HTTP 401 · dsm-session-rejected）。请从相同 HTTPS 地址和端口重新登录 DSM，再刷新 xDrive。'
  if (status(503, 'dsm-auth-environment'))
    return 'DSM CGI 认证环境不完整（HTTP 503 · dsm-auth-environment）。请检查 DSM HTTPS CGI 环境与套件启动方式；不是 Server 密码或 NAS 目录权限错误。'
  if (status(503, 'dsm-auth-timeout'))
    return 'DSM 原生身份校验超时（HTTP 503 · dsm-auth-timeout）。请检查 NAS 负载和 DSM Web 服务后重试；尚不能认定会话已过期。'
  if (status(503, 'dsm-auth-helper-failed'))
    return 'DSM 原生认证程序执行失败（HTTP 503 · dsm-auth-helper-failed）。请检查 DSM authenticate.cgi 可执行状态及套件 CGI 日志；不要反复修改 Server 密码。'
  if (status(503, 'dsm-auth-response-invalid'))
    return 'DSM 原生身份结果无法安全识别（HTTP 503 · dsm-auth-response-invalid）。请检查 DSM 系统和认证程序，当前不会接受不可信身份。'
  if (status(503, 'dsm-auth-unavailable'))
    return 'DSM 身份验证程序异常（HTTP 503 · dsm-auth-unavailable）。请检查 DSM 原生认证与 CGI 日志；尚不能判定会话过期。'
  if (status(403, 'dsm-principal-unapproved'))
    return '当前 DSM 用户尚未通过 xdrivenas 套件界面授权（HTTP 403 · dsm-principal-unapproved）。请核对 NAS 本机首次授权。'
  if (status(403, 'dsm-authority-unavailable'))
    return 'DSM 套件授权配置缺失或不可安全读取（HTTP 403 · dsm-authority-unavailable）。请检查 NAS 上的套件授权文件及权限；当前不会自动重建授权。'
  if (status(403, 'dsm-csrf-rejected'))
    return 'DSM 请求的 Origin 或 CSRF 校验失败（HTTP 403 · dsm-csrf-rejected）。请保持同一 HTTPS 地址及端口，刷新 DSM 后重试；没有执行任何备份写入。'
  if (detail.includes('HTTP 401)'))
    return 'DSM 认证请求返回 HTTP 401，但没有可信的会话拒绝原因码。请从 DSM HTTPS 登录入口重新登录，并检查 CGI 请求是否使用相同主机及端口。'
  if (detail.includes('HTTP 403)'))
    return 'DSM 请求返回 HTTP 403，但未能证明是用户授权不足；也可能是 Origin 或 CSRF 拒绝。请检查 DSM HTTPS 会话及 CGI 日志。'
  return null
}
