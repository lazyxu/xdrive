import type { MediaPlaceFacet, MediaPlacesMapOverview } from './models'
import type { MediaGalleryDataSource, MediaThumbnailLoader } from './mui/MediaGallery'
import { xDriveOwnerGPSCanOpenPlace } from './media-gallery-owner-gps-viewport'

export const XDRIVE_OWNER_GPS_COVER_LIMIT = 64

/** Only verified exact Owner GPS places may request a real thumbnail.
 * An aggregate map-region remains a zoom-only marker. */
export function xDriveOwnerGPSCoverCandidates(page: MediaPlacesMapOverview): MediaPlaceFacet[] {
  if (!Array.isArray(page?.items) || page.items.length > 64) return []
  return page.items.filter(item =>
    xDriveOwnerGPSCanOpenPlace(page, item) && item.item_count > 0,
  ).sort((a,b) => b.item_count - a.item_count || a.id.localeCompare(b.id))
    .slice(0, XDRIVE_OWNER_GPS_COVER_LIMIT)
}

/** A map-provided cover_node_id is only a hint; it is never an Owner image
 * credential. Read ONE fresh exact-place Owner range, then its authorized
 * Node+revision thumbnail through the already shared Gallery loader. */
export async function xDriveLoadOwnerGPSPhotoCover(
  place: MediaPlaceFacet,
  readRange: NonNullable<MediaGalleryDataSource['listItemRange']>,
  loadThumbnail: MediaThumbnailLoader,
  signal: AbortSignal,
): Promise<string | null> {
  const m = /^place:(0|-?[1-9]\d*):(0|-?[1-9]\d*)$/.exec(place?.id ?? '')
  if (!m || !Number.isSafeInteger(place.item_count) || place.item_count < 1 ||
      !Number.isSafeInteger(Number(m[1])) || Math.abs(Number(m[1])) > 9000 ||
      !Number.isSafeInteger(Number(m[2])) || Math.abs(Number(m[2])) > 18000 ||
      place.coordinate_kind === 'map_region_sample' || signal.aborted) return null
  const page = await readRange(1, 0, { place: place.id }, signal)
  if (signal.aborted || page?.offset !== 0 || page?.limit !== 1 ||
      !Number.isSafeInteger(page?.total_count) ||
      page.total_count < 1 || page.total_count > place.item_count ||
      page.items?.length !== 1) return null
  const item = page.items[0]
  const n = item?.node
  if (!n || !item.metadata?.has_thumbnail ||
      !Number.isSafeInteger(n.id) || n.id < 1 ||
      !Number.isSafeInteger(n.revision) || n.revision < 1) return null
  const url = await loadThumbnail(n.id, signal, n.revision)
  if (signal.aborted) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    return null
  }
  // DSM authenticated gallery thumbnails are Blob leases. Never accept a
  // remote web URL or let the map fetch one outside existing Owner ports.
  if (typeof url !== 'string' || !url.startsWith('blob:')) return null
  return url
}
