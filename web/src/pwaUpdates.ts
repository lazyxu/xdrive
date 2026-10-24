/** Public-only PWA version status: NEVER force a worker to take control of live clients. */
export type XDrivePwaUpdatePhase = 'unsupported' | 'idle' | 'checking' | 'checked' | 'waiting' | 'error'
export type XDrivePwaConnectionHint = 'online' | 'offline' | 'unknown'
export interface XDrivePwaUpdateSnapshot {
  phase: XDrivePwaUpdatePhase
  connectionHint: XDrivePwaConnectionHint
  hasController: boolean
  otherWindowReportedUpdate: boolean
  lastError: string | null
}

let started = false
let registration: ServiceWorkerRegistration | null = null
// Latest registration lookup wins: never resurrect an unregistered worker.
let registrationLookupEpoch = 0
let channel: BroadcastChannel | null = null
let remoteUpdateHint = false
let snapshot: XDrivePwaUpdateSnapshot | null = null
let updateCheckInFlight: Promise<XDrivePwaUpdatePhase> | null = null
const maxUpdateCheckMs = 8000
const listeners = new Set<() => void>()
const observedRegistrations = new WeakSet<ServiceWorkerRegistration>()

function connectionHint(): XDrivePwaConnectionHint {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return 'unknown'
  return navigator.onLine ? 'online' : 'offline'
}
function makeSnapshot(phase: XDrivePwaUpdatePhase, error: string | null = null): XDrivePwaUpdateSnapshot {
  return {
    phase,
    connectionHint: connectionHint(),
    hasController: typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller),
    otherWindowReportedUpdate: remoteUpdateHint,
    lastError: error,
  }
}
function publish(next: XDrivePwaUpdateSnapshot) {
  if (snapshot && Object.entries(next).every(([key, value]) =>
    snapshot?.[key as keyof XDrivePwaUpdateSnapshot] === value)) return
  snapshot = next
  for (const listener of listeners) listener()
}
function refresh() {
  const previous = snapshot?.phase ?? 'idle'
  const ready = Boolean(registration?.waiting && navigator.serviceWorker?.controller)
  publish(makeSnapshot(ready ? 'waiting' : previous === 'waiting' ? 'idle' : previous,
    snapshot?.lastError ?? null))
}
function markWaiting() {
  const newlyWaiting = snapshot?.phase !== 'waiting'
  remoteUpdateHint = false
  publish(makeSnapshot('waiting'))
  if (newlyWaiting) channel?.postMessage({ kind: 'xdrive-public-update-ready' })
}
function observeRegistration(found: ServiceWorkerRegistration) {
  const replaced = registration !== found
  registration = found
  if (!observedRegistrations.has(found)) {
    observedRegistrations.add(found)
    found.addEventListener('updatefound', () => {
      if (registration !== found) return
      const candidate = found.installing
      if (!candidate) return
      candidate.addEventListener('statechange', () => {
        if (registration === found && candidate.state === 'installed' &&
          found.waiting && navigator.serviceWorker?.controller) {
          markWaiting()
        }
      })
    })
  }
  if (found.waiting && navigator.serviceWorker?.controller) markWaiting()
  else if (snapshot?.phase !== 'checking' && (replaced || snapshot?.phase === 'error')) {
    // Successful discovery of a registered worker clears previous lookup
    // failures and obsolete 'checked' status from a retired registration.
    publish(makeSnapshot('idle'))
  } else refresh()
}
async function locateRegistration() {
  const epoch = ++registrationLookupEpoch
  try {
    const found = await navigator.serviceWorker.getRegistration()
    if (epoch !== registrationLookupEpoch) return
    // A lifecycle lookup supersedes an earlier manual check. The browser may
    // still be running the old update(), but future user clicks must not reuse
    // its obsolete promise. Its epoch guard prevents late state mutation.
    updateCheckInFlight = null
    if (!found) {
      registration = null
      remoteUpdateHint = false
      publish(makeSnapshot('idle'))
      return
    }
    observeRegistration(found)
    // An observed lifecycle change supersedes an earlier explicit update
    // check. If no waiting worker exists, finish its display-only 'checking'
    // state so a later user click is not permanently disabled.
    if (snapshot?.phase === 'checking') publish(makeSnapshot('idle'))
  } catch {
    if (epoch === registrationLookupEpoch) {
      updateCheckInFlight = null
      publish(makeSnapshot('error', '无法读取当前应用版本状态。'))
    }
  }
}
export function xDrivePwaUpdateSnapshot(): XDrivePwaUpdateSnapshot {
  return snapshot ?? (snapshot = makeSnapshot('unsupported'))
}
export function subscribeXDrivePwaUpdates(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function startXDrivePwaUpdateObservation(): void {
  if (started || typeof window === 'undefined') return
  started = true
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    publish(makeSnapshot('unsupported'))
    return
  }
  publish(makeSnapshot('idle'))
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('xdrive-pwa-public-updates')
    channel.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.kind !== 'xdrive-public-update-ready' || snapshot?.phase === 'waiting') return
      // Other windows can only suggest checking. Never claim THIS registration is waiting.
      remoteUpdateHint = true
      publish(makeSnapshot(snapshot?.phase ?? 'idle', snapshot?.lastError ?? null))
    })
  }
  window.addEventListener('online', refresh)
  window.addEventListener('offline', refresh)
  window.addEventListener('pageshow', () => { void locateRegistration() })
  window.addEventListener('xdrive-pwa-registered', () => { void locateRegistration() })
  // A controller replacement can invalidate the cached registration without
  // navigation. Refresh the controller synchronously, then verify the currently
  // installed registration (including browser-side unregister) asynchronously.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    refresh()
    void locateRegistration()
  })
  void locateRegistration()
  // First-time S1 registration happens AFTER window.load; ready resolves when it becomes active.
  void navigator.serviceWorker.ready.then(() => { void locateRegistration() }).catch(() => {})
}
/** An internal ServiceWorkerRegistration.update has no AbortSignal. Bound the
 * caller's wait without pretending to cancel the browser's own operation. */
