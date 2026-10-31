import type { XDriveWebAppRoute } from '../../ui/shared/src'

export const XDRIVE_MOBILE_SLOTS = ['all', 'dynamic', 'gallery', 'files', 'mine'] as const
export type XDriveMobileSlot = typeof XDRIVE_MOBILE_SLOTS[number]

export type XDriveMobileNavigationMemory = {
  ownerScope: string
  files: XDriveWebAppRoute
  gallery: XDriveWebAppRoute
  dynamic: XDriveWebAppRoute[]
  favorites: string[]
  launcherSearch: string
}

const viewers = new Set<string>([
  'preview', 'media-viewer', 'text-viewer', 'pdf-viewer', 'audio-player',
])
const adminOnly = new Set<string>([
  'admin-users', 'admin-audit', 'admin-storage',
  'admin-services', 'admin-maintenance',
])

/** Web hashes stay authoritative; fixed tabs are presentation, not another auth router. */
export function xDriveMobileSlotForRoute(route: XDriveWebAppRoute): XDriveMobileSlot | null {
  if (viewers.has(route.app)) return null
  if (route.app === 'overview') return route.params.section === 'mine' ? 'mine' : 'all'
  if (route.app === 'gallery') return 'gallery'
  if (route.app === 'files') return 'files'
  return 'dynamic'
}

export function xDriveMobileRouteAllowed(route: XDriveWebAppRoute, adminVerified: boolean): boolean {
  if (adminOnly.has(route.app) && !adminVerified) return false
  if (route.app === 'tasks' && route.params.scope === 'global' && !adminVerified) return false
  return route.app !== 'sync-folders' && !viewers.has(route.app)
}

export function xDriveInitialMobileNavigation(ownerScope = ''): XDriveMobileNavigationMemory {
  return {
    ownerScope,
    files: { app: 'files', params: {} },
    gallery: { app: 'gallery', params: {} },
    dynamic: [],
    favorites: ['gallery', 'files'],
    launcherSearch: '',
  }
}

/** Only the current verified Server Owner may keep route hints in this tab. */
export function xDriveRememberMobileNavigation(
  previous: XDriveMobileNavigationMemory,
  route: XDriveWebAppRoute,
  ownerScope: string,
  adminVerified: boolean,
): XDriveMobileNavigationMemory {
  const base = previous.ownerScope === ownerScope
    ? previous : xDriveInitialMobileNavigation(ownerScope)
  if (!ownerScope) return base
  const dynamic = base.dynamic.filter(item => xDriveMobileRouteAllowed(item, adminVerified))
  const favorites = base.favorites.filter(key => adminVerified || !adminOnly.has(key))
  if (!xDriveMobileRouteAllowed(route, adminVerified)) return { ...base, dynamic, favorites }
  switch (xDriveMobileSlotForRoute(route)) {
    case 'files': return { ...base, files: route, dynamic, favorites }
    case 'gallery': return { ...base, gallery: route, dynamic, favorites }
    case 'dynamic':
      return {
        ...base,
        dynamic: [route, ...dynamic.filter(item => item.app !== route.app)].slice(0, 6),
        favorites,
      }
    default: return { ...base, dynamic, favorites }
  }
}

/** Launcher favorites are volatile, bounded, and verified-Owner scoped. */
export function xDriveToggleMobileFavorite(
  previous: XDriveMobileNavigationMemory,
  ownerScope: string,
  key: string,
  adminVerified: boolean,
): XDriveMobileNavigationMemory {
  const base = previous.ownerScope === ownerScope
    ? previous : xDriveInitialMobileNavigation(ownerScope)
  if (!ownerScope || !key || key === 'overview' || key === 'sync-folders' ||
    viewers.has(key) || (adminOnly.has(key) && !adminVerified)) return base
  const favorites = base.favorites.filter(item => adminVerified || !adminOnly.has(item))
  return {
    ...base,
    favorites: favorites.includes(key)
      ? favorites.filter(item => item !== key)
      : [...favorites, key].slice(-16),
  }
}

/** Preserve the Launcher query when its L1 tab unmounts; never persist it or
 * accept a delayed input event from an earlier verified Owner. */
export function xDriveSetMobileLauncherSearch(
  previous: XDriveMobileNavigationMemory,
  ownerScope: string,
  value: string,
): XDriveMobileNavigationMemory {
  if (!ownerScope || (previous.ownerScope && previous.ownerScope !== ownerScope)) return previous
  const base = previous.ownerScope === ownerScope
    ? previous : xDriveInitialMobileNavigation(ownerScope)
  const launcherSearch = value.slice(0, 120)
  return base.launcherSearch === launcherSearch ? base : { ...base, launcherSearch }
}

export function xDriveMobileRouteForSlot(
  memory: XDriveMobileNavigationMemory,
  slot: XDriveMobileSlot,
  adminVerified: boolean,
): XDriveWebAppRoute | null {
  switch (slot) {
    case 'all': return { app: 'overview', params: {} }
    case 'mine': return { app: 'overview', params: { section: 'mine' } }
    case 'files': return memory.files
    case 'gallery': return memory.gallery
    case 'dynamic':
      return memory.dynamic.find(item => xDriveMobileRouteAllowed(item, adminVerified)) ?? null
  }
}

/** L2 map focus belongs to the actual Gallery map panel, NOT every Places
 * route: Places list is L1 and must keep the global five-slot navigation. */
export function xDriveMobileMapFocused(route: XDriveWebAppRoute, mapPanelVisible: boolean): boolean {
  return route.app === 'gallery' && route.params.section === 'places' && mapPanelVisible
}

/** The in-app arrow never jumps to a different bottom destination. */
export function xDriveMobileFeatureParentRoute(route: XDriveWebAppRoute): XDriveWebAppRoute | null {
  switch (route.app) {
    case 'gallery':
      return route.params.section && route.params.section !== 'library'
        ? { app: 'gallery', params: { section: 'library' } } : null
    case 'files':
      return route.params.select
        ? { app: 'files', params: { dir: route.params.dir } } : null
    case 'tasks':
      return route.params.task
        ? { app: 'tasks', params: { scope: route.params.scope } } : null
    case 'device-backup':
      return route.params.source
        ? { app: 'device-backup', params: {} } : null
    case 'remote-pull':
      return route.params.source
        ? { app: 'remote-pull', params: {} } : null
    case 'admin-users':
      return route.params.user
        ? { app: 'admin-users', params: {} } : null
    case 'admin-storage':
      return route.params.section || route.params.task
        ? { app: 'admin-storage', params: {} } : null
    default: return null
  }
}
