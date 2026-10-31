import type { XDriveSynologyNASShare } from './synology-nas-share-inventory'
import type { XDriveDiagnosticReport } from './mui/DiagnosticsPage'
import type { XDriveFileTextPreview } from './file-preview'
import type { QuotaUsage, MediaItemRange, MediaAlbum } from './models'
import type { XDriveCloudStorageDataSource } from './mui/CloudStoragePage'
import type {
  XDriveDeviceBackupOverview, XDriveDeviceBackupRunPage,
  XDriveDeviceBackupFolderPage, XDriveDeviceBackupDataSource,
} from './device-backups'
import type { XDriveLocalBackupCommonBatchActions } from './mui/DeviceBackupLocalCommonBatchDialog'
import type { XDriveLocalBackupScheduleActions } from './mui/DeviceBackupLocalScheduleDialog'
import type { XDriveLocalBackupCommonBatch, XDriveLocalBackupCommonBatchHistoryPage, XDriveLocalBoundBackupSchedule } from './device-backups'

export type XDriveSynologyLocalSource = { source_id: number; name: string }
export type XDriveSynologyNASVolumeSpace = {
  capacity_bytes: number
  available_bytes: number
}


export type XDriveSynologyOwnerFileNode = {
  id: number
  parent_id?: number
  name: string
  type: 'dir' | 'file'
  size: number
  revision: number
  created_at: string
  updated_at: string
}
export type XDriveSynologyOwnerFilePageResponse = {
  items: XDriveSynologyOwnerFileNode[]
  next_cursor?: string
  has_more: boolean
  sort: 'name' | 'updated' | 'type' | 'size'
  order: 'asc' | 'desc'
}
export type XDriveSynologyOwnerMediaRange = {
  offset: number
  total: number
  revision: number
  sha256: string
  data: Uint8Array
}
export const XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES = 256 << 10

export const XDRIVE_SYNOLOGY_THUMBNAIL_MAX_BYTES = 2 << 20
export type XDriveSynologyOwnerThumbnail = {
  contentType: 'image/jpeg' | 'image/png'
  alphaState: '' | 'opaque' | 'masked' | 'unavailable'
  alphaMask: string
  data: Uint8Array
}

export type XDriveSynologyOwnerStreamMIME =
  | 'video/mp4' | 'video/webm'
  | 'audio/mpeg' | 'audio/mp4' | 'audio/ogg' | 'audio/wav' | 'audio/flac'

/** One *bounded*, fully verified motion byte resource; never a signed
 * Server URL or general-purpose DSM media proxy. */
export type XDriveSynologyOwnerLiveMotion = {
  nodeID: number
  revision: number
  mimeType: 'video/mp4' | 'video/quicktime'
  size: number
  sha256: string
  data: Uint8Array
}
export const XDRIVE_SYNOLOGY_OWNER_LIVE_MOTION_MAX_BYTES = 4 << 20

export type XDriveSynologyOwnerFileSort = XDriveSynologyOwnerFilePageResponse['sort']
export type XDriveSynologyOwnerFileOrder = XDriveSynologyOwnerFilePageResponse['order']

const allowedFileNodeFields = new Set([
  'id', 'parent_id', 'name', 'type', 'size', 'revision',
  'created_at', 'updated_at',
])
function validOwnerFileNode(raw: unknown, expectedParentID?: number): raw is XDriveSynologyOwnerFileNode {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const node = raw as XDriveSynologyOwnerFileNode
  return Object.keys(node).every((k) => allowedFileNodeFields.has(k)) &&
    Number.isSafeInteger(node.id) && node.id > 0 &&
    Number.isSafeInteger(node.revision) && node.revision > 0 &&
    Number.isSafeInteger(node.size) && node.size >= 0 &&
    typeof node.name === 'string' && node.name.length > 0 && node.name.length <= 512 &&
    (node.type === 'dir' || node.type === 'file') &&
    typeof node.created_at === 'string' && Number.isFinite(Date.parse(node.created_at)) &&
    typeof node.updated_at === 'string' && Number.isFinite(Date.parse(node.updated_at)) &&
    (expectedParentID === undefined
      ? node.parent_id === undefined
      : node.parent_id === expectedParentID)
}
export function xDriveValidateSynologyOwnerFileRoot(raw: unknown): XDriveSynologyOwnerFileNode {
  if (!validOwnerFileNode(raw) || (raw as XDriveSynologyOwnerFileNode).type !== 'dir') {
    throw new Error('Invalid authenticated Server Owner cloud root')
  }
  return raw as XDriveSynologyOwnerFileNode
}
export function xDriveValidateSynologyOwnerFilesPage(
  raw: unknown, parentID: number, limit: number,
  sort: XDriveSynologyOwnerFileSort, order: XDriveSynologyOwnerFileOrder, cursor: string,
): XDriveSynologyOwnerFilePageResponse {
  const page = raw as XDriveSynologyOwnerFilePageResponse | null
  if (!page || typeof page !== 'object' || Array.isArray(page) ||
    Object.keys(page).some((key) => ![
      'items', 'has_more', 'next_cursor', 'sort', 'order',
    ].includes(key)) ||
    !Array.isArray(page.items) || page.items.length > limit ||
    typeof page.has_more !== 'boolean' || page.sort !== sort || page.order !== order ||
    (page.has_more &&
      (page.items.length === 0 || typeof page.next_cursor !== 'string' ||
        page.next_cursor.length === 0 || page.next_cursor === cursor)) ||
    (!page.has_more && page.next_cursor !== undefined && page.next_cursor !== '')) {
    throw new Error('Invalid authenticated Server Owner cloud folder page')
  }
  const next = page.next_cursor ?? ''
  if (next.length > 1024 || /[\u0000\r\n]/.test(next)) {
    throw new Error('Invalid authenticated Server Owner cloud cursor')
  }
  const seen = new Set<number>()
  for (const node of page.items) {
    if (!validOwnerFileNode(node, parentID) || seen.has(node.id)) {
      throw new Error('Invalid authenticated Server Owner child or duplicate')
    }
    seen.add(node.id)
  }
  return page
}



