import {
  xDriveCreateBaiduIsolatedCellsMessage,
  xDriveParseBaiduIsolatedChildEvent,
  xDriveValidBaiduIsolatedBoundary,
} from './media-gallery-baidu-isolated-origin-protocol'
import type {
  XDriveBaiduIsolatedCamera,
  XDriveBaiduIsolationBoundary,
  XDriveBaiduParentCellsMessage,
} from './media-gallery-baidu-isolated-origin-protocol'

/**
 * A3i-Msg2. Parent-owned, fail-closed isolated-frame transport only.
 * This does NOT host the child, bootstrap the Baidu SDK, or activate a map.
 * Never mount the current same-document JSAPI Loader in the Gallery.
 */
export type XDriveTrustedIsolatedMapCell<T> = Readonly<{
  // BD-09 already derived from the *current* authenticated Owner cell receipt.
  latitude: number
  longitude: number
  count: number
  // Parent-only opaque application selection, NEVER sent to the child.
  selection: T
}>

export interface XDriveBaiduIsolatedFrameOptions<T> {
  parentWindow: Window
  host: HTMLElement
  /** Approved by trusted Server config; must differ from actual Gallery Origin. */
  childOrigin: string
  /** Must reauthorize the selected Cell via the original Owner /cell-items Range. */
  onActivateCell: (selection: T) => void
  onCamera?: (camera: XDriveBaiduIsolatedCamera) => void
  onCancel?: () => void
}

export interface XDriveBaiduIsolatedFrameHost<T> {
  readonly element: HTMLIFrameElement
  /** Replace all current authorized cells, never append to old Owner cells. */
  replaceAuthorizedCells(cells: readonly XDriveTrustedIsolatedMapCell<T>[]): boolean
  /** Immediately invalidate the entire generation on logout/revoke/navigation. */
  dispose(): void
}

let nextGeneration = 0
const framePath = '/_xdrive_baidu_isolated/index.html'
const maxCells = 64

