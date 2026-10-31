import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { xDriveEnterForegroundPage } from '../../ui/shared/src/mui/ViewerForegroundPriority'
import type {
  XDriveWebAppBrowseContext,
  XDriveWebAppRoute,
} from '../../ui/shared/src'
import {
  xDriveParseWebAppHash,
  xDriveWebAppHash,
  xDriveWebAppViewer,
} from '../../ui/shared/src'

const WEB_APP_SESSION_PREFIX = 'xdrive.web_app.session.v1:'
const PRIVATE_MAP_BROWSE_ID_PREFIX = 'map-'

/** The marker carries no Owner, coordinates or authority. After reload the
 * private context is lost and the Viewer must not borrow a public source. */
export function xDriveIsPrivateMapBrowseSessionID(id?: string): boolean {
  return typeof id === 'string' && id.startsWith(PRIVATE_MAP_BROWSE_ID_PREFIX)
}

/** Provider-derived map coordinates are temporary Owner context, not durable
 * browser state. A reload invalidates this privileged Viewer selection. */
const PRIVATE_MAP_SESSION_TTL_MS = 10 * 60 * 1000
const MAX_PRIVATE_MAP_SESSIONS = 16
const privateMapSessions = new Map<string, {
  context: XDriveWebAppBrowseContext; seen: number
}>()
// Ordinary Files/Gallery sessions remain usable in this tab when Safari denies
// sessionStorage. This is bounded volatile navigation state, NOT an offline cache.
const MAX_VOLATILE_BROWSE_SESSIONS = 32
const volatileBrowseSessions = new Map<string, string>()
function rememberVolatileBrowseSession(id: string, serialized: string) {
  volatileBrowseSessions.delete(id)
  volatileBrowseSessions.set(id, serialized)
  while (volatileBrowseSessions.size > MAX_VOLATILE_BROWSE_SESSIONS) {
    const oldest = volatileBrowseSessions.keys().next().value
    if (oldest === undefined) break
    volatileBrowseSessions.delete(oldest)
  }
}
function isPrivateMapContext(value: XDriveWebAppBrowseContext): boolean {
  return value?.kind === 'gallery' &&
    (value.target?.kind === 'baidu-cell' || value.target?.kind === 'baidu-viewport')
}
/** Immediately drop sensitive coordinates and volatile browse contexts on logout,
 * account switch or unmount. Durable ordinary sessionStorage remains governed
 * by its existing session lifetime and is always reauthorized by the Server. */
export function xDriveClearPrivateMapBrowseSessions(): void {
  privateMapSessions.clear()
  volatileBrowseSessions.clear()
}

function sweepPrivateMapSessions(now = Date.now()) {
  for (const [key, item] of privateMapSessions)
    if (item.seen > now || now - item.seen >= PRIVATE_MAP_SESSION_TTL_MS)
      privateMapSessions.delete(key)
}

type XDriveWebAppHistoryState = {
  xdriveWebApp?: true
  viewerReturn?: true
  appReturn?: string
  xdriveHistoryIndex?: number
}

type PendingBrowserNavigation = {
  next: XDriveWebAppRoute
  targetHash: string
  targetState: XDriveWebAppHistoryState | null
  originHash: string
  originState: XDriveWebAppHistoryState
  originIndex: number
  delta: number | null
  phase: 'restoring' | 'waiting' | 'accept-after-restore' | 'cancel-after-restore' | 'accepting'
}

/** Safari may deny this optional getter during a cold PWA mount.
 * Missing History metadata is not proof of a safe indexed traversal;
 * never manufacture an appReturn, viewerReturn or cross-Owner authority. */
function xDriveReadableWebHistoryState(): XDriveWebAppHistoryState | null {
  try {
    const value: unknown = window.history.state
    return value && typeof value === 'object' ? value as XDriveWebAppHistoryState : null
  } catch {
    return null
  }
}

function historyIndex(value: unknown): number | null {
  const index = (value as XDriveWebAppHistoryState | null)?.xdriveHistoryIndex
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? index : null
}

function indexedState(value: unknown, index: number): XDriveWebAppHistoryState {
  return {
    ...(value && typeof value === 'object' ? value : {}),
    xdriveWebApp: true,
    xdriveHistoryIndex: index,
  }
}

/** The mobile-only bare-root landing matches native Photos-first entry. */
function xDriveIsCompactWebViewport(): boolean {
  try {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width:899.95px)').matches
  } catch {
    // Restricted Safari media-query getters cannot break login or deep links.
    return false
  }
}

function currentRoute(): XDriveWebAppRoute {
  return xDriveParseWebAppHash(window.location.hash) ?? { app: 'overview', params: {} }
}

