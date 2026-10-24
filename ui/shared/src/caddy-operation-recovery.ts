import type { XDriveCaddyDeployState } from './service-dependencies'

const requestID = /^[0-9a-f]{24}$/
const digest = /^[0-9a-f]{64}$/
const recentTerminalWindowMs = 5 * 60 * 1000

function validReceipt(item: XDriveCaddyDeployState | null | undefined):
  item is XDriveCaddyDeployState {
  return !!item && item.protocol === 'xdrive.caddy.host-env.v1' &&
    requestID.test(item.request_id) && digest.test(item.sha256) &&
    (item.state === 'deploying' || item.state === 'deployed' || item.state === 'failed')
}

// A queued/active Host request outranks browser and archival history.
// A recent archive only restores an empty view or completes the SAME request;
// it must never replace another active operation or regress a terminal to
// "deploying". Read-only selection: no Save, Deploy, Docker or credentials.
export function xDriveReconcileCaddyDeployReceipt(
  prior: XDriveCaddyDeployState | null,
  current: XDriveCaddyDeployState | null | undefined,
  latest: XDriveCaddyDeployState | null | undefined,
  nowMs: number,
): XDriveCaddyDeployState | null {
  const host = validReceipt(current) ? current : null
  const recordedAt = typeof latest?.recorded_at === 'string'
    ? Date.parse(latest.recorded_at) : NaN
  const recentHistory = validReceipt(latest) && latest.state !== 'deploying' &&
    Number.isFinite(recordedAt) && recordedAt <= nowMs &&
    nowMs - recordedAt < recentTerminalWindowMs ? latest : null
  const recovered = host ?? recentHistory
  if (!recovered) return prior
  if (!prior) return recovered

  const sameRequest = prior.request_id === recovered.request_id &&
    prior.sha256 === recovered.sha256
  if (!sameRequest) return host ? recovered : prior
  if (prior.state === 'deploying' && recovered.state !== 'deploying') {
    return recovered
  }
  // A historical/stale "deploying" or conflicting terminal must not downgrade
  // an already resolved original request.
  return prior
}
