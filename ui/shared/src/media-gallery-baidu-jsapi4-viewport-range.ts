import type { MediaBaiduNativeViewportBounds, MediaGalleryQuery, MediaItemRange } from './models'

/**
 * A trusted Gallery Parent may request the currently accepted BD09 camera.
 * Never send this to /media/items, WGS84 filters or the third-party Child.
 * The Server independently verifies signed release, Owner, Consent and revisions.
 */
export function xDriveBaiduNativeViewportRangeParams(
  bounds: MediaBaiduNativeViewportBounds,
  limit: number,
  offset: number,
  query: MediaGalleryQuery,
): URLSearchParams | null {
  // The Gallery's logical map count is never folded. Unsupported filter keys
  // must fail closed rather than silently broadening an Owner photo selection.
  if (!query || typeof query !== 'object' ||
      Object.entries(query).some(([key, value]) =>
        value !== undefined && ![
          'sort_by', 'sort_dir', 'anchor_node_id', 'favorite',
          'captured_from', 'captured_to', 'time_zone', 'asset_kind',
          'fold_duplicates',
        ].includes(key)) ||
      query.fold_duplicates === true ||
      (query.asset_kind !== undefined &&
        query.asset_kind !== 'image' && query.asset_kind !== 'video'))
    return null
  if (!bounds || bounds.coordinate_space !== 'bd09ll' ||
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
    bounds.west < -180 || bounds.west > 180 || bounds.east < -180 || bounds.east > 180 ||
    bounds.south < -90 || bounds.north > 90 || bounds.south >= bounds.north ||
    bounds.west === bounds.east || (bounds.west === 180 && bounds.east === -180) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000 ||
    (query.sort_by !== undefined && query.sort_by !== 'captured' && query.sort_by !== 'added') ||
    (query.sort_dir !== undefined && query.sort_dir !== 'asc' && query.sort_dir !== 'desc') ||
    (query.anchor_node_id !== undefined &&
      (!Number.isSafeInteger(query.anchor_node_id) || query.anchor_node_id < 1)) ||
    (query.favorite !== undefined && typeof query.favorite !== 'boolean')) return null

  const params = new URLSearchParams({
    range: 'true', west: String(bounds.west), south: String(bounds.south),
    east: String(bounds.east), north: String(bounds.north),
    limit: String(limit), offset: String(offset),
    sort_by: query.sort_by ?? 'captured', sort_dir: query.sort_dir ?? 'desc',
  })
  if (query.anchor_node_id !== undefined) params.set('anchor_node_id', String(query.anchor_node_id))
  if (query.favorite !== undefined) params.set('favorite', String(query.favorite))
  const boundedOptional: ReadonlyArray<[string, string | undefined]> = [
    ['captured_from', query.captured_from], ['captured_to', query.captured_to],
    ['time_zone', query.time_zone], ['kind', query.asset_kind],
  ]
  for (const [key, value] of boundedOptional) {
    if (value !== undefined) {
      if (typeof value !== 'string' || value.trim() !== value || !value || value.length > 128) return null
      params.set(key, value)
    }
  }
  return params
}

export function xDriveValidBaiduNativeViewportRangePage(
  page: MediaItemRange, limit: number, offset: number,
): boolean {
  if (!page || page.offset !== offset || page.limit !== limit ||
    !Number.isSafeInteger(page.total_count) || page.total_count < 0 ||
    !Array.isArray(page.items) || page.items.length > limit ||
    (page.items.length > 0 && offset + page.items.length > page.total_count) ||
    (page.anchor_index !== undefined &&
      (!Number.isSafeInteger(page.anchor_index) ||
        page.anchor_index < 0 || page.anchor_index >= page.total_count))) return false
  const seen = new Set<number>()
  for (const item of page.items) {
    const id = item?.node?.id
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return false
    seen.add(id)
  }
  return true
}
