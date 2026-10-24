/** Main-only, one-shot Owner map scope contract for an isolated HTTPS Gallery.
 * No JWT, AK, GPS, URLs, Node/Owner IDs or active media are ever accepted.
 * Keep this dependency-free so Main and Node adversarial tests use identical code.
 */
export type XDriveDesktopBaiduMapScope = Readonly<{
  albumKey: string
  filters: Readonly<{
    sort_by: 'captured' | 'added'
    sort_dir: 'asc' | 'desc'
    favorite?: boolean
    asset_kind?: 'image' | 'video'
    captured_from?: string
    captured_to?: string
    time_zone?: string
  }>
}>
const fields = new Set(['sort_by','sort_dir','favorite','asset_kind',
  'captured_from','captured_to','time_zone'])
const ownObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
const bounded = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value.trim() === value && !/[\x00-\x1f\x7f]/.test(value)
export function xDriveParseDesktopBaiduMapScope(input: unknown):
  XDriveDesktopBaiduMapScope | null {
  if (!ownObject(input) || Object.keys(input).some(key =>
    key !== 'albumKey' && key !== 'filters') ||
    typeof input.albumKey !== 'string' || input.albumKey.length > 512 ||
    input.albumKey.trim() !== input.albumKey ||
    (input.albumKey !== '' && !/^(folder|source|manual|smart):.+$/.test(input.albumKey)) ||
    !ownObject(input.filters) ||
    Object.keys(input.filters).some(key => !fields.has(key))) return null
  const f = input.filters
  const by = f.sort_by ?? 'captured', dir = f.sort_dir ?? 'desc'
  if ((by !== 'captured' && by !== 'added') ||
    (dir !== 'asc' && dir !== 'desc') ||
    (f.favorite !== undefined && typeof f.favorite !== 'boolean') ||
    (f.asset_kind !== undefined && f.asset_kind !== 'image' && f.asset_kind !== 'video') ||
    ['captured_from','captured_to','time_zone'].some(key =>
      f[key] !== undefined && !bounded(f[key]))) return null
  const filters: XDriveDesktopBaiduMapScope['filters'] = {
    sort_by: by, sort_dir: dir,
    ...(f.favorite === undefined ? {} : {favorite: f.favorite as boolean}),
    ...(f.asset_kind === undefined ? {} : {asset_kind: f.asset_kind as 'image' | 'video'}),
    ...(f.captured_from === undefined ? {} : {captured_from: f.captured_from as string}),
    ...(f.captured_to === undefined ? {} : {captured_to: f.captured_to as string}),
    ...(f.time_zone === undefined ? {} : {time_zone: f.time_zone as string}),
  }
  return {albumKey:input.albumKey,filters}
}
/** Claim is bound to one Main-owned BrowserWindow top frame, same configured
 * Server and authenticated username. The Web side first rechecks /auth/me;
 * Server still reauthorizes Owner, Album/Consent and photo-source revision.
 */
export function xDriveDesktopBaiduMapClaimAllowed(input: {
  windowID: number
  pendingWindowID: number
  serverOrigin: string
  currentOrigin: string
  expectedUsername: string
  agentUsername: string
  authenticatedWebUsername: unknown
  frameURL: unknown
  isMainFrame: boolean
  expiresAt: number
  now: number
}): boolean {
  if (!input || !input.isMainFrame || !Number.isSafeInteger(input.windowID) ||
    input.windowID < 1 || input.pendingWindowID !== input.windowID ||
    !input.expectedUsername || !input.agentUsername ||
    input.expectedUsername !== input.agentUsername ||
    input.authenticatedWebUsername !== input.expectedUsername ||
    input.serverOrigin !== input.currentOrigin ||
    !Number.isFinite(input.now) || !Number.isFinite(input.expiresAt) ||
    input.now >= input.expiresAt || typeof input.frameURL !== 'string') return false
  try {
    const url = new URL(input.frameURL)
    if (url.origin !== input.serverOrigin || url.protocol !== 'https:' ||
      url.username || url.password || url.search !== '?places_map_mode=isolated' ||
      (url.pathname !== '/' && url.pathname !== '/index.html')) return false
    const hash = url.hash.slice(1)
    const question = hash.indexOf('?')
    return question >= 0 && hash.slice(0,question) === '/app/gallery' &&
      new URLSearchParams(hash.slice(question+1)).get('section') === 'places'
  } catch { return false }
}
