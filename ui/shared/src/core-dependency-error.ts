// Shared Web/Mobile Web/Desktop administrator errors for the core-service
// settings panels and the global service inventory. Never echo arbitrary
// transport, Agent or backend diagnostics containing DSNs, paths or credentials.
export type XDriveCoreService = 'postgres' | 'worker' | 'system'
export type XDriveCoreOperation = 'refresh' | 'save' | 'rollback'

function recognizedHTTPStatus(error: unknown): number | null {
  const obj = error != null && typeof error === 'object'
    ? error as { status?: unknown; response?: unknown; message?: unknown } : null
  const response = obj?.response && typeof obj.response === 'object'
    ? obj.response as { status?: unknown } : null
  const reported = obj?.status ?? response?.status
  if (typeof reported === 'number' && Number.isInteger(reported) &&
      reported >= 400 && reported <= 599) return reported
  const message = typeof obj?.message === 'string' ? obj.message :
    error instanceof Error ? error.message : ''
  const match = /(?:^|\b)(?:HTTP(?:Error)?|status(?: code)?|response status)\s*[:=]?\s*(400|401|403|404|408|409|422|429|500|501|502|503|504)\b/i.exec(message)
  return match ? Number(match[1]) : null
}

export function xDriveCoreDependencyErrorMessage(
  error: unknown, service: XDriveCoreService, operation: XDriveCoreOperation,
): string {
  const label = service === 'postgres' ? 'PostgreSQL 连接池'
    : service === 'worker' ? '后台 Worker' : '系统依赖'
  const action = operation === 'save' ? '保存' : operation === 'rollback' ? '回滚' : '刷新'
  const status = recognizedHTTPStatus(error)
  switch (status) {
    case 400:
    case 422:
      return label + action + '失败：参数未通过校验，请检查输入范围和当前版本。'
    case 401:
      return label + action + '失败：登录会话已失效，请重新登录后核对结果。'
    case 403:
      return label + action + '失败：当前账号没有管理员操作权限。'
    case 404:
    case 501:
      return label + action + '失败：Server 或 Desktop Agent 不支持此管理接口，请检查版本。'
    case 409:
      return label + action + '存在版本冲突或未完成的请求；请核对当前配置，勿盲目重试。'
    case 408:
    case 429:
      return label + action + '暂时无法确认（超时或限流）；请核对当前状态后再操作。'
    case 500:
    case 502:
    case 503:
    case 504:
      return label + action + '未完成可信确认；请检查 Server / Desktop Agent 状态与服务端日志。'
  }
  const obj = error != null && typeof error === 'object'
    ? error as { message?: unknown } : null
  const message = typeof obj?.message === 'string' ? obj.message :
    error instanceof Error ? error.message : ''
  if (/failed to fetch|fetch failed|networkerror|network request failed|econnrefused|timed?\s*out/i.test(message)) {
    return label + action + '无法连接 Server / Desktop Agent；请检查网络与服务状态。'
  }
  if (operation === 'save') {
    return label + '保存结果未确认，可能已经提交。草稿已保留；请先核对当前配置，勿盲目重试。'
  }
  if (operation === 'rollback') {
    return label + '回滚结果未确认，可能已经提交。请核对当前配置及历史，勿盲目重试。'
  }
  return label + '读取失败，当前数据可能已过期；请检查 Server / Desktop Agent 日志。'
}
