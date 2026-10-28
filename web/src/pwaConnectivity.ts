/** Read-only, no-credentials server readiness probe. Never used as auth or a mutation guard. */
export type XDrivePwaServerReachability =
  | 'ready' | 'server-unavailable' | 'rate-limited' | 'access-blocked'
  | 'network-unavailable' | 'timed-out' | 'cancelled' | 'browser-restricted'
  | 'unexpected-response'
export interface XDrivePwaReadinessResult {
  state: XDrivePwaServerReachability
  httpStatus?: number
}
export async function xDriveProbePwaServer(
  options: { signal?: AbortSignal; timeoutMs?: number; request?: typeof fetch } = {},
): Promise<XDrivePwaReadinessResult> {
  // Optional WebKit AbortSignal getters/listeners can throw. A readiness
  // request must not run if the caller's cancellation cannot be observed:
  // this is an advisory, anonymous probe, never a license to skip auth.
  const caller = options.signal
  if (caller) {
    try {
      if (caller.aborted) return { state: 'cancelled' }
    } catch {
      return { state: 'browser-restricted' }
    }
  }

  const controller = new AbortController()
  let timedOut = false
  let callerCancelled = false
  let finished = false
  let listenerAttached = false
  const timeoutMs = Math.min(10000, Math.max(1000, options.timeoutMs ?? 6000))

  // An uncooperative WebKit/proxy shim may never settle fetch() or json()
  // after AbortSignal. Resolve this sentinel (never an unhandled rejection)
  // so the same interruption bounds both the headers and body phases.
  let interrupt!: () => void
  const interrupted = new Promise<null>(resolve => { interrupt = () => resolve(null) })
  const abortRequest = () => {
    if (finished) return
    try { controller.abort() } catch { /* Logical cancellation still wins. */ }
    interrupt()
  }
  const abortFromCaller = () => {
    callerCancelled = true
    abortRequest()
  }
  const detach = () => {
    if (!caller || !listenerAttached) return
    listenerAttached = false
    try { caller.removeEventListener('abort', abortFromCaller) }
    catch { /* A denied cleanup cannot discard the settled result. */ }
  }

  if (caller) {
    try {
      caller.addEventListener('abort', abortFromCaller, { once: true })
      listenerAttached = true
      // Close the check -> subscribe race without sending any premature GET.
      if (caller.aborted) abortFromCaller()
    } catch {
      finished = true
      detach()
      return { state: 'browser-restricted' }
    }
  }
  if (callerCancelled) {
    finished = true
    detach()
    return { state: 'cancelled' }
  }

  const timer = setTimeout(() => { timedOut = true; abortRequest() }, timeoutMs)
  try {
    const response = await Promise.race([
      (options.request ?? fetch)('/api/v1/readyz', {
        method: 'GET', mode: 'same-origin', credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: controller.signal,
      }),
      interrupted,
    ])
    if (callerCancelled) return { state: 'cancelled' }
    if (timedOut) return { state: 'timed-out' }
    if (response === null) return { state: 'network-unavailable' }
    if (response.status === 200) {
      // A Caddy SPA fallback or proxy login page is not a ready Server.
      const type = response.headers.get('Content-Type') || ''
      if (!/^application\/json\b/i.test(type)) return { state: 'unexpected-response', httpStatus: 200 }
      try {
        const body = await Promise.race([response.json(), interrupted]) as { ok?: unknown } | null
        if (callerCancelled) return { state: 'cancelled' }
        if (timedOut) return { state: 'timed-out' }
        if (body?.ok === true) return { state: 'ready', httpStatus: 200 }
      } catch {
        if (callerCancelled) return { state: 'cancelled' }
        if (timedOut) return { state: 'timed-out' }
        // Actually malformed JSON remains unexpected, not a ready Server.
      }
      return { state: 'unexpected-response', httpStatus: 200 }
    }
    if (response.status === 503) return { state: 'server-unavailable', httpStatus: 503 }
    if (response.status === 429) return { state: 'rate-limited', httpStatus: 429 }
    if (response.status === 401 || response.status === 403) return { state: 'access-blocked', httpStatus: response.status }
    return { state: 'unexpected-response', httpStatus: response.status }
  } catch {
    if (callerCancelled) return { state: 'cancelled' }
    if (timedOut) return { state: 'timed-out' }
    return { state: 'network-unavailable' }
  } finally {
    finished = true
    clearTimeout(timer)
    detach()
  }
}