function randomHex(crypto: Crypto, bytes: number): string | null {
  try {
    if (!crypto || typeof crypto.getRandomValues !== 'function') return null
    const data = new Uint8Array(bytes)
    crypto.getRandomValues(data)
    return Array.from(data, x => x.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

// A hostname/port difference alone is NOT a cookie/security-site boundary:
// sibling hosts can receive a cookie scoped to Domain=.example.net.
// Conservatively require different last-two DNS labels. This intentionally
// refuses some genuinely separate multi-label/public-suffix sites; a trusted
// deployment must additionally verify both registrable domains with the PSL,
// enforce parent frame-src/frame-ancestors, and avoid shared cookie domains.
// It is a fail-closed *precondition*, never standalone sandbox certification.
function conservativelyIndependentCookieSites(parentOrigin: string, childOrigin: string): boolean {
  const suffix = (origin: string): string | null => {
    const hostname = new URL(origin).hostname.toLowerCase()
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.startsWith('.') ||
        hostname.endsWith('.') || hostname.includes('..') ||
        /^\d+(?:\.\d+){3}$/.test(hostname)) return null
    const labels = hostname.split('.')
    if (labels.length < 2 || labels.some(label => label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
    return labels.slice(-2).join('.')
  }
  try {
    const a = suffix(parentOrigin)
    const b = suffix(childOrigin)
    return Boolean(a && b && a !== b)
  } catch { return false }
}

export function xDriveMountBaiduIsolatedFrame<T>(
  options: XDriveBaiduIsolatedFrameOptions<T>,
): XDriveBaiduIsolatedFrameHost<T> | null {
  if (!options || !options.parentWindow || !options.host ||
      typeof options.onActivateCell !== 'function') return null
  const browser = options.parentWindow
  const doc = options.host.ownerDocument
  if (!doc || doc.defaultView !== browser ||
      !browser.location || !browser.crypto) return null

  // No user URL, no data/blob/file: iframe, no same-Origin sandbox. A bare
  // HTTPS origin is supplied by trusted settings, not caller query strings.
  const generation = ++nextGeneration
  if (!Number.isSafeInteger(generation)) return null
  const nonce = randomHex(browser.crypto, 32)
  if (!nonce) return null
  const provisional: XDriveBaiduIsolationBoundary = {
    parentOrigin: browser.location.origin,
    childOrigin: options.childOrigin,
    // Temporarily only for origin/nonce validation; replaced after mount.
    childWindow: {}, generation, nonce,
  }
  if (!xDriveValidBaiduIsolatedBoundary(provisional)) return null
  // Neither a different TCP port NOR a sibling hostname is independent:
  // Domain cookies are not port-scoped and can cover sibling subdomains.
  // This conservative prefix check also fails closed for ambiguous DNS sites.
  if (!conservativelyIndependentCookieSites(
        provisional.parentOrigin, provisional.childOrigin)) return null

  const iframe = doc.createElement('iframe')
  // The combination is safe ONLY for independently hosted origins, never a
  // same-Origin iframe. Cross-Origin DOM rules are enforced by the browser.
  iframe.sandbox.add('allow-scripts', 'allow-same-origin')
  iframe.referrerPolicy = 'no-referrer'
  iframe.title = '百度地图（独立安全文档）'
  iframe.setAttribute('allow', '')
  iframe.setAttribute('loading', 'eager')
  iframe.setAttribute('data-xdrive-baidu-isolated-frame', 'true')
  iframe.src = options.childOrigin + framePath

  let alive = true
  let ready = false
  let boundary: XDriveBaiduIsolationBoundary | null = null
  let published: XDriveBaiduParentCellsMessage | null = null
  let ownerSelection = new Map<string, T>()
  const detach = () => {
    if (!alive) return
    alive = false
    ready = false
    boundary = null
    published = null
    ownerSelection.clear()
    browser.removeEventListener('message', onMessage)
    iframe.removeEventListener('load', onLoad)
    iframe.remove()
  }
  const post = (message: XDriveBaiduParentCellsMessage) => {
    if (!alive || !boundary || !iframe.contentWindow) return
    // NEVER use '*' or send JWT, Cookie, media URL/pixels or Owner identity.
    try { iframe.contentWindow.postMessage(message, boundary.childOrigin) }
    catch { detach() }
  }
  const onLoad = () => {
    if (!alive || !boundary) return
    // Frame reload invalidates child-ready state and any previous authorization.
    ready = false
    published = xDriveCreateBaiduIsolatedCellsMessage(boundary, [])
    ownerSelection.clear()
    if (!published) { detach(); return }
    post(published) // bounded session nonce bootstrap, ZERO Owner data
  }
  const onMessage = (raw: MessageEvent) => {
    if (!alive || !boundary) return
    const event = xDriveParseBaiduIsolatedChildEvent(raw, boundary)
    if (!event) return
    if (event.kind === 'ready') {
      ready = true
      if (published) post(published)
    } else if (event.kind === 'camera') {
      if (ready) options.onCamera?.(event.camera)
    } else if (event.kind === 'activate-cell') {
      if (!ready || !ownerSelection.has(event.key)) return
      // Parent selection is only an intent. Its consumer MUST use a fresh
      // signed Owner /cell-items Range before displaying any actual media.
      options.onActivateCell(ownerSelection.get(event.key)!)
    } else if (event.kind === 'cancel') {
      if (ready) options.onCancel?.()
    }
  }

  try {
    browser.addEventListener('message', onMessage)
    iframe.addEventListener('load', onLoad)
    options.host.appendChild(iframe)
    if (!iframe.contentWindow) { detach(); return null }
    boundary = { ...provisional, childWindow: iframe.contentWindow }
    if (!xDriveValidBaiduIsolatedBoundary(boundary)) { detach(); return null }
    published = xDriveCreateBaiduIsolatedCellsMessage(boundary, [])
    if (!published) { detach(); return null }
    // Never send a real cell to a child before its validated ready packet.
    return {
      element: iframe,
      replaceAuthorizedCells(cells) {
        if (!alive || !boundary || !Array.isArray(cells) || cells.length > maxCells) {
          if (alive && boundary) {
            ownerSelection.clear()
            published = xDriveCreateBaiduIsolatedCellsMessage(boundary, [])
            if (ready && published) post(published)
          }
          return false
        }
        const next = new Map<string, T>()
        const reduced: Array<{key: string; latitude: number; longitude: number; count: number}> = []
        for (const cell of cells) {
          const key = randomHex(browser.crypto, 16)
          if (!key) { detach(); return false }
          next.set(key, cell.selection)
          reduced.push({ key, latitude: cell.latitude, longitude: cell.longitude,
            count: cell.count })
        }
        const message = xDriveCreateBaiduIsolatedCellsMessage(boundary, reduced)
        if (!message) {
          ownerSelection.clear()
          published = xDriveCreateBaiduIsolatedCellsMessage(boundary, [])
          if (ready && published) post(published)
          return false
        }
        ownerSelection = next
        published = message
        if (ready) post(message)
        return true
      },
      dispose: detach,
    }
  } catch {
    detach()
    return null
  }
}