// The browser re-validates the exact redacted Server Owner projection returned
// by the fixed DSM CGI. Unlike Desktop media RPC, unknown private fields,
// unsafe numbers and unrelated metadata can never enter shared Gallery JSX.
const ownerGalleryNodeKeys = new Set([
  'id', 'parent_id', 'name', 'type', 'size', 'revision', 'created_at', 'updated_at',
])
const ownerGalleryMetadataKeys = new Set([
  'media_kind', 'mime_type', 'width', 'height', 'duration_ms',
  'captured_at', 'index_state', 'has_thumbnail',
])
const ownerGalleryItemKeys = new Set([
  'node', 'metadata', 'asset_kind', 'favorite', 'live_photo',
])
const ownerGalleryAlbumKeys = new Set([
  'id', 'kind', 'name', 'item_count', 'album_folder_id',
  'revision', 'cover_node_id', 'updated_at',
])
const ownerGalleryAlbumID = /^(?:manual|source|folder|smart):[A-Za-z0-9_:-]{1,150}$/
const ownerGalleryObject = (raw: unknown): raw is Record<string, unknown> =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw)
const ownerGalleryInt = (raw: unknown, positive = false): raw is number =>
  Number.isSafeInteger(raw) && (positive ? (raw as number) > 0 : (raw as number) >= 0)
const ownerGalleryTime = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 &&
  Number.isFinite(Date.parse(value))
function validOwnerGalleryItem(value: unknown): boolean {
  if (!ownerGalleryObject(value) ||
    Object.keys(value).some((key) => !ownerGalleryItemKeys.has(key)) ||
    !ownerGalleryObject(value.node) || !ownerGalleryObject(value.metadata)) return false
  const n = value.node
  const m = value.metadata
  return Object.keys(n).every((key) => ownerGalleryNodeKeys.has(key)) &&
    ownerGalleryInt(n.id, true) && ownerGalleryInt(n.parent_id, true) &&
    ownerGalleryInt(n.revision, true) && ownerGalleryInt(n.size) &&
    n.type === 'file' &&
    typeof n.name === 'string' && n.name.length > 0 && n.name.length <= 512 &&
    !/[\u0000\r\n]/.test(n.name) &&
    ownerGalleryTime(n.created_at) && ownerGalleryTime(n.updated_at) &&
    Object.keys(m).every((key) => ownerGalleryMetadataKeys.has(key)) &&
    (m.media_kind === 'image' || m.media_kind === 'video') &&
    typeof m.index_state === 'string' && m.index_state.length <= 64 &&
    /^[\x20-\x7e]*$/.test(m.index_state) &&
    typeof m.has_thumbnail === 'boolean' &&
    (m.mime_type === undefined || (typeof m.mime_type === 'string' &&
      m.mime_type.length <= 128 && /^[\x20-\x7e]*$/.test(m.mime_type))) &&
    (m.width === undefined || (ownerGalleryInt(m.width) && m.width <= 100000)) &&
    (m.height === undefined || (ownerGalleryInt(m.height) && m.height <= 100000)) &&
    (m.duration_ms === undefined || ownerGalleryInt(m.duration_ms)) &&
    (m.captured_at === undefined || ownerGalleryTime(m.captured_at)) &&
    (value.asset_kind === undefined ||
      (typeof value.asset_kind === 'string' && value.asset_kind.length <= 64 &&
       /^[a-z0-9_]*$/.test(value.asset_kind))) &&
    typeof value.favorite === 'boolean' &&
    (value.live_photo === undefined || typeof value.live_photo === 'boolean')
}
function validateOwnerGalleryPage(raw: unknown, limit: number, offset: number): MediaItemRange {
  if (!ownerGalleryObject(raw) ||
    Object.keys(raw).some((key) => !['items', 'total_count', 'offset', 'limit'].includes(key)) ||
    !Array.isArray(raw.items) || raw.items.length > limit ||
    !ownerGalleryInt(raw.total_count) || raw.offset !== offset || raw.limit !== limit ||
    (raw.items.length === 0 && offset < raw.total_count) ||
    (raw.items.length > 0 && offset + raw.items.length > raw.total_count)) {
    throw new Error('Invalid authenticated Server Owner Gallery Range')
  }
  const seen = new Set<number>()
  for (const item of raw.items) {
    if (!validOwnerGalleryItem(item) || seen.has(item.node.id)) {
      throw new Error('Invalid or duplicate authenticated Owner Gallery item')
    }
    seen.add(item.node.id)
  }
  return raw as unknown as MediaItemRange
}
function validateOwnerGalleryAlbums(raw: unknown): MediaAlbum[] {
  if (!Array.isArray(raw) || raw.length > 4096) {
    throw new Error('Invalid authenticated Server Owner Gallery albums')
  }
  const seen = new Set<string>()
  for (const value of raw) {
    if (!ownerGalleryObject(value) ||
      Object.keys(value).some((key) => !ownerGalleryAlbumKeys.has(key)) ||
      typeof value.id !== 'string' || !ownerGalleryAlbumID.test(value.id) ||
      seen.has(value.id) ||
      !['folder', 'source', 'manual', 'smart', 'imported'].includes(String(value.kind)) ||
      typeof value.name !== 'string' || value.name.length === 0 || value.name.length > 512 ||
      !ownerGalleryInt(value.item_count) ||
      (value.album_folder_id !== undefined && !ownerGalleryInt(value.album_folder_id)) ||
      (value.revision !== undefined && !ownerGalleryInt(value.revision)) ||
      (value.cover_node_id !== undefined && !ownerGalleryInt(value.cover_node_id, true)) ||
      (value.updated_at !== undefined && !ownerGalleryTime(value.updated_at))) {
      throw new Error('Invalid or duplicate authenticated Owner Gallery album')
    }
    seen.add(value.id)
  }
  return raw as MediaAlbum[]
}

