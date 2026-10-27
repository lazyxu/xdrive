/**
 * Renderer-local Viewer foreground priority. Only disposable background
 * thumbnails, posters, covers and prefetchers may subscribe. NEVER cancel
 * durable uploads, downloads, sync, backups, mutations or another window.
 * No Owner IDs, file paths, tokens or media URLs are stored.
 */
export type XDriveViewerForegroundObserver = (active: boolean) => void
const owners = new Map<object, number>()
const observers = new Set<XDriveViewerForegroundObserver>()

export function xDriveViewerForegroundActive(): boolean {
  return owners.size > 0
}

function publishViewerForeground(active: boolean) {
  for (const notify of [...observers]) {
    try { notify(active) } catch { /* optional background work cannot break Viewer */ }
  }
}

/** Nested and concurrent Viewer sessions remain active until the last release. */
export function xDriveAcquireViewerForeground(owner: object): () => void {
  const alreadyActive = xDriveViewerForegroundActive()
  owners.set(owner, (owners.get(owner) ?? 0) + 1)
  if (!alreadyActive) publishViewerForeground(true)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = owners.get(owner)
    if (!count) return
    if (count === 1) owners.delete(owner)
    else owners.set(owner, count - 1)
    if (!xDriveViewerForegroundActive()) publishViewerForeground(false)
  }
}

/** Subscribe once per background provider/scheduler, never once per media tile. */
export function xDriveObserveViewerForeground(
  notify: XDriveViewerForegroundObserver,
): () => void {
  observers.add(notify)
  notify(xDriveViewerForegroundActive())
  return () => { observers.delete(notify) }
}
