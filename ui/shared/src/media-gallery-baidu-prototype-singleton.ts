import type { MediaGalleryQuery, MediaItem, MediaItemRange, MediaPlaceFacet } from './models'

/** P0-07: a same-page prototype cover is NEVER media authorization.
 * Only a fresh Owner-scoped original GPS place Range may open a singleton.
 * An exact original Server GPS cell, never an SDK-derived approximate
 * map-region or numeric alias. The bounds match the indexed 0.01° cell range. */
export function xDrivePrototypeCanonicalPlaceID(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false
  const parts = /^place:(-?(?:0|[1-9]\d*)):(-?(?:0|[1-9]\d*))$/.exec(value)
  if (!parts) return false
  const lat = Number(parts[1]), lng = Number(parts[2])
  return Number.isSafeInteger(lat) && lat >= -9000 && lat <= 9000 &&
    Number.isSafeInteger(lng) && lng >= -18000 && lng <= 18000 &&
    value === 'place:' + lat + ':' + lng
}

/** A direct singleton must use the actual source place + Owner filters,
 * never the nearby/bbox WGS84 approximation, hierarchy, or stale anchor.
 * User-selected favorite, date and media filters remain scoped as before. */
export function xDrivePrototypeSingletonScopeValid(
  place: MediaPlaceFacet, query: MediaGalleryQuery,
): boolean {
  if (!xDrivePrototypeCanonicalPlaceID(place?.id) || !query ||
      typeof query !== 'object' || Array.isArray(query)) return false
  return query.place === place.id && query.has_location === true &&
    query.fold_duplicates === false &&
    query.nearby === undefined && query.bbox === undefined &&
    query.place_hierarchy === undefined &&
    query.anchor_node_id === undefined && query.initial_position === undefined &&
    query.fold_member_ids === undefined
}

export function xDrivePrototypeTrustedSingleton(
  place: MediaPlaceFacet, range: MediaItemRange,
): MediaItem | null {
  if (!place || !xDrivePrototypeCanonicalPlaceID(place.id) ||
      place.item_count !== 1 || !range ||
      range.offset !== 0 || range.limit !== 1 ||
      range.total_count !== 1 ||
      (range.anchor_index !== undefined && range.anchor_index !== 0) ||
      !Array.isArray(range.items) ||
      range.items.length !== 1) return null
  const item = range.items[0]
  // Original Owner Range must supply an active, versioned media Node.
  // A stale/deleted Node or malformed metadata must not be promoted to Viewer,
  // even when its ID happens to match a cached representative cover.
  if (!item?.node || item.node.type !== 'file' ||
      !Number.isSafeInteger(item.node.id) || item.node.id <= 0 ||
      !Number.isSafeInteger(item.node.revision) || item.node.revision < 1 ||
      (item.node.deleted_at !== undefined && item.node.deleted_at !== null) ||
      (item.metadata?.media_kind !== 'image' && item.metadata?.media_kind !== 'video')) return null
  const cover = place.cover_node_id
  if (cover !== undefined && cover !== null &&
      (!Number.isSafeInteger(cover) || cover <= 0 || cover !== item.node.id)) return null
  return item
}
