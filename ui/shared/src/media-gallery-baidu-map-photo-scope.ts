import type { MediaGalleryQuery } from './models'
import { xDriveBaiduNativeCellsFilterParams } from './media-gallery-baidu-jsapi4-viewport-range'

// Parent-only, account-local photo membership. Never send to third-party Child.
export type XDriveBaiduMapPhotoScope = Readonly<{
  filters: MediaGalleryQuery
  albumKey: string
}>

const reviewed = new Set([
  'sort_by', 'sort_dir', 'favorite', 'asset_kind',
  'captured_from', 'captured_to', 'time_zone',
])
const sanityBounds = {
  coordinate_space: 'bd09ll' as const,
  west: 0, south: -1, east: 1, north: 1,
}
export const xDriveEmptyBaiduMapPhotoScope: XDriveBaiduMapPhotoScope = {
  filters: { sort_by: 'captured', sort_dir: 'desc' },
  albumKey: '',
}

/** Reject unknown Gallery filters instead of narrowing only the photo wall
 * while the /cells map still displays broader Owner counts. */
export function xDriveNormalizeBaiduMapPhotoScope(value: unknown): XDriveBaiduMapPhotoScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const s = value as Partial<XDriveBaiduMapPhotoScope>
  if (typeof s.albumKey !== 'string' ||
      !s.filters || typeof s.filters !== 'object' || Array.isArray(s.filters)) return null
  const raw = s.filters as MediaGalleryQuery
  if (Object.keys(raw).some(key => !reviewed.has(key))) return null
  const filters: MediaGalleryQuery = {
    sort_by: raw.sort_by ?? 'captured',
    sort_dir: raw.sort_dir ?? 'desc',
  }
  for (const field of ['favorite', 'asset_kind', 'captured_from',
    'captured_to', 'time_zone'] as const) {
    // Do not materialize undefined keys in accepted account snapshots.
    const v = raw[field]
    if (v !== undefined) Object.assign(filters, { [field]: v })
  }
  if (!xDriveBaiduNativeCellsFilterParams(sanityBounds, filters, s.albumKey))
    return null
  return { filters, albumKey: s.albumKey }
}

export function xDriveBaiduMapPhotoScopeKey(value: XDriveBaiduMapPhotoScope): string {
  const normalized = xDriveNormalizeBaiduMapPhotoScope(value)
  if (!normalized) return 'invalid-bd09-map-scope'
  return JSON.stringify([normalized.albumKey,
    Object.entries(normalized.filters)
      .filter(([,v]) => v !== undefined)
      .sort(([a],[b]) => a.localeCompare(b))])
}

/** An explicit mode switch destroys the JavaScript document. Until an
 * authenticated, one-use Server handoff exists, never drop a restricted
 * Album/date/favorite/media/sort membership in EITHER direction.
 *
 * A time zone with no captured date bound is not a membership restriction;
 * no private Owner/GPS/Album identity is placed in the navigation URL,
 * history state or storage shared with the same-document third-party SDK.
 */
export function xDriveBaiduMapScopeSurvivesFullReload(value: unknown): boolean {
  const scope = xDriveNormalizeBaiduMapPhotoScope(value)
  if (!scope || scope.albumKey !== '') return false
  const filters = scope.filters
  return filters.favorite === undefined && filters.asset_kind === undefined &&
    filters.captured_from === undefined && filters.captured_to === undefined &&
    filters.sort_by === 'captured' && filters.sort_dir === 'desc'
}

export function xDriveCopyBaiduMapPhotoScope(
  scope: XDriveBaiduMapPhotoScope,
): XDriveBaiduMapPhotoScope | null {
  return xDriveNormalizeBaiduMapPhotoScope(scope)
}
