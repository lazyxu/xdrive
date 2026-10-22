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
