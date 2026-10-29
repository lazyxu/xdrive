import { xDriveGalleryMapEntryScope } from '../../ui/shared/src/media-gallery-baidu-map-entry'
import type { XDriveBaiduMapPhotoScope } from '../../ui/shared/src/media-gallery-baidu-map-photo-scope'
import type { XDriveWebAppBrowseContext } from '../../ui/shared/src/web-app'

/**
 * A routed Viewer can only enter the same trusted Owner map if its original
 * authorized Gallery context is still available and every collection filter
 * can be expressed by the signed Baidu /cells API. No direct/unrestricted
 * fallback when a private context expired, nor from Files, Search, Trash,
 * People, Pets, Memories, Duplicate Review or an unknown collection.
 *
 * In particular a signed Cell/Viewport is geographically narrower than an
 * Album or Library filter. Turning one into its source Album discards the
 * original map Cell/viewport membership and can expose extra Owner photos.
 * Those Viewer contexts must use their existing authenticated map-return
 * path, not this standalone full-document handoff.
 *
 * This only validates the source membership HINT. A later one-use Server
 * map handoff and the target's fresh /cells reauthorization are mandatory.
 */
export function xDriveRoutedViewerMapEntry(
  context: XDriveWebAppBrowseContext | null | undefined,
): XDriveBaiduMapPhotoScope | null {
  if (!context || context.kind !== 'gallery' ||
      !Number.isSafeInteger(context.activeIndex) || context.activeIndex < 0 ||
      !Number.isSafeInteger(context.totalCount) ||
      context.totalCount < 1 || context.activeIndex >= context.totalCount)
    return null
  const target = context.target
  if (!target || typeof target !== 'object' ||
      !target.query || typeof target.query !== 'object' ||
      Array.isArray(target.query)) return null
  // A signed map Cell/viewport is not expressible in XDriveBaiduMapPhotoScope
  // (Album/filter only); dropping its BD09 geometry would widen the original
  // authorized Viewer range. Leave those to the original map return flow.
  if (target.kind !== 'all' && target.kind !== 'album') return null
  if ((target.kind === 'all' && target.id) ||
      (target.kind === 'album' && !target.id))
    return null
  const albumKey = target.id ?? ''
  const by = target.query.sort_by ?? 'captured'
  const dir = target.query.sort_dir ?? 'desc'
  if ((by !== 'captured' && by !== 'added') ||
      (dir !== 'asc' && dir !== 'desc')) return null
  const timeZone = target.query.time_zone ?? 'UTC'
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 128)
    return null
  const entry = xDriveGalleryMapEntryScope({
    section: albumKey ? 'albums' : 'library',
    album: albumKey ? {
      id: albumKey, kind: albumKey.startsWith('smart:') ? 'smart' : 'manual',
    } : null,
    query: target.query,
    sort: { by, dir },
    timeZone,
  })
  return entry.ok ? entry.scope : null
}
