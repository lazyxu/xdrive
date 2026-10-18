/**
 * A3c17: pure strict Origin / outbound traffic gate for isolated Electron Web.
 * It NEVER grants Server JSAPI4 licence, Cookie, signed release or Browser AK.
 */
/**
 * Secure Electron map WebContents permits only small canonical raster data:
 * URLs required for inline image pixels. Never allow data: HTML, SVG, JS,
 * fonts or documents: same-origin browsing does not make inline scripts safe.
 * This is an Electron navigation/egress guard, NOT a Server JSAPI4 release.
 */
function xDriveBaiduRasterDataAllowed(rawURL: string): boolean {
  // 1 MiB decoded ceiling and no query/fragment or whitespace normalization.
  // Executable SVG, HTML and script MIME types must fail closed.
  const maxEncoded = Math.ceil((1 << 20) / 3) * 4
  if (rawURL.length > maxEncoded + 36 || /[\s?#]/.test(rawURL)) return false
  const comma = rawURL.indexOf(',')
  if (comma < 0) return false
  const mime = rawURL.slice(0, comma)
  if (mime !== 'data:image/png;base64' &&
      mime !== 'data:image/jpeg;base64' &&
      mime !== 'data:image/webp;base64' &&
      mime !== 'data:image/gif;base64') return false
  const payload = rawURL.slice(comma + 1)
  if (payload.length === 0 || payload.length > maxEncoded ||
      payload.length % 4 !== 0) return false
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    return false
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return (payload.length / 4) * 3 - padding <= (1 << 20)
}

export type XDriveSecureBaiduMapTarget = Readonly<{ origin: string; url: string }>

export function xDriveResolveSecureBaiduMapTarget(
  rawServer: unknown,
): XDriveSecureBaiduMapTarget | null {
  if (typeof rawServer !== 'string' || rawServer.length > 2048 ||
      rawServer !== rawServer.trim() || !rawServer) return null
  try {
    const url = new URL(rawServer)
    if (url.protocol !== 'https:' || !url.hostname ||
        url.username || url.password || url.search || url.hash ||
        (url.pathname !== '/' && url.pathname !== '') ||
        !/^https:\/\/[^/?#]+$/.test(url.origin)) return null
    return { origin: url.origin, url: url.origin + '/#/app/gallery?section=places' }
  } catch { return null }
}

export function xDriveBaiduMapNavigationAllowed(
  rawURL: unknown, trustedOrigin: string,
): boolean {
  if (typeof rawURL !== 'string' || typeof trustedOrigin !== 'string') return false
  try {
    const url = new URL(rawURL)
    return url.protocol === 'https:' && url.origin === trustedOrigin &&
      !url.username && !url.password && !url.search &&
      (url.pathname === '/' || url.pathname === '/index.html')
  } catch { return false }
}

export function xDriveBaiduMapResourceAllowed(
  rawURL: unknown, trustedOrigin: string,
): boolean {
  if (typeof rawURL !== 'string' || typeof trustedOrigin !== 'string') return false
  try {
    const url = new URL(rawURL)
    if (url.protocol === 'data:') return xDriveBaiduRasterDataAllowed(rawURL)
    if (url.protocol === 'blob:') return url.origin === trustedOrigin
    return url.protocol === 'https:' && url.origin === trustedOrigin &&
      !url.username && !url.password
  } catch { return false }
}
