import type { XDriveDiagnosticReport } from './mui/DiagnosticsPage'
import type { XDriveFileTextPreview } from './file-preview'
import type { QuotaUsage } from './models'
import type { XDriveCloudStorageDataSource } from './mui/CloudStoragePage'
import type {
  XDriveDeviceBackupOverview, XDriveDeviceBackupRunPage,
  XDriveDeviceBackupFolderPage, XDriveDeviceBackupDataSource,
} from './device-backups'
import type { XDriveLocalBackupCommonBatchActions } from './mui/DeviceBackupLocalCommonBatchDialog'
import type { XDriveLocalBackupScheduleActions } from './mui/DeviceBackupLocalScheduleDialog'
import type { XDriveLocalBackupCommonBatch, XDriveLocalBackupCommonBatchHistoryPage, XDriveLocalBoundBackupSchedule } from './device-backups'

export type XDriveSynologyLocalSource = { source_id: number; name: string }

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

export type XDriveSynologyOwnerStreamMIME =
  | 'video/mp4' | 'video/webm'
  | 'audio/mpeg' | 'audio/mp4' | 'audio/ogg' | 'audio/wav' | 'audio/flac'

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


export interface XDriveSynologyBackupLocalClient extends XDriveLocalBackupCommonBatchActions, XDriveLocalBackupScheduleActions {
  list(signal?: AbortSignal): Promise<XDriveSynologyLocalSource[]>
  diagnostics(signal?: AbortSignal): Promise<XDriveDiagnosticReport>
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
  /** Strict bounded JSON text read, not arbitrary binary or signed content URL. */
  ownerFileTextPreview(nodeID: number, signal?: AbortSignal): Promise<XDriveFileTextPreview>
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
      'device-backup-page', 'device-backup-folders', 'cloud-quota',
      'cloud-root', 'cloud-children', 'cloud-text-preview', 'cloud-media-range'].includes(operation)) {
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
