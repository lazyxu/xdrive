import type { XDriveCaddyHTTPSConfig } from './service-dependencies'

// This is a local host-vs-saved-target comparison, NEVER an applied-revision
// receipt, WAN check, DNS assertion, or end-device CA verification.
export type XDriveCaddyLANLocalMatch = 'unverified' | 'matched-local' | 'mismatch-local'

export function hasPersistedCaddyIntent(
  config: XDriveCaddyHTTPSConfig | null | undefined,
): config is XDriveCaddyHTTPSConfig {
  return !!config && Number.isSafeInteger(config.revision) && config.revision > 0 &&
    (config.source === 'saved' || config.source === 'host-import')
}

export function caddyLANLocalMatch(
  config: XDriveCaddyHTTPSConfig | null | undefined,
): XDriveCaddyLANLocalMatch {
  if (!hasPersistedCaddyIntent(config) ||
    config.host_observed !== true || config.host_lan_configured !== true ||
    config.host_lan_tls_state !== 'verified' ||
    typeof config.host_lan_ip !== 'string' || config.host_lan_ip.trim() === '' ||
    typeof config.desired_lan_enabled !== 'boolean' ||
    typeof config.desired_lan_ip !== 'string') {
    return 'unverified'
  }
  // An enabled target with an absent/noncanonical IP is not known to differ.
  if (config.desired_lan_enabled &&
    (config.desired_lan_ip.trim() === '' ||
      config.desired_lan_ip !== config.desired_lan_ip.trim())) {
    return 'unverified'
  }
  return !config.desired_lan_enabled || config.desired_lan_ip !== config.host_lan_ip
    ? 'mismatch-local' : 'matched-local'
}
