import { useCallback, useEffect, useState } from 'react'
import type {
  XDriveWebAppBrowseContext,
  XDriveWebAppRoute,
} from '../../ui/shared/src'
import {
  xDriveParseWebAppHash,
  xDriveWebAppHash,
} from '../../ui/shared/src'

const WEB_APP_SESSION_PREFIX = 'xdrive.web_app.session.v1:'

type XDriveWebAppHistoryState = {
  xdriveWebApp?: true
  viewerReturn?: true
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

export function useXDriveWebAppRuntime() {
  const [route, setRoute] = useState<XDriveWebAppRoute>(() => currentRoute())

  useEffect(() => {
    if (!xDriveParseWebAppHash(window.location.hash)) {
      const next = xDriveWebAppHash({ app: 'overview', params: {} })
      window.history.replaceState({ xdriveWebApp: true }, '', next)
      setRoute({ app: 'overview', params: {} })
    }
    const sync = () => setRoute(currentRoute())
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

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
    const state: XDriveWebAppHistoryState = {
      xdriveWebApp: true,
      ...((options.viewerReturn || (options.replace && currentState?.viewerReturn))
        ? { viewerReturn: true }
        : {}),
    }
    if (options.replace) window.history.replaceState(state, '', hash)
    else window.history.pushState(state, '', hash)
    setRoute(next)
  }, [])

  const closeViewer = useCallback((fallback: XDriveWebAppRoute) => {
    const state = window.history.state as XDriveWebAppHistoryState | null
    if (state?.viewerReturn) {
      window.history.back()
      return
    }
    const hash = xDriveWebAppHash(fallback)
    window.history.replaceState({ xdriveWebApp: true }, '', hash)
    setRoute(fallback)
  }, [])

  return { route, launch, closeViewer }
}