export type XDriveSynologyNativeDraft = {
  source_id: number
  name: string
  revision: 1
  created_at: string
}
export type XDriveSynologyNativeDraftReview = {
  owner_scope: string
  items: XDriveSynologyNativeDraft[]
}

export type XDriveSynologyCreatedBackupSource = {
  source_id: number
  state: 'authorized' | 'needs_inspection'
}

export type XDriveSynologyServerConnection = {
  owner_scope: string
  configured: boolean
  server?: string
  username?: string
  must_change_password: boolean
}

export interface XDriveSynologyBackupLocalClient extends XDriveLocalBackupCommonBatchActions, XDriveLocalBackupScheduleActions {
  list(signal?: AbortSignal): Promise<XDriveSynologyLocalSource[]>
  /** Credential-free, same-user read-only Agent login status. */
  serverConnection(signal?: AbortSignal): Promise<XDriveSynologyServerConnection>
  /** Initial or same-Owner login only; no Server/Owner migration or Root grants. */
  loginServer(server: string, username: string, password: string, signal?: AbortSignal): Promise<void>
  /** Same-principal DSM package-user read-only NAS share roots. */
  nasShares(signal?: AbortSignal): Promise<XDriveSynologyNASShare[]>
  /** Verify a session-scoped share with the existing owning Agent; no Root grant. */
  preflightNASShare(selectionID: string, signal?: AbortSignal): Promise<void>
  /** Inspect only this original Agent's own never-bound Source drafts; no Root or write. */
  nativeDrafts(signal?: AbortSignal): Promise<XDriveSynologyNativeDraftReview>
  /** Explicitly bind an existing creating-device draft to a newly verified NAS share. */
  bindNativeDraft(
    sourceID: number, selectionID: string, ownerScope: string, signal?: AbortSignal,
  ): Promise<XDriveSynologyCreatedBackupSource>
  /** Creates a paused native Source on the verified NAS share; never starts Runner. */
  createNASBackupSource(
    selectionID: string, ownerScope: string, targetID: number, name: string, signal?: AbortSignal,
  ): Promise<XDriveSynologyCreatedBackupSource>
  diagnostics(signal?: AbortSignal): Promise<XDriveDiagnosticReport>
  /** Authorized DSM package configuration filesystem only; never all NAS disks or Server quota. */
  nasVolumeSpace(signal?: AbortSignal): Promise<XDriveSynologyNASVolumeSpace>
  inspect(sourceID: number, signal?: AbortSignal): Promise<XDriveLocalBackupCommonBatch>
  history(sourceID: number, signal?: AbortSignal): Promise<XDriveLocalBackupCommonBatchHistoryPage>
  /** Other devices: Server-authenticated Owner B-scope, strictly read-only. */
  ownerDevices(): Promise<XDriveDeviceBackupOverview>
  ownerDevicesPage(limit: number, afterDeviceID: string): Promise<XDriveDeviceBackupOverview>
  ownerFoldersPage(deviceID: string, limit: number, afterSourceID: number): Promise<XDriveDeviceBackupFolderPage>
  ownerRuns(sourceID: number, limit: number, offset: number): Promise<XDriveDeviceBackupRunPage>
  /** Authenticated Agent Server Owner quota, not a DSM volume metric. */
  ownerQuota(signal?: AbortSignal): Promise<QuotaUsage>
  ownerFilesRoot(signal?: AbortSignal): Promise<XDriveSynologyOwnerFileNode>
  /** Bounded Server Owner Gallery wall and album read; never full Desktop Media RPC. */
  ownerGalleryItemsRange(
    kind: 'all' | 'image' | 'video', limit: number, offset: number,
    albumID?: string, signal?: AbortSignal,
  ): Promise<MediaItemRange>
  ownerGalleryAlbums(signal?: AbortSignal): Promise<MediaAlbum[]>
  /** Exact current Owner Live Photo only; 4 MiB bounded video bytes. */
  ownerLivePhotoMotion(
    nodeID: number, revision: number, signal?: AbortSignal,
  ): Promise<XDriveSynologyOwnerLiveMotion>
  /** Strict bounded JSON text read, not arbitrary binary or signed content URL. */
  ownerFileTextPreview(nodeID: number, signal?: AbortSignal): Promise<XDriveFileTextPreview>
  /** Current revision must be re-verified by the Owner Server; no Agent cached
   * data from a previous login may be returned under this file identity. */
  ownerFileThumbnail(
    nodeID: number, revision: number, signal?: AbortSignal,
  ): Promise<XDriveSynologyOwnerThumbnail>
  ownerFileMediaRange(
    nodeID: number, revision: number, offset: number, length: number,
    signal?: AbortSignal,
  ): Promise<XDriveSynologyOwnerMediaRange>
  /** Session-bound DSM URL for the browser's native HTMLMediaElement Range
   * requests. This URL is NOT a token: DSM and Agent reauthorize every request. */
  ownerFileMediaStreamURL(
    nodeID: number, revision: number, total: number, sha256: string,
    mime: XDriveSynologyOwnerStreamMIME,
  ): string
  ownerFilesPage(
    parentID: number, limit: number, sort: XDriveSynologyOwnerFileSort,
    order: XDriveSynologyOwnerFileOrder, cursor: string, signal?: AbortSignal,
  ): Promise<XDriveSynologyOwnerFilePageResponse>
}

