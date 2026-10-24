/** Separate HTTPS Baidu Child egress policy for the secure Electron Window.
 *
 * A source-verified Server release comes ONLY through the authenticated Go
 * Client -> Agent loopback -> Main. Never trust an Origin from the HTTPS
 * Renderer, Provider SDK, URL fragment, postMessage or PWA state.
 */
export type XDriveSignedBaiduChildRelease = Readonly<{
  provider: 'baidu-jsapi-4.0'
  enabled: true
  activation_state: 'authorized_signed_release'
  attribution: '© 百度地图'
  isolated_child_origin: string
}>
const releaseFields = new Set(['provider','enabled','activation_state',
  'attribution','isolated_child_origin'])
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype

function canonicalHTTPSOrigin(v: unknown): string | null {
  if (typeof v !== 'string' || v.length < 11 || v.length > 253 ||
      v !== v.trim()) return null
  try {
    const url = new URL(v)
    if (url.protocol !== 'https:' || !url.hostname || url.username ||
      url.password || url.port || url.pathname !== '/' || url.search ||
      url.hash || url.origin !== v || url.href !== v + '/') return null
    const hostname=url.hostname
    if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.test') ||
      hostname.endsWith('.invalid') || hostname.endsWith('.') ||
      hostname !== hostname.toLowerCase()) return null
    // The Server independently uses the Public Suffix List to demand two
    // distinct registrable Cookie sites. This helper MUST NOT invent a PSL.
    return v
  } catch { return null }
}

export function xDriveReleasedBaiduChildOrigin(
  serverRelease: unknown, galleryOrigin: unknown,
): string | null {
  const gallery = canonicalHTTPSOrigin(galleryOrigin)
  if (!gallery || !record(serverRelease) ||
    Object.keys(serverRelease).length !== releaseFields.size ||
    Object.keys(serverRelease).some(key => !releaseFields.has(key)) ||
    serverRelease.provider !== 'baidu-jsapi-4.0' ||
    serverRelease.enabled !== true ||
    serverRelease.activation_state !== 'authorized_signed_release' ||
    serverRelease.attribution !== '© 百度地图') return null
  const child = canonicalHTTPSOrigin(serverRelease.isolated_child_origin)
  return child && child !== gallery ? child : null
}

// Restricted to the actual independent Caddy Child entry/static/session
// routes and the same-Origin _BMapService endpoint. Caddy and Go STILL do
// per-path/method/Owner/Session/Consent/release enforcement; this does not
// authorize any new provider URL, resource MIME or network destination.
export function xDriveBaiduReleasedChildResourceAllowed(
  rawURL: unknown, approvedChildOrigin: unknown,
): boolean {
  const child=canonicalHTTPSOrigin(approvedChildOrigin)
  if (!child || typeof rawURL !== 'string' || rawURL.length > 4096) return false
  try {
    const url=new URL(rawURL)
    if (url.protocol !== 'https:' || url.origin !== child ||
      url.username || url.password || url.hash) return false
    const staticResource = url.pathname === '/_xdrive_baidu_isolated/index.html' ||
      url.pathname === '/_xdrive_baidu_isolated/child.js' ||
      url.pathname === '/_xdrive_baidu_isolated/child.css' ||
      url.pathname === '/_xdrive_baidu_isolated/session'
    if (staticResource) return url.search === ''
    return url.pathname.startsWith('/_BMapService/') &&
      url.pathname.length <= 512
  } catch { return false }
}
