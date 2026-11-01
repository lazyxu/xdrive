// Shared Web/Mobile Web/Desktop: administrator Caddy read failures are
// not proof a route is unsupported or that Caddy itself is stopped.
// Never echo raw server, proxy, Agent or transport errors: they may contain
// user endpoints, credentials or internal paths.
export type XDriveCaddyReadScope = 'https' | 'history' | 'alidns'

export function xDriveCaddyReadFailureMessage(error: unknown, scope: XDriveCaddyReadScope): string {
  const label = scope === 'https' ? 'Caddy HTTPS 期望配置' :
    scope === 'history' ? 'Caddy HTTPS 配置历史' : 'Caddy AliDNS 凭据状态'
  const source = error != null && typeof error === 'object'
    ? error as { status?: unknown; message?: unknown } : null
  const message = typeof source?.message === 'string' ? source.message :
    error instanceof Error ? error.message : ''
  const directStatus = typeof source?.status === 'number' && Number.isInteger(source.status) &&
    source.status >= 400 && source.status <= 599 ? source.status : null
  const recognized = /(?:^|\b)(?:HTTP(?:Error)?|status(?: code)?|response status)\s*[:=]?\s*(401|403|404|408|429|500|501|502|503|504)\b/i.exec(message)
  // The Go Client uses "xdrive API: <fixed server error> (503)".
  // Desktop Agent may forward only that message, dropping the typed status.
  // Extract strictly the terminal status; never display the untrusted text.
  const apiWrapped = /^xdrive API: [^\r\n]{1,240} \((401|403|404|408|429|500|501|502|503|504)\)$/.exec(message)
  const status = directStatus ?? (recognized ? Number(recognized[1]) :
    apiWrapped ? Number(apiWrapped[1]) : null)
  switch (status) {
    case 401: return label + '读取失败（HTTP 401）：登录会话已失效，请重新登录后再试。'
    case 403: return label + '读取失败（HTTP 403）：当前账号没有管理员权限，或账户尚需完成安全验证。'
    case 404: return label + '读取失败（HTTP 404）：已连接的 Server/Agent 未提供此管理接口；请核对服务器、Agent 和前端是否为兼容版本。'
    case 501: return label + '读取失败（HTTP 501）：此管理请求不适用于当前接口或配置模式；请核对 Server/Agent 版本，勿据此重建 Caddy。'
    case 503: return label + '读取失败（HTTP 503）：管理配置快照不可用。Host .env 模式请检查 Host Control 心跳、caddy-env-observed.json 与 Server /host-control 挂载；旧数据库模式再检查 PostgreSQL。勿删除配置或重启 Caddy。'
    case 502:
    case 504: return label + '读取失败（HTTP ' + status + '）：网关或 Agent 无法完成请求，请核对实际连接地址及服务状态。'
    case 408: return label + '读取超时（HTTP 408），请检查服务器或代理连通性后重试。'
    case 429: return label + '读取被限流（HTTP 429），请稍后手动重试。'
    case 500: return label + '读取失败（HTTP 500）：服务端内部错误，请查阅 Server 日志。'
    default:
      if (/failed to fetch|fetch failed|networkerror|network request failed|econnrefused|timeout|timed out/i.test(message)) {
        return label + '无法连接当前 Server/Agent；请检查网络、登录入口及服务进程状态。'
      }
      return label + '读取失败；无法确认具体 HTTP 状态，请检查浏览器 Network 请求或 Desktop Agent 日志。'
  }
}
