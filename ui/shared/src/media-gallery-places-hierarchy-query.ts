import type { MediaGalleryQuery } from './models'

/**
 * The selected country/Admin1/nearest city is an Owner collection scope,
 * not a disposable filter chip. Keep its identity while editing ordinary
 * filters. Back/section changes explicitly discard this scope.
 */
export function xDriveKeepMediaPlaceHierarchyQuery(
  next: MediaGalleryQuery, current: MediaGalleryQuery, section: string,
): MediaGalleryQuery {
  if (section !== 'places' || !current.place_hierarchy) return next
  return {
    ...next,
    place: undefined,
    nearby: undefined,
    bbox: undefined,
    place_hierarchy: current.place_hierarchy,
  }
}

/**
 * Hierarchy facets use the current Gallery membership filters but never pass a
 * previous map/nearby/selected-place scope into another hierarchy request.
 * Delete omitted keys instead of setting them to undefined: Electron's IPC
 * allowlist validates own keys before JSON transport and must receive the same
 * compact query that the browser would actually send.
 */
export function xDrivePlacesHierarchyRequestFilters(
  query?: MediaGalleryQuery,
): MediaGalleryQuery {
  const filters: MediaGalleryQuery = { ...query, has_location: true }
  delete filters.place
  delete filters.place_hierarchy
  delete filters.nearby
  delete filters.bbox
  delete filters.anchor_node_id
  delete filters.initial_position
  return filters
}
