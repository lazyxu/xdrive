import type { MediaBaiduMapCoverage } from './models'

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
