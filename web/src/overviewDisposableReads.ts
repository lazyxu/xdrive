/**
 * A mounted Web Overview owns only its replaceable Recent/Favorites GETs.
 * A newer refresh or route/Owner cleanup aborts the old transport; never
 * share this signal with upload/download/backup/sync or other windows.
 */
export function xDriveCreateOverviewDisposableReadScope() {
  let current: AbortController | null = null
  return {
    begin(): { signal: AbortSignal; isCurrent: () => boolean } {
      current?.abort()
      const controller = new AbortController()
      current = controller
      return {
        signal: controller.signal,
        isCurrent: () => current === controller && !controller.signal.aborted,
      }
    },
    cancel(): void {
      current?.abort()
      current = null
    },
  }
}