/** Only a mobile bare-root startup, never a deep link or history traversal,
 * may prefer Gallery over the canonical Web Home fallback. */
export function xDriveWebMobileColdLanding(
  hash: string,
  compactWeb: boolean,
): XDriveWebAppRoute | null {
  return hash === '' && compactWeb ? { app: 'gallery', params: {} } : null
}

function initialRootRoute(): XDriveWebAppRoute {
  return xDriveWebMobileColdLanding(window.location.hash, xDriveIsCompactWebViewport())
    ?? currentRoute()
}

function sessionKey(id: string) {
  return `${WEB_APP_SESSION_PREFIX}${id}`
}

export function xDriveCreateWebAppBrowseSession(context: XDriveWebAppBrowseContext) {
  const id = `${isPrivateMapContext(context) ? PRIVATE_MAP_BROWSE_ID_PREFIX : ''}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  xDriveWriteWebAppBrowseSession(id, context)
  return id
}

export function xDriveWriteWebAppBrowseSession(id: string, context: XDriveWebAppBrowseContext) {
  if (isPrivateMapContext(context)) {
    volatileBrowseSessions.delete(id)
    const now = Date.now()
    sweepPrivateMapSessions(now)
    privateMapSessions.delete(id)
    privateMapSessions.set(id, {
      context: JSON.parse(JSON.stringify(context)) as XDriveWebAppBrowseContext,
      seen: now,
    })
    while (privateMapSessions.size > MAX_PRIVATE_MAP_SESSIONS) {
      const first = privateMapSessions.keys().next().value
      if (first === undefined) break
      privateMapSessions.delete(first)
    }
    // Also scrub any coordinate context left by a previously installed client.
    try { window.sessionStorage.removeItem(sessionKey(id)) } catch {}
    return
  }
  privateMapSessions.delete(id)
  const serialized = JSON.stringify({ version: 1, context })
  if (!xDriveIsPrivateMapBrowseSessionID(id)) {
    rememberVolatileBrowseSession(id, serialized)
  }
  try {
    window.sessionStorage.setItem(sessionKey(id), serialized)
  } catch {
    // Safari can reject the getter or write. Same-tab Viewer navigation uses
    // the bounded copy above; a hard reload cannot restore denied storage.
  }
}

export function xDriveReadWebAppBrowseSession(id?: string) {
  if (!id) return null
  sweepPrivateMapSessions()
  const cached = privateMapSessions.get(id)
  if (cached) {
    privateMapSessions.delete(id)
    privateMapSessions.set(id, cached) // LRU, but not a TTL extension
    return cached.context
  }
  // Map-marked contexts exist only in memory. Never load a persisted
  // ordinary Gallery context under a stale private-map route after reload.
  if (xDriveIsPrivateMapBrowseSessionID(id)) {
    try { window.sessionStorage.removeItem(sessionKey(id)) } catch {}
    return null
  }
  const volatile = volatileBrowseSessions.get(id)
  if (volatile) {
    try {
      const value = JSON.parse(volatile) as { version?: number; context?: XDriveWebAppBrowseContext }
      if (value.version === 1 && value.context && !isPrivateMapContext(value.context)) {
        volatileBrowseSessions.delete(id)
        volatileBrowseSessions.set(id, volatile) // current-tab LRU
        return value.context
      }
    } catch {}
    volatileBrowseSessions.delete(id)
  }
  try {
    const raw = window.sessionStorage.getItem(sessionKey(id))
    if (!raw) return null
    const value = JSON.parse(raw) as { version?: number; context?: XDriveWebAppBrowseContext }
    if (value.version !== 1 || !value.context) return null
    if (isPrivateMapContext(value.context)) {
      // Old builds used to persist these temporary map selectors. Fail closed.
      try { window.sessionStorage.removeItem(sessionKey(id)) } catch {}
      return null
    }
    return value.context
  } catch {
    return null
  }
}

// Browser-generated Back/Forward and manually edited hashes bypass the normal
// App launcher. Intercept those transitions before an administrator form can be
// unmounted; do not mutate an already-committed route until the user confirms.
export function useXDriveWebAppRuntime(
  guardBrowserNavigation?: (from: XDriveWebAppRoute, to: XDriveWebAppRoute) => boolean,
) {
  const [route, setRoute] = useState<XDriveWebAppRoute>(() => initialRootRoute())
  const routeRef = useRef(route)
  // The real committed route is authoritative, including history/back,
  // deep links and deferred admin navigation. Never preempt for an unapproved
  // navigation or just because URL hash parsing was attempted.
  useLayoutEffect(() => {
    xDriveEnterForegroundPage('web:' + route.app)
  }, [route.app])
  const committedHashRef = useRef(window.location.hash)
  const committedStateRef = useRef<XDriveWebAppHistoryState | null>(xDriveReadableWebHistoryState())
  const committedIndexRef = useRef(historyIndex(xDriveReadableWebHistoryState()) ?? 0)
  const guardRef = useRef(guardBrowserNavigation)
  const blockedRef = useRef<PendingBrowserNavigation | null>(null)
  // Only a committed, resolved lazy workspace can use a synchronous route
  // update. Cold navigation keeps React's previous-view transition.
  const resolvedWorkspacesRef = useRef(new Set<'files' | 'gallery'>())
  const markLoadedWorkspaceApp = useCallback((app: 'files' | 'gallery') => {
    resolvedWorkspacesRef.current.add(app)
  }, [])
  guardRef.current = guardBrowserNavigation

  const commitBrowserRoute = useCallback((next: XDriveWebAppRoute) => {
    const state = xDriveReadableWebHistoryState()
    const nextIndex = historyIndex(state) ?? committedIndexRef.current + 1
    if (historyIndex(state) === null) {
      window.history.replaceState(indexedState(state, nextIndex), '', window.location.href)
    }
    committedIndexRef.current = nextIndex
    committedStateRef.current = xDriveReadableWebHistoryState()
    committedHashRef.current = window.location.hash
    xDriveEnterForegroundPage('web:' + next.app)
    routeRef.current = next
    if (resolvedWorkspacesRef.current.has(next.app as 'files' | 'gallery')) setRoute(next)
    else startTransition(() => setRoute(next))
  }, [])

  const commitProgrammaticRoute = useCallback((next: XDriveWebAppRoute) => {
    blockedRef.current = null
    committedStateRef.current = xDriveReadableWebHistoryState()
    committedHashRef.current = window.location.hash
    committedIndexRef.current = historyIndex(xDriveReadableWebHistoryState()) ?? committedIndexRef.current
    xDriveEnterForegroundPage('web:' + next.app)
    routeRef.current = next
    if (resolvedWorkspacesRef.current.has(next.app as 'files' | 'gallery')) setRoute(next)
    else startTransition(() => setRoute(next))
  }, [])

  useEffect(() => {
    if (!xDriveParseWebAppHash(window.location.hash)) {
      const landing = initialRootRoute()
      window.history.replaceState({ xdriveWebApp: true }, '', xDriveWebAppHash(landing))
      routeRef.current = landing
      setRoute(landing)
    }
    const initialIndex = historyIndex(xDriveReadableWebHistoryState()) ?? 0
    window.history.replaceState(indexedState(xDriveReadableWebHistoryState(), initialIndex), '', window.location.href)
    committedIndexRef.current = initialIndex
    committedStateRef.current = xDriveReadableWebHistoryState()
    committedHashRef.current = window.location.hash

    const sync = () => {
      const next = currentRoute()
      const hash = window.location.hash
      const state = xDriveReadableWebHistoryState() as XDriveWebAppHistoryState | null
      const index = historyIndex(state)
      const pending = blockedRef.current
      if (pending) {
        const isOrigin = hash === pending.originHash && index === pending.originIndex
        if (pending.phase === 'restoring' || pending.phase === 'accept-after-restore' ||
            pending.phase === 'cancel-after-restore') {
          if (isOrigin) {
            if (pending.phase === 'cancel-after-restore') blockedRef.current = null
            else if (pending.phase === 'accept-after-restore') {
              pending.phase = 'accepting'
              window.history.go(pending.delta!)
            } else pending.phase = 'waiting'
          }
          return
        }
        if (pending.phase === 'accepting') {
          if (hash === pending.targetHash && index === pending.originIndex + pending.delta!) {
            blockedRef.current = null
            commitBrowserRoute(next)
          }
          return
        }
        // A duplicate hashchange or a second browser shortcut while the
        // confirmation is visible must not bypass the first pending decision.
        if (!isOrigin) {
          if (index !== null && index !== pending.originIndex) {
            pending.phase = 'restoring'
            window.history.go(pending.originIndex - index)
          } else window.history.replaceState(pending.originState, '', pending.originHash)
        }
        return
      }

      if (xDriveWebAppHash(routeRef.current) !== xDriveWebAppHash(next) &&
          guardRef.current?.(routeRef.current, next)) {
        const targetIndex = index
        const originIndex = committedIndexRef.current
        // Indexed entries can be traversed back to the exact original history
        // position and subsequently replayed without creating fake entries.
        // Legacy/unindexed hash entries fail closed by restoring the URL in
        // place; their earlier history position cannot be proven.
        const delta = targetIndex !== null && targetIndex !== originIndex &&
          Math.abs(targetIndex - originIndex) <= 128 ? targetIndex - originIndex : null
        const pendingNavigation: PendingBrowserNavigation = {
          next,
          targetHash: hash,
          targetState: state,
          originHash: committedHashRef.current,
          originState: committedStateRef.current ?? indexedState(null, originIndex),
          originIndex,
          delta,
          phase: delta === null ? 'waiting' : 'restoring',
        }
        blockedRef.current = pendingNavigation
        if (delta === null) {
          window.history.replaceState(pendingNavigation.originState, '', pendingNavigation.originHash)
        } else {
          window.history.go(-delta)
        }
        return
      }
      commitBrowserRoute(next)
    }
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [commitBrowserRoute])

  const cancelHistoryNavigation = useCallback(() => {
    const pending = blockedRef.current
    if (!pending) return
    if (pending.phase === 'restoring') pending.phase = 'cancel-after-restore'
    else blockedRef.current = null
  }, [])

  const confirmHistoryNavigation = useCallback(() => {
    const pending = blockedRef.current
    if (!pending) return
    if (pending.phase === 'restoring') {
      pending.phase = 'accept-after-restore'
      return
    }
    if (pending.delta !== null) {
      pending.phase = 'accepting'
      window.history.go(pending.delta)
    } else {
      window.history.replaceState(
        indexedState(pending.targetState, pending.originIndex), '', pending.targetHash,
      )
      blockedRef.current = null
      commitBrowserRoute(pending.next)
    }
  }, [commitBrowserRoute])

  const launch = useCallback((
    next: XDriveWebAppRoute,
    options: { replace?: boolean; newTab?: boolean; viewerReturn?: boolean } = {},
  ) => {
    const hash = xDriveWebAppHash(next)
    if (options.newTab) {
      window.open(hash, '_blank')
      return
    }
    const currentState = xDriveReadableWebHistoryState() as XDriveWebAppHistoryState | null
    const from = routeRef.current
    const appReturn = options.replace
      ? currentState?.appReturn
      : (!xDriveWebAppViewer(next.app) && from.app !== next.app)
        ? xDriveWebAppHash(from)
        : currentState?.appReturn
    const state: XDriveWebAppHistoryState = {
      xdriveWebApp: true,
      xdriveHistoryIndex: committedIndexRef.current + (options.replace ? 0 : 1),
      ...(appReturn ? { appReturn } : {}),
      ...((options.viewerReturn || (options.replace && currentState?.viewerReturn))
        ? { viewerReturn: true }
        : {}),
    }
    if (options.replace) window.history.replaceState(state, '', hash)
    else window.history.pushState(state, '', hash)
    commitProgrammaticRoute(next)
  }, [commitProgrammaticRoute])

  const closeViewer = useCallback((fallback: XDriveWebAppRoute) => {
    const state = xDriveReadableWebHistoryState() as XDriveWebAppHistoryState | null
    if (state?.viewerReturn) {
      window.history.back()
      return
    }
    const hash = xDriveWebAppHash(fallback)
    window.history.replaceState(indexedState({ xdriveWebApp: true }, committedIndexRef.current), '', hash)
    commitProgrammaticRoute(fallback)
  }, [commitProgrammaticRoute])

  const parentHash = (xDriveReadableWebHistoryState() as XDriveWebAppHistoryState | null)?.appReturn
  const parentRoute = parentHash ? xDriveParseWebAppHash(parentHash) : null
  const canExitApp = Boolean(parentRoute && parentRoute.app !== route.app) || route.app !== 'overview'

  const exitApp = useCallback(() => {
    const active = routeRef.current
    const state = xDriveReadableWebHistoryState() as XDriveWebAppHistoryState | null
    const parent = state?.appReturn ? xDriveParseWebAppHash(state.appReturn) : null
    if (parent && parent.app !== active.app) {
      window.history.back()
      return
    }
    if (active.app === 'overview') return
    const fallback: XDriveWebAppRoute = { app: 'overview', params: {} }
    window.history.replaceState(indexedState({ xdriveWebApp: true }, committedIndexRef.current), '', xDriveWebAppHash(fallback))
    commitProgrammaticRoute(fallback)
  }, [commitProgrammaticRoute])

  return {
    route, launch, closeViewer, exitApp, canExitApp,
    cancelHistoryNavigation, confirmHistoryNavigation, markLoadedWorkspaceApp,
  }
}
