/** File thumbnail UI only: all 100k scheduling, paging and cancellation stay
 * inside the existing FileExplorerThumbnail provider/scheduler.
 */
export type XDriveFileExplorerThumbnailVisualState =
  | 'ready' | 'type-icon' | 'waiting-viewport' | 'loading' | 'failed'
export function xDriveFileExplorerThumbnailVisualState({
  eligible, visible, failed, hasSource, canLoad,
}: {
  eligible: boolean
  visible: boolean
  failed: boolean
  hasSource: boolean
  canLoad: boolean
}): XDriveFileExplorerThumbnailVisualState {
  if (hasSource) return 'ready'
  if (!eligible || !canLoad) return 'type-icon'
  if (failed) return 'failed'
  return visible ? 'loading' : 'waiting-viewport'
}
