import type { XDriveCaddyHTTPSHostPlan } from '../service-dependencies'

// The Server/Agent transport is untrusted runtime JSON even with compile-time
// types. Reject injected fields such as "apply_supported" or "applied".
const keys = [
  'credential_revision', 'desired_revision', 'domain', 'domain_enabled',
  'lan_enabled', 'lan_ip', 'protocol',
]
function fail(): never {
  throw new Error('Caddy HTTPS 宿主机应用计划不符合安全合同，请更新 Server/Agent 并重新检查。')
}
function privateIP(value: string) {
  if (!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value)) return false
  const p = value.split('.').map(Number)
  if (p.some(n => n > 255)) return false
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168)
}
function domain(value: string) {
  if (!value || value.length > 253 || value !== value.toLowerCase()) return false
  const labels = value.split('.')
  return labels.length >= 2 &&
    labels.every(v => v.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(v)) &&
    /^[a-z]{2,}$/.test(labels[labels.length - 1] ?? '')
}

export function verifyCaddyHTTPSHostPlan(value: unknown): XDriveCaddyHTTPSHostPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const obj = value as Record<string, unknown>
  if (Object.keys(obj).sort().join(',') !== keys.join(',')) fail()
  if (obj.protocol !== 'xdrive.caddy.https.host-plan.v1' ||
      !Number.isSafeInteger(obj.desired_revision) || Number(obj.desired_revision) <= 0 ||
      !Number.isSafeInteger(obj.credential_revision) || Number(obj.credential_revision) < 0 ||
      typeof obj.domain_enabled !== 'boolean' || typeof obj.lan_enabled !== 'boolean' ||
      !((obj.domain_enabled as boolean) || (obj.lan_enabled as boolean)) ||
      typeof obj.domain !== 'string' || typeof obj.lan_ip !== 'string' ||
      (obj.domain !== '' && !domain(obj.domain)) ||
      (obj.lan_ip !== '' && !privateIP(obj.lan_ip)) ||
      (obj.domain_enabled && (obj.domain === '' || Number(obj.credential_revision) === 0)) ||
      (obj.lan_enabled && obj.lan_ip === '')) fail()
  return value as XDriveCaddyHTTPSHostPlan
}
