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
  id: 'context' | 'manifest' | 'worker'
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
export async function checkXDrivePwaAssets(): Promise<XDrivePwaAssetCheck[]> {
  const checks: XDrivePwaAssetCheck[] = []
  const secure = typeof window !== 'undefined' && window.isSecureContext
  checks.push({
    id: 'context', label: '安全上下文', state: secure ? 'pass' : 'fail',
    detail: secure ? '浏览器允许安全 Web API（不代表已验证公网 DNS 和证书部署）。'
      : '当前连接不是安全上下文。请先配置浏览器信任的 HTTPS。',
  })
  for (const asset of [
    { id: 'manifest' as const, path: '/site.webmanifest', label: 'Web App Manifest', mime: /^(application\/(manifest\+json|json))\b/i },
    { id: 'worker' as const, path: '/sw.js', label: 'Service Worker', mime: /^(text|application)\/(javascript|ecmascript)\b/i },
  ]) {
    try {
      const response = await fetch(asset.path, {
        method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'error', mode: 'same-origin',
      })
      const contentType = response.headers.get('Content-Type') || ''
      if (response.status !== 200 || !asset.mime.test(contentType)) {
        checks.push({ id: asset.id, label: asset.label, state: 'fail',
          detail: 'HTTP ' + response.status + '；类型 ' + (contentType || '未提供') +
            '。检查静态文件是否误回退为 index.html。' })
        continue
      }
      const cacheControl = response.headers.get('Cache-Control') || ''
      const revalidated = /\bno-cache\b|\bno-store\b/i.test(cacheControl)
      checks.push({
        id: asset.id, label: asset.label,
        state: revalidated ? 'pass' : 'warn',
        detail: revalidated ? '响应类型正确，声明了重新验证缓存。'
          : '响应类型正确；未检测到禁止长期缓存的头，发布更新可能延迟。',
      })
    } catch {
      checks.push({ id: asset.id, label: asset.label, state: 'fail',
        detail: '同源资源请求失败。请检查网络、HTTPS、代理及文件部署。' })
    }
  }
  return checks
}
