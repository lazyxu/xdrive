import type { MediaGalleryQuery } from './models'

/**
 * Stable authorization/selection identity of one Gallery collection.
 *
 * Server Range requestID and presentation sort fields are deliberately not
 * part of the selected Node set: swapping Mobile/Wide 899/900px reorders and
 * re-pages the same logical collection without erasing a pending selection.
 * Actual scope changes (account, album, filters, fold/time-zone constraints)
 * still invalidate selected items before any file mutation is issued.
 */
export function xDriveMediaGallerySelectionScopeKey(
  target: { kind: string; id?: string; query: MediaGalleryQuery; requestID?: number } | null,
  accountScope: string,
): string {
  if (!target) return JSON.stringify(['media-gallery:selection:idle', accountScope])
  const logicalQuery = Object.entries(target.query)
    .filter(([key, value]) =>
      value !== undefined &&
      key !== 'sort_by' &&
      key !== 'sort_dir' &&
      key !== 'unknown_first' &&
      key !== 'anchor_node_id' &&
      key !== 'initial_position')
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(['media-gallery:selection', accountScope, target.kind, target.id ?? '', logicalQuery])
}
