/**
 * S5-A2a: user-requested, in-memory PWA browser observation. This is NOT
 * OS installation attestation and must never turn physical acceptance green.
 *
 * No private REST, storage, camera, location, UA string, file bytes or auth.
 * Existing public HEAD checks are merely summarized when already performed.
 */
import { xDrivePwaInstallSnapshot } from './pwaInstall'
import type { XDrivePwaAssetCheck } from './pwaInstall'

const publicCheckIds = ['context', 'transport', 'manifest', 'worker', 'offline', 'icon192', 'icon512'] as const
type PublicCheckId = (typeof publicCheckIds)[number]
type PublicCheckState = 'pass' | 'warn' | 'fail' | 'not_run'

export interface XDrivePwaDeviceEvidence {
  schema: 'xdrive-pwa-s5a2-browser-observation-v1'
  case_id: 'S5-02'
  captured_by: 'explicit_user_click'
  observed_at: string
  origin_sha256: string | null
  platform_hint_only: 'ios' | 'android' | 'other'
  display_mode_observed: 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui' | 'window-controls-overlay'
  navigator_standalone_observed: boolean | null
  transport_observed: 'https' | 'http' | 'other'
  secure_context_observed: boolean
  service_worker_api_supported: boolean
  service_worker_controller_observed: boolean
  service_worker_matches_public_script: boolean
  viewport_css_px: { width: number; height: number }
  public_asset_checks: Record<PublicCheckId, PublicCheckState>
  installation_from_os_icon_verified: 'NOT_VERIFIED'
  trusted_os_certificate_verified: 'NOT_VERIFIED'
  physical_device_acceptance: 'NOT_RUN'
  release_gate: 'NO_GO_PHYSICAL_INSTALL_NOT_RUN'
}

async function hashOrigin(): Promise<string | null> {
  try {
    if (!window.crypto?.subtle || !window.location?.origin) return null
    const data = new TextEncoder().encode(window.location.origin)
    const digest = await window.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    // Never fall back to displaying the raw origin or to a fake digest.
    return null
  }
}

function observedPublicChecks(checks: readonly XDrivePwaAssetCheck[] | null): Record<PublicCheckId, PublicCheckState> {
  const result = {} as Record<PublicCheckId, PublicCheckState>
  for (const id of publicCheckIds) {
    const value = checks?.find(check => check.id === id)?.state
    // Copy only a trusted status; do not export 'detail' or arbitrary text.
    result[id] = value === 'pass' || value === 'warn' || value === 'fail' ? value : 'not_run'
  }
  return result
}

export async function collectXDrivePwaS5DeviceEvidence(
  existingPublicChecks: readonly XDrivePwaAssetCheck[] | null = null,
): Promise<XDrivePwaDeviceEvidence> {
  const snapshot = xDrivePwaInstallSnapshot()
  const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker
  let publicScript = false
  try {
    const rawScript = sw?.controller?.scriptURL
    if (rawScript) {
      const url = new URL(rawScript, window.location.origin)
      publicScript = url.origin === window.location.origin && url.pathname === '/sw.js' &&
        !url.search && !url.hash
    }
  } catch {
    publicScript = false
  }
  const mode = snapshot.displayMode
  const protocol = typeof window !== 'undefined' ? window.location.protocol : ''
  const standalone = typeof navigator === 'undefined' ? null :
    (navigator as Navigator & { standalone?: boolean }).standalone
  const width = typeof window === 'undefined' ? 0 : window.innerWidth
  const height = typeof window === 'undefined' ? 0 : window.innerHeight
  const report: XDrivePwaDeviceEvidence = {
    schema: 'xdrive-pwa-s5a2-browser-observation-v1',
    case_id: 'S5-02',
    captured_by: 'explicit_user_click',
    observed_at: new Date().toISOString(),
    origin_sha256: typeof window === 'undefined' ? null : await hashOrigin(),
    platform_hint_only: snapshot.platformHint,
    display_mode_observed: mode,
    navigator_standalone_observed: typeof standalone === 'boolean' ? standalone : null,
    transport_observed: protocol === 'https:' ? 'https' : protocol === 'http:' ? 'http' : 'other',
    secure_context_observed: snapshot.secureContext,
    service_worker_api_supported: snapshot.serviceWorkerSupported,
    service_worker_controller_observed: Boolean(sw?.controller),
    service_worker_matches_public_script: publicScript,
    viewport_css_px: {
      width: Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0,
      height: Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0,
    },
    public_asset_checks: observedPublicChecks(existingPublicChecks),
    installation_from_os_icon_verified: 'NOT_VERIFIED',
    trusted_os_certificate_verified: 'NOT_VERIFIED',
    physical_device_acceptance: 'NOT_RUN',
    release_gate: 'NO_GO_PHYSICAL_INSTALL_NOT_RUN',
  }
  return report
}
