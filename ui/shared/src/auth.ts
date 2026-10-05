export function xDriveUsernameValidationError(username: string) {
  const value = username.trim()
  if (!value) return '请填写用户名'
  if (value.length < 3 || value.length > 64) return '用户名长度需要 3–64 个字符'
  return ''
}

export function xDrivePasswordValidationError(password: string) {
  if (password.length < 8 || password.length > 128) {
    return '密码长度需要 8–128 个字符'
  }
  return ''
}

export function xDriveLoginCredentialsReady({
  server,
  username,
  password,
  passwordAvailable = false,
  requireServer = false,
}: {
  server?: string
  username: string
  password: string
  passwordAvailable?: boolean
  requireServer?: boolean
}) {
  if (requireServer && !server?.trim()) return false
  return Boolean(username.trim() && (password || passwordAvailable))
}
