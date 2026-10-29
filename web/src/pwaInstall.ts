/** Install UX is a browser capability, independent of authentication and xDrive's REST clients. */
export type XDrivePwaDisplayMode = 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui' | 'window-controls-overlay'
export type XDrivePwaPlatformHint = 'ios' | 'android' | 'other'
export type XDrivePwaPromptOutcome = 'accepted' | 'dismissed' | 'unknown' | 'unavailable' | 'error'

export interface XDrivePwaInstallSnapshot {
  displayMode: XDrivePwaDisplayMode
  platformHint: XDrivePwaPlatformHint
  secureContext: boolean
  serviceWorkerSupported: boolean
  promptAvailable: boolean
  installedEventObserved: boolean
  lastPromptOutcome: XDrivePwaPromptOutcome | null
}
export interface XDrivePwaAssetCheck {
  id: 'context' | 'transport' | 'manifest' | 'worker' | 'offline' | 'icon192' | 'icon512'
  state: 'pass' | 'warn' | 'fail'
  label: string
  detail: string
}
type InstallChoice = { outcome?: string }
type InstallPromptEvent = Event & { prompt: () => Promise<InstallChoice | void> }

let started = false
let promptEvent: InstallPromptEvent | null = null
let installedEventObserved = false
let lastPromptOutcome: XDrivePwaPromptOutcome | null = null
let snapshot: XDrivePwaInstallSnapshot | null = null
const listeners = new Set<() => void>()

