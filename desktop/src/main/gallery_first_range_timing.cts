/**
 * Monotonic, credential-free timing for the Desktop Gallery's first counted
 * media Range (offset 0). This observes the existing Agent path: it does not
 * issue an extra request, change timeouts, or affect cancellation.
 *
 * Only durations and an outcome may enter desktop.log. Never record Owner,
 * server URL, media query, node ID, request ID, or response payload.
 */
export type DesktopGalleryFirstRangeOutcome = 'ok' | 'error' | 'cancelled'

export type DesktopGalleryFirstRangeTiming = {
  result: DesktopGalleryFirstRangeOutcome
  total_ms: number
  agent_ready_ms: number | null
  pre_http_ms: number | null
  http_ms: number | null
}

export function createDesktopGalleryFirstRangeTiming(
  now: () => number = () => performance.now(),
) {
  const start = now()
  let agentReadyAt: number | null = null
  let httpStartedAt: number | null = null
  let finished = false
  const duration = (from: number, to: number) =>
    Math.round(Math.max(0, to - from) * 10) / 10

  return {
    markAgentReady() {
      if (!finished && agentReadyAt === null) agentReadyAt = now()
    },
    markHttpStarted() {
      if (!finished && httpStartedAt === null) httpStartedAt = now()
    },
    finish(result: DesktopGalleryFirstRangeOutcome): DesktopGalleryFirstRangeTiming | null {
      if (finished) return null
      finished = true
      const end = now()
      return {
        result,
        total_ms: duration(start, end),
        agent_ready_ms: agentReadyAt === null ? null : duration(start, agentReadyAt),
        pre_http_ms: agentReadyAt === null || httpStartedAt === null
          ? null : duration(agentReadyAt, httpStartedAt),
        http_ms: httpStartedAt === null ? null : duration(httpStartedAt, end),
      }
    },
  }
}
