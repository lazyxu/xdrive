import type { MediaBaiduNativeCellSelection, MediaItem, MediaItemRange } from './models'
import { xDriveValidBaiduNativeCellRangePage } from './media-gallery-baidu-jsapi4-cell-range'
import {
  XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT, xDrivePlacesCellAcceptsLogicalRangeCount,
} from './media-gallery-places-photo-drawer'

/**
 * Append one explicit Owner-authorized /cell-items page to the *same* signed Cell.
 * The caller must separately fence the in-flight request against Owner, filter,
 * camera, map lifetime and abort. No provider/Child data confers authority here.
 *
 * Require an exact, gap-free bounded page with unchanged logical total and no
 * repeated Nodes (including across prior pages). On invalidation, keep the
 * previously verified thumbnails but never display the rejected page.
 */
export function xDriveAppendPlacesDrawerPage(
  selection: MediaBaiduNativeCellSelection,
  existing: readonly MediaItem[],
  knownTotal: number,
  page: MediaItemRange,
): MediaItem[] | null {
  const limit = XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT
  if (!Array.isArray(existing) || existing.length < 1 ||
      !xDrivePlacesCellAcceptsLogicalRangeCount(selection, knownTotal) ||
      existing.length >= knownTotal ||
      page?.total_count !== knownTotal ||
      !xDriveValidBaiduNativeCellRangePage(page, limit, existing.length) ||
      page.items.length !== Math.min(limit, knownTotal - existing.length)) return null

  const seen = new Set<number>()
  const validNode = (item: MediaItem): boolean => {
    const id = item?.node?.id
    const revision = item?.node?.revision
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) ||
        revision <= 0 || seen.has(id)) return false
    seen.add(id)
    return true
  }
  if (!existing.every(validNode) || !page.items.every(validNode)) return null
  return [...existing, ...page.items]
}