function platformHint(): XDrivePwaPlatformHint {
  // Merely a display hint, never authentication, installation or OS proof.
  // A managed WebKit context may deny optional Navigator property getters.
  try {
    if (typeof navigator === 'undefined') return 'other'
    const userAgent = navigator.userAgent || ''
    if (/iPad|iPhone|iPod/i.test(userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
    if (/Android/i.test(userAgent)) return 'android'
  } catch {
    // The normal Web app must still render before any optional install advice.
  }
  return 'other'
}

function secureContextHint(): boolean {
  try { return typeof window !== 'undefined' && window.isSecureContext === true }
  catch { return false }
}

function serviceWorkerSupportedHint(): boolean {
  try { return typeof navigator !== 'undefined' && 'serviceWorker' in navigator }
  catch { return false }
}
function displayMode(): XDrivePwaDisplayMode {
  if (typeof window === 'undefined') return 'browser'
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'] as const) {
    try {
      if (window.matchMedia?.('(display-mode: ' + mode + ')')?.matches) return mode
    } catch {
      // A restricted WebKit media-query API is only an unknown display mode;
      // optional install detection must never prevent the regular app boot.
    }
  }
  try {
    if (typeof navigator !== 'undefined' &&
        (navigator as Navigator & { standalone?: boolean }).standalone === true) return 'standalone'
  } catch {
    // WebKit may deny this optional installed-mode getter. A missing hint
    // must not prevent the normal authenticated Web app from starting.
  }
  return 'browser'
}
function readSnapshot(): XDrivePwaInstallSnapshot {
  return {
    displayMode: displayMode(),
    platformHint: platformHint(),
    secureContext: secureContextHint(),
    serviceWorkerSupported: serviceWorkerSupportedHint(),
    promptAvailable: promptEvent !== null,
    installedEventObserved,
    lastPromptOutcome,
  }
}
function broadcast() {
  const next = readSnapshot()
  if (snapshot && Object.entries(next).every(([key, value]) =>
    snapshot?.[key as keyof XDrivePwaInstallSnapshot] === value)) return
  snapshot = next
  for (const listener of listeners) listener()
}
export function xDrivePwaInstallSnapshot(): XDrivePwaInstallSnapshot {
  return snapshot ?? (snapshot = readSnapshot())
}
export function subscribeXDrivePwaInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function startXDrivePwaInstallObservation(): void {
  if (started || typeof window === 'undefined') return
  started = true
  const onPrompt = (event: Event) => {
    if (typeof (event as InstallPromptEvent).prompt !== 'function') return
    event.preventDefault()
    promptEvent = event as InstallPromptEvent
    lastPromptOutcome = null
    broadcast()
  }
  const onInstalled = () => {
    installedEventObserved = true
    promptEvent = null
    broadcast()
  }
  // Optional install signals must never prevent the shared Web/PWA app from
  // rendering. A restricted browser host may deny one event independently;
  // retain every other supported listener and the initial capability snapshot.
  try { window.addEventListener('beforeinstallprompt', onPrompt) } catch { /* optional */ }
  try { window.addEventListener('appinstalled', onInstalled) } catch { /* optional */ }
  try { window.addEventListener('pageshow', broadcast) } catch { /* optional */ }
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
    try {
      window.matchMedia?.('(display-mode: ' + mode + ')')?.addEventListener?.('change', broadcast)
    } catch {
      // Denied matchMedia listeners cannot make PWA install observation fatal.
      // Existing pageshow and install events still update the UI when possible.
    }
  }
  broadcast()
}
/** Call directly from a user click; prompt() must run before any await. */
export function requestXDrivePwaInstall(): Promise<XDrivePwaPromptOutcome> {
  const pending = promptEvent
  if (!pending || displayMode() !== 'browser') return Promise.resolve('unavailable')
  promptEvent = null
  broadcast()
  try {
    return Promise.resolve(pending.prompt()).then(result => {
      lastPromptOutcome = result?.outcome === 'accepted' ? 'accepted'
        : result?.outcome === 'dismissed' ? 'dismissed' : 'unknown'
      broadcast()
      return lastPromptOutcome
    }, () => {
      lastPromptOutcome = 'error'
      broadcast()
      return 'error'
    })
  } catch {
    lastPromptOutcome = 'error'
    broadcast()
    return Promise.resolve('error')
  }
}
/** Explicit, no-credentials, same-origin HEAD checks; never query private APIs. */
export async function checkXDrivePwaAssets(
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<XDrivePwaAssetCheck[]> {
  const checks: XDrivePwaAssetCheck[] = []
  const secure = secureContextHint()
  checks.push({
    id: 'context', label: '安全上下文', state: secure ? 'pass' : 'fail',
    detail: secure ? '浏览器允许安全 Web API（不代表已验证公网 DNS 和证书部署）。'
      : '当前连接不是安全上下文。请先配置浏览器信任的 HTTPS。',
  })
  // Loopback HTTP is a secure browser context, but not a deployed HTTPS origin.
  // Restricted Safari/WebKit may deny the location object or either property
  // getter. A denial is unknown transport, never a verified HTTPS origin.
  let protocol: string | null = null
  let hostname: string | null = null
  try {
    if (typeof window !== 'undefined') {
      protocol = window.location.protocol
      hostname = window.location.hostname
    }
  } catch {
    protocol = null
    hostname = null
  }
  const https = protocol === 'https:' && typeof hostname === 'string'
  const localHTTP = protocol === 'http:' && typeof hostname === 'string' &&
    /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname)
  checks.push({
    id: 'transport', label: '实际访问协议',
    state: https && secure ? 'pass' : localHTTP && secure ? 'warn' : 'fail',
    detail: https && secure
      ? '当前页面使用 HTTPS。公网 DNS、证书链和更新生效仍需在实际设备与部署环境检查。'
      : localHTTP && secure
        ? '当前仅是本机 HTTP 安全上下文，不等于移动设备可访问的可信 HTTPS。'
        : protocol === null
          ? '浏览器拒绝读取访问协议或主机名，无法确认 HTTPS；请检查浏览器权限和部署环境。'
          : '当前页面未使用可信的 HTTPS 安全连接；请检查域名、证书和代理配置。',
  })

  const assets = [
    { id: 'manifest' as const, path: '/site.webmanifest', label: 'Web App Manifest', mime: /^(application\/(manifest\+json|json))\b/i, revalidate: true },
    { id: 'worker' as const, path: '/sw.js', label: 'Service Worker', mime: /^(text|application)\/(javascript|ecmascript)\b/i, revalidate: true },
    { id: 'offline' as const, path: '/offline.html', label: '公开离线页', mime: /^text\/html\b/i, revalidate: true },
    { id: 'icon192' as const, path: '/pwa-192.png', label: '192px 安装图标', mime: /^image\/png\b/i, revalidate: false },
    { id: 'icon512' as const, path: '/pwa-512.png', label: '512px 安装图标', mime: /^image\/png\b/i, revalidate: false },
  ]
  // One bounded budget for all five parallel HEADs; a hung proxy must not
  // retain the dialog indefinitely. Abort on unmount/close/retry as well.
  const controller = new AbortController()
  // AbortSignal alone is not a completion guarantee for restricted WebKit
  // fetch adapters. Resolve a shared interruption sentinel so even a HEAD
  // promise that never settles cannot keep the install dialog spinning.
  let interrupt!: () => void
  const interrupted = new Promise<null>(resolve => { interrupt = () => resolve(null) })
  let active = true
  let cancelRequested = false
  let internalSignalDenied = false
  // Browser shims may refuse even the optional AbortSignal state getter.
  // An unknown state cannot authorize a new HEAD request.
  const aborted = () => {
    if (cancelRequested) return true
    try { return controller.signal.aborted }
    catch { internalSignalDenied = true; return true }
  }
  const abortFromCaller = () => {
    if (!active || cancelRequested) return
    cancelRequested = true
    // Logical cancellation must release the common deadline even when an
    // uncooperative WebKit AbortController throws instead of aborting fetch.
    try { controller.abort() }
    catch { /* The interruption sentinel is independently authoritative. */ }
    interrupt()
  }
  let callerCancelObservationDenied = false
  let callerListenerAttached = false
  if (options.signal) {
    try {
      if (options.signal.aborted) {
        abortFromCaller()
      } else {
        options.signal.addEventListener('abort', abortFromCaller, { once: true })
        callerListenerAttached = true
        // Cancellation may race the first state check and listener admission.
        if (options.signal.aborted) abortFromCaller()
      }
    } catch {
      // A restricted WebKit host can deny either the state getter or listener.
      // Without a reliable cancel subscription, do not start any resource HEAD.
      callerCancelObservationDenied = true
      abortFromCaller()
    }
  }
  const budget = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(6000, Math.floor(options.timeoutMs))) : 6000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    abortFromCaller()
  }, budget)
  try {
    const assetChecks = await Promise.all(assets.map(async (asset): Promise<XDrivePwaAssetCheck> => {
      try {
        if (aborted()) throw new Error('cancelled')
        const response = await Promise.race([
          fetch(asset.path, {
            method: 'HEAD', credentials: 'omit', cache: 'no-store',
            redirect: 'error', mode: 'same-origin', signal: controller.signal,
          }),
          interrupted,
        ])
        if (response === null) throw new Error('cancelled')
        const contentType = response.headers.get('Content-Type') || ''
        if (response.status !== 200 || !asset.mime.test(contentType)) {
          return {
            id: asset.id, label: asset.label, state: 'fail',
            detail: 'HTTP ' + response.status + '；类型 ' + (contentType || '未提供') +
              '。检查静态文件是否误回退为 index.html。',
          }
        }
        const cacheControl = response.headers.get('Cache-Control') || ''
        const revalidated = /\bno-cache\b|\bno-store\b/i.test(cacheControl)
        return {
          id: asset.id, label: asset.label,
          state: !asset.revalidate || revalidated ? 'pass' : 'warn',
          detail: !asset.revalidate ? '公开安装图标类型正确；静态图标允许缓存。'
            : revalidated ? '响应类型正确，声明了重新验证缓存。'
              : '响应类型正确；未检测到禁止长期缓存的头，发布更新可能延迟。',
        }
      } catch {
        return {
          id: asset.id, label: asset.label, state: 'fail',
          detail: callerCancelObservationDenied ? '浏览器无法监听取消信号；未发送资源请求。'
            : timedOut ? '公开资源检测超时（最多 6 秒）；请检查反向代理与网络。'
            : internalSignalDenied ? '浏览器无法读取取消状态；未发送未经确认的资源请求。'
            : aborted() ? '资源检测已取消。'
              : '同源资源请求失败。请检查网络、HTTPS、代理及文件部署。',
        }
      }
    }))
    return [...checks, ...assetChecks]
  } finally {
    active = false
    clearTimeout(timer)
    if (callerListenerAttached) {
      try { options.signal?.removeEventListener('abort', abortFromCaller) }
      catch { /* Optional WebKit cleanup denial must not discard HEAD results. */ }
    }
  }
}
