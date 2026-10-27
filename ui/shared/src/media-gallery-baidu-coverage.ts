import type { MediaBaiduMapCoverage, MediaBaiduMapCoverageReasons } from './models'

const fields = new Set(['scope','valid_gps_assets','eligible_bd09_assets',
  'not_eligible_bd09_assets','source_outside_camera_latitude_assets','map_runtime_verified'])
const nonnegative = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** Reject raw GPS, IDs, incomplete count snapshots and invented permission evidence. */
export function xDriveValidBaiduMapCoverage(value: unknown): MediaBaiduMapCoverage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  if (Object.keys(r).length !== fields.size || Object.keys(r).some(k => !fields.has(k)) ||
      r.scope !== 'indexed_ready_photoassets' || r.map_runtime_verified !== false) return null
  for (const key of ['valid_gps_assets','eligible_bd09_assets',
    'not_eligible_bd09_assets','source_outside_camera_latitude_assets']) {
    if (!nonnegative(r[key])) return null
  }
  const total = r.valid_gps_assets as number
  const eligible = r.eligible_bd09_assets as number
  const missing = r.not_eligible_bd09_assets as number
  const outside = r.source_outside_camera_latitude_assets as number
  if (eligible > total || missing !== total - eligible || outside > total) return null
  return { scope:'indexed_ready_photoassets', valid_gps_assets:total,
    eligible_bd09_assets:eligible, not_eligible_bd09_assets:missing,
    source_outside_camera_latitude_assets:outside, map_runtime_verified:false }
}

/** Explanation only, never consent or proof that the map SDK is running.
 * Based on a single validated Owner-local, indexed-ready coverage snapshot. */
export type XDriveBaiduMapCoverageState =
  | 'unverified' | 'no-valid-gps' | 'none-displayable'
  | 'partial' | 'complete'

export function xDriveBaiduMapCoverageState(value: unknown): XDriveBaiduMapCoverageState {
  const counts = xDriveValidBaiduMapCoverage(value)
  if (!counts) return 'unverified'
  if (counts.valid_gps_assets === 0) return 'no-valid-gps'
  if (counts.eligible_bd09_assets === 0) return 'none-displayable'
  return counts.not_eligible_bd09_assets > 0 ? 'partial' : 'complete'
}

const reasonFields = new Set(['scope','valid_gps_assets','eligible_bd09_assets',
  'not_eligible_bd09_assets','consent_unavailable_assets',
  'consent_source_changed_assets','derived_missing_assets','derived_invalid_assets',
  'map_runtime_verified'])

/** Legacy consent counters must remain zero; real gaps are derived state. */
export function xDriveValidBaiduMapCoverageReasons(value: unknown): MediaBaiduMapCoverageReasons | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== reasonFields.size ||
      Object.keys(v).some(k => !reasonFields.has(k)) ||
      v.scope !== 'indexed_ready_photoassets' || v.map_runtime_verified !== false) return null
  const keys = ['valid_gps_assets','eligible_bd09_assets','not_eligible_bd09_assets',
    'consent_unavailable_assets','consent_source_changed_assets',
    'derived_missing_assets','derived_invalid_assets'] as const
  if (keys.some(k => !nonnegative(v[k]))) return null
  const total = v.valid_gps_assets as number
  const eligible = v.eligible_bd09_assets as number
  const missing = v.not_eligible_bd09_assets as number
  if (eligible > total || missing !== total - eligible ||
      v.consent_unavailable_assets !== 0 || v.consent_source_changed_assets !== 0) return null
  let remainder = missing
  for (const key of keys.slice(3)) {
    const count = v[key] as number
    if (count > remainder) return null
    remainder -= count
  }
  if (remainder !== 0) return null
  return {
    scope:'indexed_ready_photoassets', valid_gps_assets:total,
    eligible_bd09_assets:eligible, not_eligible_bd09_assets:missing,
    consent_unavailable_assets:v.consent_unavailable_assets as number,
    consent_source_changed_assets:v.consent_source_changed_assets as number,
    derived_missing_assets:v.derived_missing_assets as number,
    derived_invalid_assets:v.derived_invalid_assets as number,
    map_runtime_verified:false,
  }
}

/** Detect a *validly-shaped*, stale Server response from the retired photo
 * consent era. This is a diagnosis only: the current strict validator still
 * rejects such reasons, and no previous photo authorization is restored.
 * Both independent Owner summary and breakdown totals must agree. */
export function xDriveBaiduMapHasLegacyConsentReasons(
  coverage: unknown, reasons: unknown,
): boolean {
  const summary = xDriveValidBaiduMapCoverage(coverage)
  if (!summary || !reasons || typeof reasons !== 'object' || Array.isArray(reasons)) return false
  const r = reasons as Record<string, unknown>
  if (Object.keys(r).length !== reasonFields.size ||
      Object.keys(r).some(key => !reasonFields.has(key)) ||
      r.scope !== 'indexed_ready_photoassets' || r.map_runtime_verified !== false) return false
  const keys = ['valid_gps_assets','eligible_bd09_assets','not_eligible_bd09_assets',
    'consent_unavailable_assets','consent_source_changed_assets',
    'derived_missing_assets','derived_invalid_assets'] as const
  if (keys.some(key => !nonnegative(r[key]))) return false
  if (r.valid_gps_assets !== summary.valid_gps_assets ||
      r.eligible_bd09_assets !== summary.eligible_bd09_assets ||
      r.not_eligible_bd09_assets !== summary.not_eligible_bd09_assets) return false
  const retired = (r.consent_unavailable_assets as number) +
    (r.consent_source_changed_assets as number)
  return retired > 0 && retired <= summary.not_eligible_bd09_assets &&
    retired + (r.derived_missing_assets as number) +
      (r.derived_invalid_assets as number) === summary.not_eligible_bd09_assets
}
/** Equal totals are a necessary (not sufficient) cross-request consistency
 * check. It does not prove the two SQL snapshots share photo membership. */
export function xDriveBaiduMapCoverageReasonTotalsMatch(
  coverage: unknown, reasons: unknown,
): boolean {
  const summary = xDriveValidBaiduMapCoverage(coverage)
  const detail = xDriveValidBaiduMapCoverageReasons(reasons)
  return Boolean(summary && detail &&
    summary.valid_gps_assets === detail.valid_gps_assets &&
    summary.eligible_bd09_assets === detail.eligible_bd09_assets &&
    summary.not_eligible_bd09_assets === detail.not_eligible_bd09_assets)
}
