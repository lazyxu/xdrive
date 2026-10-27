/** Read-only, no-credentials server readiness probe. Never used as auth or a mutation guard. */
export type XDrivePwaServerReachability =
  | 'ready' | 'server-unavailable' | 'rate-limited' | 'access-blocked'
  | 'network-unavailable' | 'timed-out' | 'cancelled' | 'unexpected-response'
export interface XDrivePwaReadinessResult {
  state: XDrivePwaServerReachability
  httpStatus?: number
}
export async function xDriveProbePwaServer(
  options: { signal?: AbortSignal; timeoutMs?: number; request?: typeof fetch } = {},
): Promise<XDrivePwaReadinessResult> {
  if (options.signal?.aborted) return { state: 'cancelled' }
  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = Math.min(10000, Math.max(1000, options.timeoutMs ?? 6000))
  // A WebKit/proxy shim can ignore AbortSignal and leave fetch() or json()
  // pending. Race both stages against the same cancellation/deadline signal
  // instead of depending on the transport promise to reject after abort.
  let rejectAborted!: (reason: Error) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject })
  const abortRequest = () => {
    controller.abort()
    rejectAborted(new Error('PWA readiness probe aborted'))
  }
  const abortFromCaller = () => abortRequest()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => { timedOut = true; abortRequest() }, timeoutMs)
  try {
    const response = await Promise.race([
      (options.request ?? fetch)('/api/v1/readyz', {
        method: 'GET', mode: 'same-origin', credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: controller.signal,
      }),
      aborted,
    ])
    if (options.signal?.aborted) return { state: 'cancelled' }
    if (timedOut) return { state: 'timed-out' }
    if (response.status === 200) {
      // Caddy SPA fallback and reverse-proxy login pages can return 200 HTML.
      const type = response.headers.get('Content-Type') || ''
      if (!/^application\/json\b/i.test(type)) return { state: 'unexpected-response', httpStatus: 200 }
      try {
        const body = (await Promise.race([response.json(), aborted])) as { ok?: unknown }
        // fetch() resolves when headers arrive, not when its JSON body is read.
        // A cancellation or deadline during body consumption must not look
        // like malformed HTTP 200 (or a late successful readiness result).
        if (options.signal?.aborted) return { state: 'cancelled' }
        if (timedOut) return { state: 'timed-out' }
        if (body?.ok === true) return { state: 'ready', httpStatus: 200 }
      } catch {
        if (options.signal?.aborted) return { state: 'cancelled' }
        if (timedOut) return { state: 'timed-out' }
        // An actually malformed JSON body remains an unexpected response.
      }
      return { state: 'unexpected-response', httpStatus: 200 }
    }
    if (response.status === 503) return { state: 'server-unavailable', httpStatus: 503 }
    if (response.status === 429) return { state: 'rate-limited', httpStatus: 429 }
    if (response.status === 401 || response.status === 403) return { state: 'access-blocked', httpStatus: response.status }
    return { state: 'unexpected-response', httpStatus: response.status }
  } catch {
    if (options.signal?.aborted) return { state: 'cancelled' }
    if (timedOut) return { state: 'timed-out' }
    return { state: 'network-unavailable' }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
