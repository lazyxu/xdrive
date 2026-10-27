/**
 * Browser-only projection lifecycle helpers for authenticated DSM Owner Files.
 * Scope is deliberately tied to the displayed breadcrumb chain and Server
 * sort order: results from a prior folder/sort must never flash in the new one.
 * Neither helper issues requests or accepts an identity/Root override.
 */
export function xDriveSynologyOwnerFilesScopeKey(
  crumbs: readonly { id: string | number }[],
  sortKey: string,
  sortDirection: string,
): string {
  return crumbs.map(crumb => String(crumb.id)).join('/') + ':' + sortKey + ':' + sortDirection
}

/** Only user scrolling near the end of a real overflowed FileExplorer loads more.
 * A short first page uses the explicit "加载更多" fallback; no eager drain of
 * a 100k-item cloud directory on mount or resize.
 */
export function xDriveSynologyOwnerFilesNearEnd(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite) ||
    scrollTop < 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
    return false
  }
  return scrollHeight - scrollTop - clientHeight <= Math.max(240, clientHeight * 0.75)
}