// Transport only. A DSM CGI backend authenticates every request and delegates
// owner-verified operations to the original xdrive-agent. Nothing is persisted.
export function createXDriveSynologyBackupLocalClient(cgiURL: string): XDriveSynologyBackupLocalClient {
  const endpoint = new URL(cgiURL, window.location.href)
  if (endpoint.origin !== window.location.origin || endpoint.protocol !== 'https:' ||
    endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error('DSM Backup requires an authenticated same-origin HTTPS CGI')
  }
  let token: string | null = null
  // Browser-only abort handles for the optional read-only recovery observer.
  // These are never sent to the Server or persisted as backup operation IDs.
  const recoveryReads = new Map<string, AbortController>()
  async function request<T>(
    path: string, method: 'GET' | 'POST' = 'GET', payload?: unknown, signal?: AbortSignal,
  ): Promise<T> {
    const virtual = new URL(path, 'https://internal.invalid')
    if (!virtual.pathname.startsWith('/v1/') || virtual.hash) {
      throw new Error('Unsupported DSM backup operation')
    }
    const operation = virtual.pathname.slice('/v1/'.length)
    if (!['bootstrap', 'sources', 'status', 'history', 'run', 'control', 'schedule',
      'device-backups', 'device-backup-runs',
      'device-backup-page', 'device-backup-folders', 'cloud-quota', 'nas-volume',
      'cloud-root', 'cloud-children', 'cloud-text-preview', 'cloud-media-range', 'cloud-thumbnail',
       'cloud-gallery-items', 'cloud-gallery-albums', 'cloud-live-motion', 'nas-shares',
      'nas-share-preflight', 'nas-share-create', 'nas-draft-bind', 'nas-drafts', 'server-connection', 'server-login',
      'recovery-review'].includes(operation)) {
      throw new Error('Unsupported DSM backup operation')
    }
    // DSM custom CGI is one executable URL. Extra /v1/ PATH_INFO suffixes
    // are not reliably forwarded on DSM, so dispatch through one query key.
    const url = new URL(endpoint.href)
    url.searchParams.set('op', operation)
    virtual.searchParams.forEach((value, key) => {
      if (key === 'op' || url.searchParams.has(key)) throw new Error('Duplicate DSM operation')
      url.searchParams.set(key, value)
    })
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (method === 'POST') {
      if (!token) {
        const bootstrap = await request<{ csrf_token: string }>('/v1/bootstrap')
        if (!/^[0-9a-f]{64}$/.test(bootstrap.csrf_token)) throw new Error('DSM CSRF token unavailable')
        token = bootstrap.csrf_token
      }
      headers['X-CSRF-Token'] = token
    }
    const body = payload === undefined ? undefined : JSON.stringify(payload)
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(url.href, {
      method, credentials: 'same-origin', cache: 'no-store', mode: 'same-origin',
      redirect: 'error', referrerPolicy: 'no-referrer', headers, body, signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) token = null
      throw new Error(`DSM backup request rejected (HTTP ${response.status})`)
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error('Invalid DSM local adapter response')
    }
    return await response.json() as T
  }
  const sourceQuery = (sourceID: number): string => {
    if (!Number.isSafeInteger(sourceID) || sourceID < 1) throw new Error('Invalid owning Source ID')
    return `?source_id=${sourceID}`
  }
  // Same canonical device cursor constraints as the native Agent and Server.
  const canonicalDeviceID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const validPageLimit = (limit: number) => Number.isSafeInteger(limit) && limit >= 1 && limit <= 100
  const api: XDriveSynologyBackupLocalClient = {
    async nativeDrafts(signal) {
      const raw = await request<unknown>('/v1/nas-drafts', 'GET', undefined, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid owning Agent draft inspection')
      }
      const report = raw as Record<string, unknown>
      if (Object.keys(report).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(report, 'owner_scope') ||
        !Object.prototype.hasOwnProperty.call(report, 'items') ||
        typeof report.owner_scope !== 'string' ||
        !/^[0-9a-f]{64}$/.test(report.owner_scope) ||
        !Array.isArray(report.items) || report.items.length > 100) {
        throw new Error('Untrusted native DSM draft inventory')
      }
      let previous = 0
      const items: XDriveSynologyNativeDraft[] = []
      for (const value of report.items) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid native DSM draft row')
        }
        const item = value as Record<string, unknown>
        if (Object.keys(item).length !== 4 ||
          !['source_id', 'name', 'revision', 'created_at'].every(
            key => Object.prototype.hasOwnProperty.call(item, key)) ||
          !Number.isSafeInteger(item.source_id) ||
          (item.source_id as number) <= previous ||
          item.revision !== 1 ||
          typeof item.name !== 'string' || item.name.length < 1 ||
          new TextEncoder().encode(item.name).length > 128 ||
          item.name.trim() !== item.name || /[\r\n\0]/.test(item.name) ||
          typeof item.created_at !== 'string' ||
          !Number.isFinite(Date.parse(item.created_at))) {
          throw new Error('Untrusted native DSM draft row or ordering')
        }
        previous = item.source_id as number
        items.push({
          source_id: item.source_id as number,
          name: item.name as string,
          revision: 1,
          created_at: item.created_at as string,
        })
      }
      return { owner_scope: report.owner_scope as string, items }
    },
    async bindNativeDraft(sourceID, selectionID, ownerScope, signal) {
      if (!Number.isSafeInteger(sourceID) || sourceID < 1 ||
        !/^[0-9a-f]{64}$/.test(selectionID) ||
        !/^[0-9a-f]{64}$/.test(ownerScope)) {
        throw new Error('Invalid owning DSM native draft binding')
      }
      const raw = await request<unknown>('/v1/nas-draft-bind', 'POST', {
        source_id: sourceID, selection_id: selectionID,
        owner_scope: ownerScope, confirmed: true,
      }, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Unverified DSM native draft binding response')
      }
      const response = raw as Record<string, unknown>
      if (Object.keys(response).length !== 2 ||
        response.source_id !== sourceID ||
        (response.state !== 'authorized' && response.state !== 'needs_inspection')) {
        throw new Error('Invalid owning Agent native Root binding status')
      }
      return { source_id: sourceID, state: response.state }
    },
    async createNASBackupSource(selectionID, ownerScope, targetID, name, signal) {
      if (!/^[0-9a-f]{64}$/.test(selectionID) ||
        !/^[0-9a-f]{64}$/.test(ownerScope) ||
        !Number.isSafeInteger(targetID) || targetID < 1 ||
        name.trim() !== name || name.length < 1 ||
        new TextEncoder().encode(name).length > 128 ||
        /[\r\n\0]/.test(name)) {
        throw new Error('Invalid DSM local Source setup selection')
      }
      const raw = await request<unknown>('/v1/nas-share-create', 'POST',
        { selection_id: selectionID, owner_scope: ownerScope, target_id: targetID, name, confirmed: true }, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Unverified owning Agent Source setup')
      }
      const payload = raw as Record<string, unknown>
      if (Object.keys(payload).length !== 2 ||
        !Number.isSafeInteger(payload.source_id) || (payload.source_id as number) < 1 ||
        (payload.state !== 'authorized' && payload.state !== 'needs_inspection')) {
        throw new Error('Invalid owning Agent Source setup acknowledgement')
      }
      return { source_id: payload.source_id as number, state: payload.state }
    },

    async serverConnection(signal) {
      const raw = await request<unknown>('/v1/server-connection', 'GET', undefined, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid DSM Agent Server identity')
      }
      const status = raw as Record<string, unknown>
      if (Object.keys(status).some(key =>
          !['configured', 'server', 'username', 'must_change_password', 'owner_scope'].includes(key)) ||
        typeof status.configured !== 'boolean' ||
        typeof status.must_change_password !== 'boolean' ||
        typeof status.owner_scope !== 'string' ||
        (status.configured && !/^[0-9a-f]{64}$/.test(status.owner_scope)) ||
        (!status.configured && status.owner_scope !== '') ||
        (status.configured && (typeof status.server !== 'string' ||
          typeof status.username !== 'string' || status.username.length < 1 ||
          status.username.length > 128)) ||
        (!status.configured && (status.server !== undefined || status.username !== undefined))) {
        throw new Error('Untrusted DSM Agent Server connection')
      }
      if (status.configured) {
        const url = new URL(status.server as string)
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
          url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
          throw new Error('Invalid authenticated DSM Server URL')
        }
      }
      return {
        configured: status.configured === true,
        must_change_password: status.must_change_password === true,
        owner_scope: status.owner_scope as string,
        ...(typeof status.server === 'string' ? { server: status.server } : {}),
        ...(typeof status.username === 'string' ? { username: status.username } : {}),
      }
    },
    async loginServer(server, username, password, signal) {
      // Do not accept browser-provided trust roots, local paths, Owner IDs,
      // password persistence, or generic Agent method selectors.
      let parsed: URL
      try { parsed = new URL(server) } catch { throw new Error('Server URL must use HTTPS') }
      if (parsed.protocol !== 'https:' || !parsed.hostname ||
        parsed.username || parsed.password || parsed.search || parsed.hash ||
        parsed.pathname !== '/' || server.length > 512 ||
        username.length < 1 || username.length > 128 ||
        username.trim() !== username || /[\r\n\0]/.test(username) ||
        password.length < 1 || new TextEncoder().encode(password).length > 4096 ||
        /[\r\n\0]/.test(password)) {
        throw new Error('Invalid DSM Server login form')
      }
      const raw = await request<unknown>('/v1/server-login', 'POST',
        { server, username, password }, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        Object.keys(raw).length !== 1 || (raw as { verified?: unknown }).verified !== true) {
        throw new Error('DSM Agent did not verify current Server Owner login')
      }
    },

    async preflightNASShare(selectionID, signal) {
      if (!/^[0-9a-f]{64}$/.test(selectionID)) throw new Error('Invalid DSM NAS share selection')
      const raw = await request<unknown>('/v1/nas-share-preflight', 'POST',
        { selection_id: selectionID }, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        Object.keys(raw).length !== 1 || (raw as { verified?: unknown }).verified !== true) {
        throw new Error('Unverified DSM native NAS share preflight')
      }
    },
    async nasShares(signal) {
      const raw = await request<unknown>('/v1/nas-shares', 'GET', undefined, signal)
      // Keep this feature-only module out of the existing Owner-read VM
      // fixtures, which execute unrelated methods without a module loader.
      // Vite resolves the import into an isolated, same-origin DSM asset.
      const { xDriveValidateSynologyNASShareInventory } =
        await import('./synology-nas-share-inventory')
      return xDriveValidateSynologyNASShareInventory(raw)
    },
    async list(signal) {
      const page = await request<{ items: XDriveSynologyLocalSource[] }>(
        '/v1/sources', 'GET', undefined, signal)
      if (!Array.isArray(page?.items) || page.items.length > 512) throw new Error('Invalid DSM Source list')
      const unique = new Set<number>()
      for (const item of page.items) {
        if (!item || !Number.isSafeInteger(item.source_id) || item.source_id < 1 ||
          typeof item.name !== 'string' || item.name.length > 512 || unique.has(item.source_id)) {
          throw new Error('Invalid or duplicate DSM Source')
        }
        unique.add(item.source_id)
      }
      return page.items
    },
    async diagnostics(signal) {
      // Both reads are authenticated independently by the same-origin DSM CGI.
      const session = await request<{ dsm_user: string; csrf_token: string }>(
        '/v1/bootstrap', 'GET', undefined, signal)
      if (!session || typeof session.dsm_user !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,64}$/.test(session.dsm_user) ||
        typeof session.csrf_token !== 'string' || !/^[0-9a-f]{64}$/.test(session.csrf_token)) {
        throw new Error('DSM authenticated session unavailable')
      }
      await api.list(signal) // A valid empty source list is not a failure.
      return {
        generated_at: new Date().toISOString(),
        platform: 'Synology DSM',
        arch: 'not measured',
        checks: [
          { name: 'DSM session', status: 'PASS', detail: 'DSM-authorized local session' },
          { name: 'local backup agent', status: 'PASS', detail: 'owner-scoped read-only sources' },
        ],
        summary: { pass: 2, warn: 0, fail: 0 },
      }
    },
    ownerGalleryItemsRange: async (kind, limit, offset, albumID = '', signal) => {
      if (!['all', 'image', 'video'].includes(kind) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 10000000 ||
        (albumID !== '' && !ownerGalleryAlbumID.test(albumID))) {
        throw new Error('Invalid authenticated Owner Gallery read selector')
      }
      const query = '/v1/cloud-gallery-items?kind=' + kind +
        '&limit=' + limit + '&offset=' + offset +
        (albumID ? '&album_id=' + encodeURIComponent(albumID) : '')
      return validateOwnerGalleryPage(
        await request<unknown>(query, 'GET', undefined, signal), limit, offset)
    },
    ownerGalleryAlbums: async (signal) => validateOwnerGalleryAlbums(
      await request<unknown>('/v1/cloud-gallery-albums', 'GET', undefined, signal)),
    ownerLivePhotoMotion: async (nodeID, revision, signal) => {
      if (![nodeID, revision].every(value => Number.isSafeInteger(value) && value > 0)) {
        throw new Error('Invalid Owner Live Photo identity')
      }
      const raw = await request<unknown>(
        '/v1/cloud-live-motion?node_id=' + nodeID + '&revision=' + revision,
        'GET', undefined, signal)
      if (signal?.aborted || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Owner Live Photo is no longer available')
      }
      const data = raw as Record<string, unknown>
      if (Object.keys(data).length !== 6 ||
        Object.keys(data).some(key =>
          !['node_id', 'revision', 'mime_type', 'size', 'sha256', 'data'].includes(key)) ||
        data.node_id !== nodeID || data.revision !== revision ||
        (data.mime_type !== 'video/mp4' && data.mime_type !== 'video/quicktime') ||
        !Number.isSafeInteger(data.size) || (data.size as number) < 12 ||
        (data.size as number) > XDRIVE_SYNOLOGY_OWNER_LIVE_MOTION_MAX_BYTES ||
        typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256) ||
        typeof data.data !== 'string' ||
        data.data.length > Math.ceil(XDRIVE_SYNOLOGY_OWNER_LIVE_MOTION_MAX_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.data)) {
        throw new Error('Invalid Owner Live Photo projection')
      }
      const binary = atob(data.data)
      if (binary.length !== data.size || binary.length < 12 ||
        binary.slice(4, 8) !== 'ftyp') {
        throw new Error('Owner Live Photo motion signature or size changed')
      }
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      if (signal?.aborted) throw new Error('Owner Live Photo cancelled')
      return {
        nodeID, revision,
        mimeType: data.mime_type as XDriveSynologyOwnerLiveMotion['mimeType'],
        size: bytes.length, sha256: data.sha256, data: bytes,
      }
    },
    ownerFilesRoot: async (signal) =>
      xDriveValidateSynologyOwnerFileRoot(
        await request<unknown>('/v1/cloud-root', 'GET', undefined, signal)),
    ownerFileTextPreview: async (nodeID, signal) => {
      if (!Number.isSafeInteger(nodeID) || nodeID < 1) {
        throw new Error('Invalid Server Owner text preview file ID')
      }
      const raw = await request<unknown>(
        '/v1/cloud-text-preview?node_id=' + nodeID, 'GET', undefined, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid authenticated Owner text preview')
      }
      const preview = raw as XDriveFileTextPreview
      const fields = Object.keys(preview)
      if (fields.length !== 3 || fields.some(field =>
        !['text', 'truncated', 'size'].includes(field)) ||
        typeof preview.text !== 'string' || preview.text.length > (1 << 20) ||
        new TextEncoder().encode(preview.text).length > (1 << 20) ||
        typeof preview.truncated !== 'boolean' ||
        !Number.isSafeInteger(preview.size) || preview.size < 0) {
        throw new Error('Invalid or oversized authenticated Owner text preview')
      }
      return preview
    },
    ownerFileThumbnail: async (nodeID, revision, signal) => {
      if (!Number.isSafeInteger(nodeID) || nodeID < 1 ||
          !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('Invalid Owner thumbnail ID or revision')
      }
      const raw = await request<unknown>(
        '/v1/cloud-thumbnail?node_id=' + nodeID + '&revision=' + revision,
        'GET', undefined, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid Owner thumbnail payload')
      }
      const obj = raw as Record<string, unknown>
      if (Object.keys(obj).length !== 4 ||
        Object.keys(obj).some(k => !['content_type', 'alpha_state', 'alpha_mask', 'data'].includes(k)) ||
        (obj.content_type !== 'image/jpeg' && obj.content_type !== 'image/png') ||
        !['', 'opaque', 'masked', 'unavailable'].includes(obj.alpha_state as string) ||
        typeof obj.alpha_mask !== 'string' ||
        typeof obj.data !== 'string' ||
        obj.data.length > Math.ceil(XDRIVE_SYNOLOGY_THUMBNAIL_MAX_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(obj.data) ||
        (obj.alpha_state !== 'masked' && obj.alpha_mask !== '') ||
        (obj.alpha_state === 'masked' && (
          obj.content_type !== 'image/png' || obj.alpha_mask.length < 4 ||
          obj.alpha_mask.length > 4096 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(obj.alpha_mask)))) {
        throw new Error('Invalid Owner thumbnail image or alpha metadata')
      }
      const binary = atob(obj.data)
      if (!binary.length || binary.length > XDRIVE_SYNOLOGY_THUMBNAIL_MAX_BYTES) {
        throw new Error('Invalid Owner thumbnail body size')
      }
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const isPNG = obj.content_type === 'image/png'
      if (isPNG ? bytes.length < 8 ||
            ![137, 80, 78, 71, 13, 10, 26, 10].every((n,i) => bytes[i] === n)
          : bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
        throw new Error('Invalid Owner thumbnail file signature')
      }
      if (obj.alpha_state === 'masked') {
        const mask = atob(obj.alpha_mask)
        if (mask.length < 8 ||
          ![137, 80, 78, 71, 13, 10, 26, 10].every((n,i) => mask.charCodeAt(i) === n)) {
          throw new Error('Invalid Owner thumbnail alpha mask')
        }
      }
      return {
        contentType: obj.content_type as 'image/jpeg' | 'image/png',
        alphaState: obj.alpha_state as XDriveSynologyOwnerThumbnail['alphaState'],
        alphaMask: obj.alpha_mask,
        data: bytes,
      }
    },
    ownerFileMediaRange: async (nodeID, revision, offset, length, signal) => {
      const validID = (value: number) => Number.isSafeInteger(value) && value > 0
      if (!validID(nodeID) || !validID(revision) ||
        !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 ||
        length > XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES) {
        throw new Error('Invalid authenticated Owner media range selector')
      }
      const raw = await request<unknown>(
        '/v1/cloud-media-range?node_id=' + nodeID + '&revision=' + revision +
        '&offset=' + offset + '&length=' + length, 'GET', undefined, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid authenticated Owner media range')
      }
      const response = raw as Record<string, unknown>
      if (Object.keys(response).length !== 5 ||
        Object.keys(response).some(k => !['offset', 'total', 'revision', 'sha256', 'data'].includes(k)) ||
        response.offset !== offset || response.revision !== revision ||
        typeof response.total !== 'number' ||
        !Number.isSafeInteger(response.total) || response.total <= offset ||
        typeof response.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(response.sha256) ||
        typeof response.data !== 'string' ||
        response.data.length > Math.ceil(length / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.data)) {
        throw new Error('Invalid or unauthorized Owner media range projection')
      }
      const binary = atob(response.data)
      const data = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index)
      if (data.length < 1 || data.length > length ||
        offset + data.length > response.total ||
        (data.length !== length && offset + data.length !== response.total)) {
        throw new Error('Inconsistent verified Owner media range bytes')
      }
      return {
        offset, total: response.total, revision,
        sha256: response.sha256, data,
      }
    },
    ownerFileMediaStreamURL: (nodeID, revision, total, sha256, mime) => {
      if (![nodeID, revision, total].every(value =>
        Number.isSafeInteger(value) && value > 0) ||
        !/^[0-9a-f]{64}$/.test(sha256) ||
        !['video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4',
          'audio/ogg', 'audio/wav', 'audio/flac'].includes(mime)) {
        throw new Error('Invalid authenticated Owner playback identity')
      }
      // Only the trusted, same-origin DSM CGI endpoint is used; arbitrary
      // Server/CDN URLs, bearer tokens, source paths and redirects are absent.
      const url = new URL(endpoint.href)
      url.searchParams.set('op', 'cloud-media-stream')
      url.searchParams.set('node_id', String(nodeID))
      url.searchParams.set('revision', String(revision))
      url.searchParams.set('total', String(total))
      url.searchParams.set('sha256', sha256)
      url.searchParams.set('mime', mime)
      return url.href
    },
    ownerFilesPage: async (parentID, limit, sort, order, cursor, signal) => {
      if (!Number.isSafeInteger(parentID) || parentID < 1 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
        !['name', 'updated', 'type', 'size'].includes(sort) ||
        (order !== 'asc' && order !== 'desc') ||
        typeof cursor !== 'string' || cursor.length > 1024 ||
        /[\u0000\r\n]/.test(cursor)) {
        throw new Error('Invalid Server Owner folder paging selector')
      }
      const url = '/v1/cloud-children?parent_id=' + parentID +
        '&limit=' + limit + '&sort=' + sort + '&order=' + order +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
      return xDriveValidateSynologyOwnerFilesPage(
        await request<unknown>(url, 'GET', undefined, signal),
        parentID, limit, sort, order, cursor)
    },
    nasVolumeSpace: async (signal) => {
      const raw = await request<unknown>('/v1/nas-volume', 'GET', undefined, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
          Object.keys(raw).length !== 2 ||
          Object.keys(raw).some(k => k !== 'capacity_bytes' && k !== 'available_bytes')) {
        throw new Error('Invalid authenticated DSM package filesystem projection')
      }
      const info = raw as Record<string, unknown>
      if (!Number.isSafeInteger(info.capacity_bytes) || (info.capacity_bytes as number) <= 0 ||
          !Number.isSafeInteger(info.available_bytes) || (info.available_bytes as number) < 0 ||
          (info.available_bytes as number) > (info.capacity_bytes as number)) {
        throw new Error('Invalid DSM package filesystem capacity')
      }
      return { capacity_bytes: info.capacity_bytes as number, available_bytes: info.available_bytes as number }
    },
    ownerQuota: async (signal) => {
      const quota = await request<QuotaUsage>('/v1/cloud-quota', 'GET', undefined, signal)
      const fields = [
        'quota_bytes', 'physical_used_bytes', 'reserved_bytes', 'available_bytes',
        'logical_file_bytes', 'trash_bytes', 'history_bytes',
      ] as const
      const optional = ['disk_total_bytes', 'disk_available_bytes'] as const
      const allowed = new Set<string>([...fields, ...optional, 'over_quota'])
      if (!quota || typeof quota !== 'object' || Array.isArray(quota) ||
        Object.keys(quota).some((key) => !allowed.has(key)) ||
        typeof quota.over_quota !== 'boolean' ||
        fields.some((key) => !Number.isSafeInteger(quota[key]) || quota[key] < 0) ||
        optional.some((key) => quota[key] !== undefined &&
          (!Number.isSafeInteger(quota[key]) || (quota[key] as number) < 0))) {
        throw new Error('Invalid authenticated xDrive Server Owner quota')
      }
      return quota
    },
    ownerDevices: () => request<XDriveDeviceBackupOverview>('/v1/device-backups'),
    ownerDevicesPage: (limit, afterDeviceID) => {
      if (!validPageLimit(limit) || !canonicalDeviceID.test(afterDeviceID)) {
        throw new Error('Invalid owner device page cursor or limit')
      }
      return request<XDriveDeviceBackupOverview>(
        '/v1/device-backup-page?limit=' + limit + '&after_device_id=' + afterDeviceID)
    },
    ownerFoldersPage: (deviceID, limit, afterSourceID) => {
      if (!canonicalDeviceID.test(deviceID) || !validPageLimit(limit) ||
        !Number.isSafeInteger(afterSourceID) || afterSourceID < 0) {
        throw new Error('Invalid owner folder device or page cursor')
      }
      return request<XDriveDeviceBackupFolderPage>(
        '/v1/device-backup-folders?device_id=' + deviceID + '&limit=' + limit +
          (afterSourceID > 0 ? '&after_source_id=' + afterSourceID : ''))
    },
    ownerRuns: (sourceID, limit, offset) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 - limit) {
        throw new Error('Invalid owner history page selector')
      }
      return request<XDriveDeviceBackupRunPage>(
        '/v1/device-backup-runs' + sourceQuery(sourceID) +
          '&limit=' + limit + '&offset=' + offset,
      )
    },
    run: sourceID => request<XDriveLocalBackupCommonBatch>('/v1/run' + sourceQuery(sourceID), 'POST'),
    inspect: (sourceID, signal) => request<XDriveLocalBackupCommonBatch>(
      '/v1/status' + sourceQuery(sourceID), 'GET', undefined, signal),
    history: (sourceID, signal) => request<XDriveLocalBackupCommonBatchHistoryPage>(
      '/v1/history' + sourceQuery(sourceID), 'GET', undefined, signal),
    // Read-only historical SQL receipt diagnosis already implemented by the
    // original Agent and the shared Device Backup dialog. Never restart a
    // writer, expose local paths or claim current CAS physical integrity.
    async review(sourceID, afterFile, pageEpoch, requestID) {
      if (!Number.isSafeInteger(afterFile) || afterFile < 0 || afterFile > 1_000_000 ||
        (afterFile === 0 && pageEpoch !== '') ||
        (afterFile > 0 && !/^[0-9a-f]{64}$/.test(pageEpoch)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestID) ||
        recoveryReads.has(requestID) || recoveryReads.size >= 4) {
        throw new Error('Invalid DSM historical review selector')
      }
      const selector = sourceQuery(sourceID) +
        (afterFile > 0 ? '&after_file=' + afterFile + '&page_epoch=' + pageEpoch : '')
      const controller = new AbortController()
      recoveryReads.set(requestID, controller)
      try {
        const page = await request<unknown>(
          '/v1/recovery-review' + selector, 'GET', undefined, controller.signal)
        // This optional diagnostics module is only needed when the user
        // requests historical review. Keep ordinary DSM Host startup free of
        // a runtime module dependency (also exercised by existing VM tests).
        const { xDriveValidateSynologyRecoveryReview } = await import('./synology-recovery-review')
        return xDriveValidateSynologyRecoveryReview(page, sourceID, afterFile, pageEpoch)
      } finally {
        if (recoveryReads.get(requestID) === controller) recoveryReads.delete(requestID)
      }
    },
    async cancelReview(requestID) {
      // Detach only this browser observer. Never issue a new Agent mutation
      // or assume a historical Server Operation was physically cancelled.
      recoveryReads.get(requestID)?.abort()
      recoveryReads.delete(requestID)
    },
    // The original owning Agent remains authoritative for Source identity,
    // the optimistic revision and all schedule semantics. No NAS scheduler.
    load: sourceID => request<XDriveLocalBoundBackupSchedule>(
      '/v1/schedule' + sourceQuery(sourceID)),
    save: (sourceID, revision, schedule) => {
      if (!Number.isSafeInteger(revision) || revision < 1 ||
        !['manual', 'interval', 'cron'].includes(schedule.schedule_type) ||
        typeof schedule.schedule_expression !== 'string' ||
        typeof schedule.schedule_timezone !== 'string' ||
        new TextEncoder().encode(schedule.schedule_expression).length > 256 ||
        new TextEncoder().encode(schedule.schedule_timezone).length > 128) {
        throw new Error('Invalid local backup schedule revision or values')
      }
      return request<XDriveLocalBoundBackupSchedule>(
        '/v1/schedule' + sourceQuery(sourceID), 'POST',
        { revision, ...schedule })
    },
    control: (sourceID, action) => {
      if (action !== 'pause' && action !== 'cancel') throw new Error('Unsupported control')
      return request<XDriveLocalBackupCommonBatch>('/v1/control' + sourceQuery(sourceID) + '&action=' + action, 'POST')
    },
    }
  return api
}


