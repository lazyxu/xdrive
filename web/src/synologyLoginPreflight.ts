type XDriveDSMAgentLoginInfo = Readonly<{
  configured: boolean
  server?: string
  username?: string
}>

// Credential-free, purely local validation. This file must never save, log,
// return or transmit the password. Only the authenticated DSM Host may POST.
function canonicalHTTPSOrigin(value: string): string | null {
  const input = value.trim()
  if (!input || new TextEncoder().encode(input).length > 512) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

export function xDriveDSMLoginInputError(server: string, username: string, password: string): string {
  if (!canonicalHTTPSOrigin(server)) {
    return 'Server 只能填写有效 HTTPS 根地址（不包含账号、路径、参数或片段）；输入已保留。'
  }
  if (!username || username !== username.trim() ||
      new TextEncoder().encode(username).length > 128 ||
      /[\u0000\r\n]/.test(username)) {
    return '用户名无效（最多 128 字节）；输入已保留。'
  }
  if (!password || new TextEncoder().encode(password).length > 4096 ||
      /[\u0000\r\n]/.test(password)) {
    return '密码无效或超过 4096 字节；请修改后重试。'
  }
  return ''
}

/** Match the Agent's exact existing Server/Owner boundary, not merely a LAN alias. */
export function xDriveDSMLoginOwnerError(
  server: string,
  username: string,
  current: XDriveDSMAgentLoginInfo,
): string {
  if (!current || typeof current.configured !== 'boolean') {
    return '无法验证本机 Agent 当前账户；未发送密码。'
  }
  if (!current.configured) return ''
  const saved = current.server ? canonicalHTTPSOrigin(current.server) : null
  if (!saved || saved !== canonicalHTTPSOrigin(server) || current.username !== username) {
    return '当前 Agent 已绑定其他服务器或账户；未发送密码。请先通过 NAS 本机管理入口安全迁移已有备份。'
  }
  return ''
}
