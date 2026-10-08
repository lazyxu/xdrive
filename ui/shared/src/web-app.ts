import type { MediaGalleryQuery } from './models'
import type { XDriveFileExplorerGrouping } from './file-explorer-grouping'
import type { XDriveFileExplorerSearchFilters } from './file-explorer-search'

export const XDRIVE_WEB_APP_IDS = [
  'overview',
  'files',
  'gallery',
  'sync-folders',
  'tasks',
  'local-storage',
  'cloud-storage',
  'preview',
  'media-viewer',
  'text-viewer',
  'pdf-viewer',
  'audio-player',
  'admin-users',
  'admin-audit',
  'admin-storage',
] as const

export type XDriveWebAppID = typeof XDRIVE_WEB_APP_IDS[number]
export type XDriveWebAppPresentation = 'workspace' | 'viewer' | 'immersive'
export type XDriveWebGallerySection =
  | 'library'
  | 'memories'
  | 'people'
  | 'places'
  | 'albums'
  | 'favorites'
  | 'media-types'
  | 'cleanup'
  | 'trash'

export type XDriveWebAppFileSort = {
  key: 'name' | 'updated' | 'size' | 'type'
  direction: 'asc' | 'desc'
}

export type XDriveWebAppGalleryTarget = {
  kind:
    | 'all'
    | 'album'
    | 'suggested-person'
    | 'person'
    | 'memory'
    | 'duplicate-review'
    | 'burst-review'
    | 'pet'
    | 'trash'
  id?: string
  query: MediaGalleryQuery
}

export type XDriveWebAppBrowseContext =
  | {
      kind: 'selection'
      nodeIDs: number[]
      activeIndex: number
    }
  | {
      kind: 'directory'
      directoryID: number
      sort: XDriveWebAppFileSort
      grouping?: XDriveFileExplorerGrouping
      activeIndex: number
    }
  | {
      kind: 'search'
      query: string
      filters: XDriveFileExplorerSearchFilters
      sort: XDriveWebAppFileSort
      grouping?: XDriveFileExplorerGrouping
      activeIndex: number
    }
  | {
      kind: 'gallery'
      target: XDriveWebAppGalleryTarget
      activeIndex: number
      totalCount: number
    }

export interface XDriveWebAppLaunchMap {
  overview: Record<string, never>
  files: { dir?: number }
  gallery: { section?: XDriveWebGallerySection }
  'sync-folders': { source?: number }
  tasks: { scope?: 'mine' | 'global'; task?: string }
  'local-storage': Record<string, never>
  'cloud-storage': Record<string, never>
  preview: { node: number; context?: string }
  'media-viewer': { node: number; context?: string }
  'text-viewer': { node: number; line?: number; column?: number }
  'pdf-viewer': { node: number; page?: number }
  'audio-player': { node: number }
  'admin-users': { user?: number }
  'admin-audit': Record<string, never>
  'admin-storage': { section?: string; task?: string }
}

export type XDriveWebAppRoute = {
  [K in XDriveWebAppID]: { app: K; params: XDriveWebAppLaunchMap[K] }
}[XDriveWebAppID]

const xDriveWebAppIDSet = new Set<string>(XDRIVE_WEB_APP_IDS)
const xDriveWebGallerySectionSet = new Set<XDriveWebGallerySection>([
  'library', 'memories', 'people', 'places', 'albums',
  'favorites', 'media-types', 'cleanup', 'trash',
])

export function xDriveIsWebAppID(value: string): value is XDriveWebAppID {
  return xDriveWebAppIDSet.has(value)
}

function positiveInteger(value: string | null) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function xDriveWebAppHash(route: XDriveWebAppRoute) {
  const query = new URLSearchParams()
  const params = route.params as Record<string, unknown>
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString()
  return `#/app/${route.app}${suffix ? `?${suffix}` : ''}`
}

export function xDriveParseWebAppHash(hash: string): XDriveWebAppRoute | null {
  const match = hash.match(/^#\/app\/([^/?#]+)(?:\?([^#]*))?$/)
  if (!match || !xDriveIsWebAppID(match[1])) return null
  const app = match[1]
  const query = new URLSearchParams(match[2] || '')
  switch (app) {
    case 'files':
      return { app, params: { dir: positiveInteger(query.get('dir')) } }
    case 'gallery': {
      const sectionValue = query.get('section') || ''
      const section = xDriveWebGallerySectionSet.has(sectionValue as XDriveWebGallerySection)
        ? sectionValue as XDriveWebGallerySection
        : undefined
      return { app, params: { section } }
    }
    case 'sync-folders':
      return { app, params: { source: positiveInteger(query.get('source')) } }
    case 'tasks': {
      const scopeValue = query.get('scope')
      const scope = scopeValue === 'global' || scopeValue === 'mine' ? scopeValue : undefined
      return { app, params: { scope, task: query.get('task') || undefined } }
    }
    case 'preview':
    case 'media-viewer': {
      const node = positiveInteger(query.get('node'))
      if (!node) return null
      return { app, params: { node, context: query.get('context') || undefined } } as XDriveWebAppRoute
    }
    case 'audio-player': {
      const node = positiveInteger(query.get('node'))
      if (!node) return null
      return { app, params: { node } }
    }
    case 'text-viewer': {
      const node = positiveInteger(query.get('node'))
      if (!node) return null
      return {
        app,
        params: {
          node,
          line: positiveInteger(query.get('line')),
          column: positiveInteger(query.get('column')),
        },
      }
    }
    case 'pdf-viewer': {
      const node = positiveInteger(query.get('node'))
      if (!node) return null
      return { app, params: { node, page: positiveInteger(query.get('page')) } }
    }
    case 'admin-users':
      return { app, params: { user: positiveInteger(query.get('user')) } }
    case 'admin-storage':
      return {
        app,
        params: {
          section: query.get('section') || undefined,
          task: query.get('task') || undefined,
        },
      }
    case 'overview':
    case 'local-storage':
    case 'cloud-storage':
    case 'admin-audit':
      return { app, params: {} } as XDriveWebAppRoute
  }
}

export function xDriveWebAppViewer(app: XDriveWebAppID) {
  return app === 'preview' ||
    app === 'media-viewer' ||
    app === 'text-viewer' ||
    app === 'pdf-viewer' ||
    app === 'audio-player'
}
