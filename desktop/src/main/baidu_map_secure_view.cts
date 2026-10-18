/**
 * A3c17: pure strict Origin / outbound traffic gate for isolated Electron Web.
 * It NEVER grants Server JSAPI4 licence, Cookie, signed release or Browser AK.
 */
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
    if (url.protocol === 'data:') return true
    if (url.protocol === 'blob:') return url.origin === trustedOrigin
    return url.protocol === 'https:' && url.origin === trustedOrigin &&
      !url.username && !url.password
  } catch { return false }
}