/** Only this narrow view reaches the native Remote B-scope presenter.
 * No CRUD, Server login, credential field or cross-device mutation can be
 * injected via the DSM authenticated Agent transport.
 */
export function createXDriveSynologyOwnerBackupSource(
  client: XDriveSynologyBackupLocalClient,
): XDriveDeviceBackupDataSource {
  return {
    list: () => client.ownerDevices(),
    listPage: (limit, afterDeviceID) => client.ownerDevicesPage(limit, afterDeviceID),
    foldersPage: (deviceID, limit, afterSourceID) =>
      client.ownerFoldersPage(deviceID, limit, afterSourceID),
    runs: (sourceID, limit, offset) => client.ownerRuns(sourceID, limit, offset),
  }
}


/** Canonical cloud-storage PAGE data port, not a second NAS implementation.
 * Server Owner quota comes from the installed Backup-only Agent's original
 * authenticated session. File-distribution stats are deliberately unavailable
 * until an independent Owner-scoped read capability is implemented.
 */
export function createXDriveSynologyCloudStorageDataSource(
  client: XDriveSynologyBackupLocalClient,
): XDriveCloudStorageDataSource {
  return {
    load: async (signal) => ({
      quota: await client.ownerQuota(signal),
      statsUnavailableMessage: '当前 NAS 仅读取 xDrive Server 账号配额。文件分布与 CAS 统计尚未接通，NAS 磁盘容量不在此范围。',
    }),
  }
}
