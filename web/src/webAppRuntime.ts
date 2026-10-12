import { useCallback, useEffect, useRef, useState } from 'react'
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

function currentRoute(): XDriveWebAppRoute {
  return xDriveParseWebAppHash(window.location.hash) ?? { app: 'overview', params: {} }
}

function sessionKey(id: string) {
  return `${WEB_APP_SESSION_PREFIX}${id}`
}

export function xDriveCreateWebAppBrowseSession(context: XDriveWebAppBrowseContext) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  xDriveWriteWebAppBrowseSession(id, context)
  return id
}

export function xDriveWriteWebAppBrowseSession(id: string, context: XDriveWebAppBrowseContext) {
  window.sessionStorage.setItem(
    sessionKey(id),
    JSON.stringify({ version: 1, context }),
  )
}

export function xDriveReadWebAppBrowseSession(id?: string) {
  if (!id) return null
  try {
    const raw = window.sessionStorage.getItem(sessionKey(id))
    if (!raw) return null
    const value = JSON.parse(raw) as { version?: number; context?: XDriveWebAppBrowseContext }
    return value.version === 1 && value.context ? value.context : null
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
  const [route, setRoute] = useState<XDriveWebAppRoute>(() => currentRoute())
  const routeRef = useRef(route)
  const committedHashRef = useRef(window.location.hash)
  const committedStateRef = useRef<XDriveWebAppHistoryState | null>(window.history.state)
  const committedIndexRef = useRef(historyIndex(window.history.state) ?? 0)
  const guardRef = useRef(guardBrowserNavigation)
  const blockedRef = useRef<PendingBrowserNavigation | null>(null)
  guardRef.current = guardBrowserNavigation

  const commitBrowserRoute = useCallback((next: XDriveWebAppRoute) => {
    const state = window.history.state
    const nextIndex = historyIndex(state) ?? committedIndexRef.current + 1
    if (historyIndex(state) === null) {
      window.history.replaceState(indexedState(state, nextIndex), '', window.location.href)
    }
    committedIndexRef.current = nextIndex
    committedStateRef.current = window.history.state
    committedHashRef.current = window.location.hash
    routeRef.current = next
    setRoute(next)
  }, [])

  const commitProgrammaticRoute = useCallback((next: XDriveWebAppRoute) => {
    blockedRef.current = null
    committedStateRef.current = window.history.state
    committedHashRef.current = window.location.hash
    committedIndexRef.current = historyIndex(window.history.state) ?? committedIndexRef.current
    routeRef.current = next
    setRoute(next)
  }, [])

  useEffect(() => {
    if (!xDriveParseWebAppHash(window.location.hash)) {
      window.history.replaceState({ xdriveWebApp: true }, '', xDriveWebAppHash({ app: 'overview', params: {} }))
      routeRef.current = currentRoute()
      setRoute(routeRef.current)
    }
    const initialIndex = historyIndex(window.history.state) ?? 0
    window.history.replaceState(indexedState(window.history.state, initialIndex), '', window.location.href)
    committedIndexRef.current = initialIndex
    committedStateRef.current = window.history.state
    committedHashRef.current = window.location.hash

    const sync = () => {
      const next = currentRoute()
      const hash = window.location.hash
      const state = window.history.state as XDriveWebAppHistoryState | null
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
    const currentState = window.history.state as XDriveWebAppHistoryState | null
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
    const state = window.history.state as XDriveWebAppHistoryState | null
    if (state?.viewerReturn) {
      window.history.back()
      return
    }
    const hash = xDriveWebAppHash(fallback)
    window.history.replaceState(indexedState({ xdriveWebApp: true }, committedIndexRef.current), '', hash)
    commitProgrammaticRoute(fallback)
  }, [commitProgrammaticRoute])

  const parentHash = (window.history.state as XDriveWebAppHistoryState | null)?.appReturn
  const parentRoute = parentHash ? xDriveParseWebAppHash(parentHash) : null
  const canExitApp = Boolean(parentRoute && parentRoute.app !== route.app) || route.app !== 'overview'

  const exitApp = useCallback(() => {
    const active = routeRef.current
    const state = window.history.state as XDriveWebAppHistoryState | null
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
    cancelHistoryNavigation, confirmHistoryNavigation,
  }
}
