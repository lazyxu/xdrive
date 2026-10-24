import type { MediaAlbum, MediaGalleryQuery } from './models'
import {
  xDriveNormalizeBaiduMapPhotoScope,
} from './media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from './media-gallery-baidu-map-photo-scope'

export type XDriveGalleryMapEntry = Readonly<{
  section: string
  album: Pick<MediaAlbum, 'id' | 'kind'> | null
  query: MediaGalleryQuery
  sort: Readonly<{ by: 'captured' | 'added'; dir: 'asc' | 'desc' }>
  timeZone: string
  activeMediaType?: string
  hasUnsupportedContext?: boolean
}>

export type XDriveGalleryMapEntryResult =
  | Readonly<{ ok: true; scope: XDriveBaiduMapPhotoScope; requiresIsolated: boolean }>
  | Readonly<{ ok: false; reason: 'unsupported-collection' | 'unsupported-filter' }>

const supported = new Set([
  'sort_by', 'sort_dir', 'favorite', 'asset_kind', 'captured_from',
  'captured_to', 'time_zone',
])

/**
 * A Gallery source is allowed to open a signed current-camera map ONLY when
 * the map can express its entire Owner membership. Never drop an unsupported
 * query and replace a scoped wall with the owner's whole library.
 *
 * Account identity, original WGS84, media IDs and URLs are not serialized.
 * The Server independently enforces Owner, Album, Consent and revision.
 */
export function xDriveGalleryMapEntryScope(input: XDriveGalleryMapEntry): XDriveGalleryMapEntryResult {
  const deny = (reason: 'unsupported-collection' | 'unsupported-filter') =>
    ({ ok: false as const, reason })
  if (!input || typeof input !== 'object' || input.hasUnsupportedContext ||
    !input.query || typeof input.query !== 'object' || Array.isArray(input.query))
    return deny('unsupported-collection')

  if (!input.sort || (input.sort.by !== 'captured' && input.sort.by !== 'added') ||
      (input.sort.dir !== 'asc' && input.sort.dir !== 'desc'))
    return deny('unsupported-filter')
  const section = input.section
  if (section !== 'library' && section !== 'favorites' &&
      section !== 'albums' && section !== 'media-types')
    return deny('unsupported-collection')

  const albumKey = input.album?.id ?? ''
  if (section === 'albums' && !albumKey) return deny('unsupported-collection')
  if (section !== 'albums' && albumKey) return deny('unsupported-collection')
  if (section === 'media-types' &&
      input.activeMediaType !== 'image' && input.activeMediaType !== 'video')
    return deny('unsupported-collection')

  const effective: MediaGalleryQuery = {}
  for (const [key, value] of Object.entries(input.query)) {
    if (value === undefined) continue
    if (supported.has(key)) {
      Object.assign(effective, { [key]: value })
      continue
    }
    // These are navigation/presentation only, never a broader membership.
    if ((key === 'fold_duplicates' && value === false) ||
        (key === 'has_location' && value === true) ||
        (key === 'search' && typeof value === 'string' && value.trim() === '') ||
        (key === 'anchor_node_id' && Number.isSafeInteger(value) &&
          (value as number) > 0) ||
        (key === 'initial_position' && value === 'latest') ||
        (key === 'unknown_first' && value === false)) continue
    return deny('unsupported-filter')
  }
  if (section === 'favorites') {
    if (effective.favorite === false) return deny('unsupported-filter')
    effective.favorite = true
  }
  if (section === 'media-types') {
    if (effective.asset_kind !== undefined &&
        effective.asset_kind !== input.activeMediaType)
      return deny('unsupported-filter')
    effective.asset_kind = input.activeMediaType as 'image' | 'video'
  }
  // Sort is the already accepted Gallery UI choice, never an uncommitted
  // draft query; dates use the Gallery's timezone when no explicit value exists.
  effective.sort_by = input.sort?.by
  effective.sort_dir = input.sort?.dir
  if (!effective.time_zone && (effective.captured_from || effective.captured_to))
    effective.time_zone = input.timeZone

  const scope = xDriveNormalizeBaiduMapPhotoScope({ filters: effective, albumKey })
  if (!scope) return deny('unsupported-filter')

  // Both SDK hosts now use exactly the same trusted BD09 Cells and Camera
  // Range, so a valid restricted collection may open either map mode. A
  // document-mode SWITCH still requires a separate one-use Owner handoff.
  // Preserve this result field for callers that have not migrated yet.
  const requiresIsolated = false
  return { ok: true, scope, requiresIsolated }
}