async function checkXDrivePwaUpdateOnce(options: { timeoutMs?: number }): Promise<XDrivePwaUpdatePhase> {
  publish(makeSnapshot('checking'))
  const budget = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(maxUpdateCheckMs, Math.floor(options.timeoutMs)))
    : maxUpdateCheckMs
  let expired = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new Error('update-check-deadline'))
    }, budget)
  })
  // Never use a cached registration object for an explicit check: browsers can
  // revoke it after site-data clearing or unregister() while this tab stays open.
  const epoch = ++registrationLookupEpoch
  let fresh: ServiceWorkerRegistration | null = null
  try {
    // Registration discovery and update share ONE timeout; neither is aborted.
    const found = await Promise.race([
      navigator.serviceWorker.getRegistration(), deadline,
    ])
    if (epoch !== registrationLookupEpoch) return snapshot?.phase ?? 'idle'
    if (!found) {
      registration = null
      remoteUpdateHint = false
      publish(makeSnapshot('error', '尚未检测到此网站的 Service Worker。请联网重新打开后再检查。'))
      return 'error'
    }
    fresh = found
    if (registration !== found) observeRegistration(found)
    await Promise.race([found.update(), deadline])
    if (epoch !== registrationLookupEpoch) return snapshot?.phase ?? 'idle'
    remoteUpdateHint = false
    const phase: XDrivePwaUpdatePhase = found.waiting && navigator.serviceWorker.controller
      ? 'waiting' : 'checked'
    publish(makeSnapshot(phase))
    return phase
  } catch {
    if (epoch !== registrationLookupEpoch) return snapshot?.phase ?? 'idle'
    // A freshly discovered worker's waiting status is stronger evidence than
    // this check's timeout; a retired registration is never such evidence.
    if (fresh?.waiting && navigator.serviceWorker?.controller) {
      markWaiting()
      return 'waiting'
    }
    publish(makeSnapshot('error', expired
      ? '版本检查等待超过 8 秒；浏览器可能仍在后台检查。不会强制更新或刷新。'
      : '版本检查失败：网络或服务端可能暂时不可用。'))
    return 'error'
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** Explicit user action; coalesce repeated clicks, never force activation. */
export function checkXDrivePwaUpdate(
  options: { timeoutMs?: number } = {},
): Promise<XDrivePwaUpdatePhase> {
  if (updateCheckInFlight) return updateCheckInFlight
  if (typeof window === 'undefined' || !window.isSecureContext ||
    !('serviceWorker' in navigator)) return Promise.resolve('unsupported')
  const pending = checkXDrivePwaUpdateOnce(options)
  updateCheckInFlight = pending
  const release = () => {
    if (updateCheckInFlight === pending) updateCheckInFlight = null
  }
  // Never create a rejected, unhandled promise from a detached finally().
  void pending.then(release, release)
  return pending
}
