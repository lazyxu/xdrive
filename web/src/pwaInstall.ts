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
  if (typeof navigator === 'undefined') return 'other'
  const userAgent = navigator.userAgent || ''
  // UA is only a copywriting hint. Real installation depends on browser events.
  if (/iPad|iPhone|iPod/i.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'other'
}
function displayMode(): XDrivePwaDisplayMode {
  if (typeof window === 'undefined') return 'browser'
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'] as const) {
    if (window.matchMedia?.('(display-mode: ' + mode + ')').matches) return mode
  }
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return 'standalone'
  return 'browser'
}
function readSnapshot(): XDrivePwaInstallSnapshot {
  return {
    displayMode: displayMode(),
    platformHint: platformHint(),
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    serviceWorkerSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
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
  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)
  window.addEventListener('pageshow', broadcast)
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
    window.matchMedia?.('(display-mode: ' + mode + ')').addEventListener?.('change', broadcast)
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
  const secure = typeof window !== 'undefined' && window.isSecureContext
  checks.push({
    id: 'context', label: '安全上下文', state: secure ? 'pass' : 'fail',
    detail: secure ? '浏览器允许安全 Web API（不代表已验证公网 DNS 和证书部署）。'
      : '当前连接不是安全上下文。请先配置浏览器信任的 HTTPS。',
  })
  // Loopback HTTP is a secure browser context, but not a deployed HTTPS origin.
  // Do not misrepresent local testing as a trusted mobile device certificate.
  const origin = typeof window === 'undefined' ? undefined : window.location
  const https = origin?.protocol === 'https:'
  const localHTTP = origin?.protocol === 'http:' &&
    /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(origin.hostname)
  checks.push({
    id: 'transport', label: '实际访问协议',
    state: https && secure ? 'pass' : localHTTP && secure ? 'warn' : 'fail',
    detail: https && secure
      ? '当前页面使用 HTTPS。公网 DNS、证书链和更新生效仍需在实际设备与部署环境检查。'
      : localHTTP && secure
        ? '当前仅是本机 HTTP 安全上下文，不等于移动设备可访问的可信 HTTPS。'
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
  const abortFromCaller = () => { controller.abort() }
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const budget = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(6000, Math.floor(options.timeoutMs))) : 6000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, budget)
  try {
    const assetChecks = await Promise.all(assets.map(async (asset): Promise<XDrivePwaAssetCheck> => {
      try {
        if (controller.signal.aborted) throw new Error('cancelled')
        const response = await fetch(asset.path, {
          method: 'HEAD', credentials: 'omit', cache: 'no-store',
          redirect: 'error', mode: 'same-origin', signal: controller.signal,
        })
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
          detail: timedOut ? '公开资源检测超时（最多 6 秒）；请检查反向代理与网络。'
            : controller.signal.aborted ? '资源检测已取消。'
              : '同源资源请求失败。请检查网络、HTTPS、代理及文件部署。',
        }
      }
    }))
    return [...checks, ...assetChecks]
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
