/**
 * Explicit browser navigation only. Each origin has isolated credentials and
 * settings; this module never probes cross-origin URLs or moves a session.
 */
export type XDriveManualEndpointKind = 'lan' | 'public'
export type XDriveManualEndpointResult = Readonly<{
  origin: string
  insecure: boolean
  error: string
}>

export const XDRIVE_MANUAL_LAN_ENTRY_KEY = 'xdrive.manual_endpoint.lan'
export const XDRIVE_MANUAL_PUBLIC_ENTRY_KEY = 'xdrive.manual_endpoint.public'

const invalid = (error: string): XDriveManualEndpointResult => ({
  origin: '', insecure: false, error,
})

function privateIPv4(host: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false
  const bytes = host.split('.').map(Number)
  if (bytes.some((part) => part > 255)) return false
  return bytes[0] === 10 ||
    (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
    (bytes[0] === 192 && bytes[1] === 168)
}

function publicDNSName(host: string): boolean {
  const parts = host.split('.')
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
  return parts.length >= 2 && parts.every((part) => label.test(part)) &&
    parts[parts.length - 1].length >= 2 &&
    !['local', 'localhost', 'internal', 'invalid'].includes(parts[parts.length - 1])
}

/**
 * Return exactly one navigable origin. No paths, hashes, search parameters,
 * credentials, arbitrary schemes or non-private LAN hosts are accepted.
 * HTTP on a private address is EXPLICITLY marked insecure; the UI asks for
 * per-opening confirmation and never sends its current authentication tokens.
 */
export function xDriveManualEndpoint(
  kind: XDriveManualEndpointKind,
  input: string,
): XDriveManualEndpointResult {
  const raw = input.trim()
  if (!raw) return invalid('请输入完整地址，包括 https:// 或 http:// 和端口。')
  if (raw.length > 300) return invalid('地址太长。')
  const authority = raw.match(/^https?:\/\/([^/?#]+)\/?$/i)?.[1]
  if (!authority) return invalid('只能填写站点根地址，不支持路径、参数、片段或其他协议。')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return invalid('地址格式无效；请检查 IP、域名和端口。')
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username || parsed.password || parsed.pathname !== '/' ||
    parsed.search || parsed.hash) {
    return invalid('不允许携带账号、密码、路径、参数或片段。')
  }

  if (kind === 'lan') {
    // Require canonical dotted decimal; WHATWG URL accepts octal and short
    // numeric IP spellings, which are unacceptable for a security-sensitive
    // explicit LAN selector.
    const hostOnly = authority.split(':')[0]
    if (hostOnly !== parsed.hostname || !privateIPv4(parsed.hostname)) {
      return invalid('局域网入口只能使用标准私有 IPv4 地址（10/8、172.16/12、192.168/16）。')
    }
    return { origin: parsed.origin, insecure: parsed.protocol === 'http:', error: '' }
  }
  if (parsed.protocol !== 'https:' || !publicDNSName(parsed.hostname)) {
    return invalid('公网入口必须是 HTTPS 域名，不能使用 HTTP 或 IP。')
  }
  return { origin: parsed.origin, insecure: false, error: '' }
}
