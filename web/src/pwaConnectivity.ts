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
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const response = await (options.request ?? fetch)('/api/v1/readyz', {
      method: 'GET', mode: 'same-origin', credentials: 'omit', cache: 'no-store',
      redirect: 'error', signal: controller.signal,
    })
    if (options.signal?.aborted) return { state: 'cancelled' }
    if (response.status === 200) {
      // Caddy SPA fallback and reverse-proxy login pages can return 200 HTML.
      const type = response.headers.get('Content-Type') || ''
      if (!/^application\/json\b/i.test(type)) return { state: 'unexpected-response', httpStatus: 200 }
      try {
        const body = (await response.json()) as { ok?: unknown }
        if (body?.ok === true) return { state: 'ready', httpStatus: 200 }
      } catch { /* Malformed readiness is never healthy. */ }
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
