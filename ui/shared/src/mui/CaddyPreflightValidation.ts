import type {
  XDriveCaddyHTTPSPreflight,
  XDriveCaddyPreflightCheck,
  XDriveCaddyAliDNSReadVerify,
  XDriveCaddyAliDNSReadVerifyInput,
} from '../service-dependencies'

// IPC/HTTP are runtime data, regardless of the TypeScript declarations.
// Missing/mismatched fields must never produce a green local prerequisite or
// AliDNS authorization result on either Web or Desktop.
const checkIDs: XDriveCaddyPreflightCheck['id'][] = [
  'desired', 'domain', 'alidns', 'host-manager', 'ingress', 'restricted-apply', 'public-https',
]
const checkStates: XDriveCaddyPreflightCheck['state'][] = [
  'pass', 'missing', 'blocked', 'unknown', 'not-required',
]

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
}

function invalidPreflight(): never {
  throw new Error('HTTPS 预检响应不完整或与安全合同矛盾，请更新 Server/Agent 后重新预检。')
}

export function verifyCaddyPreflightContract(value: unknown): XDriveCaddyHTTPSPreflight {
  if (!isObject(value) || !isTimestamp(value.checked_at) ||
      !['enable', 'disable', 'unset'].includes(value.action as string) ||
      !isRevision(value.desired_revision) || !isRevision(value.credential_revision) ||
      typeof value.configuration_complete !== 'boolean' ||
      typeof value.host_observed !== 'boolean' ||
      typeof value.host_ingress_ready !== 'boolean' ||
      typeof value.host_local_tls_verified !== 'boolean' ||
      value.apply_supported !== false || !Array.isArray(value.checks) ||
      value.checks.length !== checkIDs.length) invalidPreflight()

  const byID = new Map<XDriveCaddyPreflightCheck['id'], XDriveCaddyPreflightCheck['state']>()
  for (const item of value.checks) {
    if (!isObject(item) ||
        !checkIDs.includes(item.id as XDriveCaddyPreflightCheck['id']) ||
        !checkStates.includes(item.state as XDriveCaddyPreflightCheck['state']) ||
        typeof item.detail !== 'string' || item.detail.length === 0 ||
        item.detail.length > 512 ||
        byID.has(item.id as XDriveCaddyPreflightCheck['id'])) invalidPreflight()
    byID.set(item.id as XDriveCaddyPreflightCheck['id'], item.state as XDriveCaddyPreflightCheck['state'])
  }
  if (byID.size !== checkIDs.length ||
      byID.get('restricted-apply') !== 'blocked' ||
      byID.get('public-https') !== 'unknown' ||
      (value.host_ingress_ready && !value.host_observed) ||
      (value.host_local_tls_verified && !value.host_observed)) invalidPreflight()

  // Old Server/Agent can omit this optional signal. A "matched" or
  // "mismatched" LOCAL hostname requires a real successful observed TLS
  // handshake and valid enable-intent domain, but never proves apply.
  if (value.desired_domain_local_match !== undefined &&
      (typeof value.desired_domain_local_match !== 'string' ||
       !['matched-local', 'mismatch-local', 'unverified'].includes(value.desired_domain_local_match) ||
       (value.desired_domain_local_match !== 'unverified' &&
        (value.action !== 'enable' || !value.host_observed ||
         !value.host_ingress_ready || !value.host_local_tls_verified ||
         byID.get('domain') !== 'pass')))) invalidPreflight()

  // Old Server/Agent may omit this fixed-container startup observation.
  // A non-neutral state requires existing authenticated local TLS evidence,
  // but never permits Apply/Stop/Restart or proves the desired revision.
  if (value.host_runtime_tls_alignment !== undefined &&
      (typeof value.host_runtime_tls_alignment !== 'string' ||
       !['unverified', 'matched-local', 'mismatch-local'].includes(value.host_runtime_tls_alignment) ||
       (value.host_runtime_tls_alignment !== 'unverified' &&
        (!value.host_observed || !value.host_ingress_ready ||
         !value.host_local_tls_verified)))) invalidPreflight()

  // Old Server/Agent may omit the live Caddy admin API observation. A
  // positive state requires the same fresh locally TLS-verified fixed host,
  // but does not mean the administrator's desired revision was deployed.
  if (value.host_live_config_state !== undefined &&
      (typeof value.host_live_config_state !== 'string' ||
       !['observed-local', 'unverified'].includes(value.host_live_config_state) ||
       (value.host_live_config_state === 'observed-local' &&
        (!value.host_observed || !value.host_ingress_ready ||
         !value.host_local_tls_verified)))) invalidPreflight()

  // A new Host Manager may fence local observations to one fixed Docker
  // container/start generation. Old Server/Agent omits this optional enum.
  // It is not evidence of a revision-bound config apply or rescue ingress.
  if (value.host_instance_generation !== undefined &&
      (typeof value.host_instance_generation !== 'string' ||
       !['same-instance-local', 'unverified'].includes(value.host_instance_generation) ||
       (value.host_instance_generation === 'same-instance-local' &&
        (!value.host_observed || !value.host_ingress_ready ||
         !value.host_local_tls_verified)) ||
       (value.host_instance_generation === 'unverified' &&
        (value.host_live_config_state === 'observed-local' ||
         value.host_runtime_tls_alignment === 'matched-local' ||
         value.host_runtime_tls_alignment === 'mismatch-local' ||
         value.desired_domain_local_match === 'matched-local' ||
         value.desired_domain_local_match === 'mismatch-local')))) invalidPreflight()

  // Old Server/Agent can omit this advisory. Positive warnings require
  // actual verified local HTTPS. Never accept an arbitrary claim as a
  // deployment or rollback authorization.
  if (value.ingress_change_risk !== undefined &&
      (typeof value.ingress_change_risk !== 'string' ||
       !['unverified', 'local-https-removal', 'local-domain-switch'].includes(value.ingress_change_risk) ||
       (value.ingress_change_risk !== 'unverified' &&
        (!value.host_observed || !value.host_ingress_ready ||
         !value.host_local_tls_verified || value.desired_revision === 0)) ||
       (value.ingress_change_risk === 'local-https-removal' &&
        value.action !== 'disable') ||
       (value.ingress_change_risk === 'local-domain-switch' &&
        (value.action !== 'enable' || value.desired_domain_local_match !== 'mismatch-local' ||
         byID.get('domain') !== 'pass')))) invalidPreflight()

  // Old Agent/Server may omit the new read-window evidence. A new Server
  // returns it only after both settings were read in a repeatable-read
  // snapshot and exactly rechecked. Neither true nor missing authorizes apply.
  if (value.revision_snapshot_consistent !== undefined &&
      value.revision_snapshot_consistent !== true) invalidPreflight()

  if (value.action === 'unset') {
    if (value.desired_revision !== 0 || value.configuration_complete ||
        byID.get('desired') !== 'missing') invalidPreflight()
  } else {
    if (value.desired_revision === 0 || byID.get('desired') !== 'pass') invalidPreflight()
    if (value.action === 'enable') {
      if (value.configuration_complete &&
          (value.credential_revision === 0 || byID.get('domain') !== 'pass' ||
           byID.get('alidns') !== 'pass')) invalidPreflight()
    } else if (byID.get('domain') !== 'not-required' || byID.get('alidns') !== 'not-required') {
      invalidPreflight()
    }
  }
  return value as XDriveCaddyHTTPSPreflight
}

function invalidAliDNSResult(): never {
  throw new Error('AliDNS 只读验证响应不符合修订和安全合同，请重新检查配置。')
}

export function verifyCaddyAliDNSReadContract(
  value: unknown,
  expected: XDriveCaddyAliDNSReadVerifyInput,
): XDriveCaddyAliDNSReadVerify {
  if (!isObject(value) || !['read_authorized', 'denied', 'unavailable'].includes(value.state as string) ||
      !isTimestamp(value.checked_at) ||
      !isRevision(value.desired_revision) || !isRevision(value.credential_revision) ||
      value.desired_revision !== expected.desired_revision ||
      value.credential_revision !== expected.credential_revision ||
      value.read_permission_verified !== (value.state === 'read_authorized') ||
      value.write_permission_verified !== false ||
      value.apply_supported !== false || value.public_https_verified !== false ||
      typeof value.detail !== 'string' || value.detail.length === 0 || value.detail.length > 512) {
    invalidAliDNSResult()
  }
  return value as XDriveCaddyAliDNSReadVerify
}
