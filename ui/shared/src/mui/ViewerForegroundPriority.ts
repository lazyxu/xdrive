/**
 * Renderer-local foreground priority across ALL committed page transitions,
 * plus higher-priority Viewer overlays. Only disposable background thumbnails,
 * posters, covers and prefetchers may subscribe. NEVER cancel
 * durable uploads, downloads, sync, backups, mutations or another window.
 * No Owner IDs, file paths, tokens or media URLs are stored.
 */
export type XDriveViewerForegroundObserver = (active: boolean) => void
const owners = new Map<object, number>()
// Each observer captures the page it belongs to at mount time. A new page
// has its own newly mounted readers and must NEVER be paused together with
// the obsolete page it replaces.
type DisposableObserver = { notify: XDriveViewerForegroundObserver; page: string | null }
const observers = new Set<DisposableObserver>()
let foregroundPage: string | null = null
// A content switch within one route (e.g. Files folder A -> B or Album A ->
// B) also yields disposable reads. The old mounted page must be allowed to
// resume if the new first-page Range fails. Tokens are renderer-local; never
// persist paths, Owner IDs, coordinates, or credentials.
let pageGeneration = 0
// One latest-wins content admission per page, not an accumulating counter.
// A superseded loader might never settle despite AbortSignal: its stale
// finally MUST NOT keep the latest accepted folder or album paused.
const contentTransitions = new Map<string, { token: object; generation: number }>()

function contentTransitionPending(page: string | null): boolean {
  return Boolean(page &&
    contentTransitions.get(page)?.generation === pageGeneration)
}

export function xDriveCurrentForegroundPage(): string | null {
  return foregroundPage
}

/** An accepted page transition: old transient reads yield before new paint.
 * This never sends a signal to Server, Agent, durable jobs or another tab.
 */
export function xDriveEnterForegroundPage(page: string | null): void {
  const next = typeof page === 'string' && page.trim() ? page.trim() : null
  if (foregroundPage === next) return
  const firstPage = foregroundPage === null && next !== null
  foregroundPage = next
  pageGeneration += 1
  // A finished/rejected old content transaction cannot resume or suspend a
  // later route even when Back eventually returns to the same page name.
  contentTransitions.clear()
  for (const entry of [...observers]) {
    // Initial React layout effects may subscribe child providers before the
    // root announces its first route. Attach them to that first real page.
    if (firstPage && entry.page === null) entry.page = next
    notifyDisposablePause(entry)
  }
}

function notifyDisposablePause(entry: DisposableObserver) {
  const obsoletePage = entry.page !== null && entry.page !== foregroundPage
  try {
    entry.notify(xDriveViewerForegroundActive() || obsoletePage ||
      (entry.page === foregroundPage && contentTransitionPending(entry.page)))
  }
  catch { /* readers cannot block new page route commits */ }
}

/**
 * A new *content* scope within an existing page may be pending even though
 * the route ID has not changed. Yield only disposable reads of that page
 * until its new first authoritative Range commits or fails.
 *
 * Call only after the navigation is admitted (not from a dirty-form guard),
 * and ALWAYS release in finally. Rapid content navigations use latest-wins
 * ownership, so even a hung old transport cannot keep the successor paused.
 * Allowed page kinds are explicit so an offscreen Files poll cannot pause
 * the user's visible Gallery/Viewer.
 */
export function xDriveBeginForegroundContentTransition(
  pageKinds: string | readonly string[],
): () => void {
  const page = foregroundPage
  const kinds = typeof pageKinds === 'string' ? [pageKinds] : pageKinds
  if (!page || !kinds.some(kind => kind && page.endsWith(':' + kind))) {
    return () => undefined
  }
  const token = {}
  const generation = pageGeneration
  contentTransitions.set(page, { token, generation })
  publishViewerForeground(true)
  let released = false
  return () => {
    if (released) return
    released = true
    const owned = contentTransitions.get(page)
    if (!owned || owned.token !== token) return
    contentTransitions.delete(page)
    if (page === foregroundPage && generation === pageGeneration) {
      publishViewerForeground(false)
    }
  }
}

export function xDriveViewerForegroundActive(): boolean {
  return owners.size > 0
}

function publishViewerForeground(_active: boolean) {
  for (const entry of [...observers]) notifyDisposablePause(entry)
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
  const entry: DisposableObserver = { notify, page: foregroundPage }
  observers.add(entry)
  notifyDisposablePause(entry)
  return () => { observers.delete(entry) }
}
