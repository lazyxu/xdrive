import type {
  AdminUser,
  AuditEvent,
  AuditEventRange,
  CreateExternalSourceInput,
  CreatedFileShare,
  ExternalSource,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceCredentialStatus,
  ExternalSourceCredentialReveal,
  ExternalSourceCredentialTestResult,
  ExternalSourceConnectorConfig,
  ExternalSourceBrowsePage,
  ExternalSourceItem,
  ExternalSourceOverview,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  FileShare,
  BuildInfo,
  FileVersion,
  MeResult,
  MediaAlbum,
  MediaAlbumFolder,
  MediaGalleryFacets,
  MediaGalleryIndexStatus,
  NodeLocation,
  MediaGalleryQuery,
  MediaSyncFolder,
  MediaFolderView,
  MediaItem,
  MediaItemRange,
  MediaMemory,
  MediaDuplicateGroupList,
  MediaDuplicateOrganizePlan,
  MediaBurstReviewList,
  MediaEditRecipe,
  MediaEditRecipeInput,
  MediaCreativeGeneration,
  MediaCreativeInput,
  MediaPetFacet,
  MediaPersonSuggestionReview,
  MediaPersonIdentity,
  MediaPersonSplit,
  MediaPlaceFacet,
  MediaSuggestedPerson,
  UpdateMediaPersonIdentityInput,
  Node,
  PublicShare,
  QuotaUsage,
  StorageHealth,
  StorageHistory,
  StorageLegacyObjectPage,
  StorageUnreferencedBlobPage,
  StorageStats,
  StorageCacheCleanup,
  StorageCacheCleanupKind,
  StagingCleanupFailure,
  StagingCleanupRun,
  UploadStagingCleanup,
  UploadStagingDetail,
  UpdateExternalSourceInput,
  XDriveServerUpdateChannel,
  XDriveServerUpdateSource,
  XDriveServerUpdateState,
  XDriveTransferTask,
  XDriveBackgroundTask,
  XDriveBackgroundTaskActiveSummary,
  XDriveBackgroundTaskControlAction,
  XDriveBackgroundTaskControlResult,
  XDriveBackgroundTaskPage,
  XDriveFileOperation,
  XDriveFileExplorerPropertiesStats,
  XDriveFileExplorerMediaDetails,
  XDriveFileExplorerMediaDetailsRef,
  XDriveFileExplorerSearchFilters,
  XDriveFileExplorerGrouping,
  XDriveFileTextPreview,
  XDriveCloudFilesPage,
  XDriveCloudFilesPageOptions,
  XDriveCloudFilesRange,
  XDriveCloudFilesChangePage,
  XDriveCloudFilesSearchRange,
  XDriveFileOperationType,
  XDriveFileQuickAccessItem,
  XDriveFileTag,
  XDriveFileNodeTags,
  XDriveFileSavedSearch,
  XDriveFileSavedSearchInput,
  XDriveFileFavoriteItem,
  XDriveFileRecentItem,
  XDriveUploadConflictPolicy,
  XDriveUploadConflictPreflight,
} from '../../ui/shared/src'
import { webTransferStore } from './transfers'
import {
  xDriveAbortWebDownloadSink,
  xDriveCreateWebDownloadProgressReporter,
  xDriveOpenWebDownloadSink,
  xDriveStartBrowserDownload,
  xDriveWriteWebDownloadToSink,
} from './downloadSink'
import type { XDriveWebActiveDownloadSink } from './downloadSink'
import { xDriveTransferAbortError, xDriveUploadBytes, xDriveWaitForTransferPoll } from './transferTransport'

export type {
  XDriveUploadConflictPolicy,
  XDriveUploadConflictPreflight,
  ExternalSource,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceCredentialStatus,
  ExternalSourceCredentialReveal,
  ExternalSourceConnectorConfig,
  ExternalSourceItem,
  ExternalSourceOverview,
  ExternalSourceRun,
  ExternalSourceRunFailure,
} from '../../ui/shared/src'

export type { BuildInfo }

export interface AuthResult {
  token: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  refresh_expires_in: number
  username: string
  role: 'user' | 'admin'
  must_change_password: boolean
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
}

export interface SearchBreadcrumb {
  id: number
  name: string
}

export interface SearchResult {
  node: Node
  path: string
  breadcrumbs: SearchBreadcrumb[]
}

export interface SearchPage {
  items: SearchResult[]
  next_cursor?: string
}

export interface BatchNodeRef {
  id: number
  revision: number
}

export interface BatchNodesResult {
  operation_id: string
  items?: Node[]
  deleted_ids?: number[]
}

export interface UploadChunkState {
  index: number
  size: number
  sha256: string
  reused?: boolean
}

export interface XDriveUploadResult {
  node: Node
  skipped: boolean
  transferred_bytes: number
}

export interface UploadSessionState {
  id: string
  parent_id?: number
  node_id?: number
  name?: string
  requested_name?: string
  conflict_policy?: XDriveUploadConflictPolicy
  size: number
  chunk_size: number
  chunk_count: number
  sha256?: string
  resume_key?: string
  expected_revision?: number
  status: 'active' | 'finalized' | 'skipped'
  expires_at: string
  received_chunks: UploadChunkState[]
  result?: Node
}

type AuthenticatedDownloadTicket = {
  url: string
  expires_at: string
  transfer_id?: string
}

type NativeDownloadProgress = {
  transfer_id: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  bytes_sent: number
  bytes_total: number
  updated_at: string
  error?: string
}

type ArchiveDownloadPrepareFile = {
  path: string
  size: number
}

type ArchiveDownloadPrepare = {
  transfer_id: string
  state: 'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed'
  filename?: string
  total_bytes?: number
  files?: ArchiveDownloadPrepareFile[]
  error?: string
}

type ArchiveDownloadProgressFile = {
  path: string
  size: number
  done: number
  state: 'queued' | 'transferring' | 'completed' | 'failed' | 'cancelled'
  error?: string
}

type ArchiveDownloadProgress = {
  transfer_id: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  bytes_done: number
  bytes_total: number
  items_total: number
  items_completed: number
  items_failed: number
  items_running: number
  items_queued: number
  files: ArchiveDownloadProgressFile[]
}

export class ApiError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.status = status
    this.detail = detail?.trim() || undefined
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''


function appendMediaGalleryQuery(
  values: URLSearchParams,
  query: MediaGalleryQuery = {},
) {
  if (Number.isSafeInteger(query.anchor_node_id) && (query.anchor_node_id ?? 0) > 0) {
    values.set('anchor_node_id', String(query.anchor_node_id))
  }
  if (query.fold_duplicates) values.set('fold_duplicates', 'true')
  for (const id of query.fold_member_ids ?? []) {
    if (Number.isSafeInteger(id) && id > 0) values.append('fold_member_id', String(id))
  }
  if (query.time_zone) values.set('time_zone', query.time_zone)
  if (query.sort_by) values.set('sort_by', query.sort_by)
  if (query.sort_dir) values.set('sort_dir', query.sort_dir)
  if (query.search?.trim()) values.set('q', query.search.trim())
  if (query.asset_kind) values.set('asset_kind', query.asset_kind)
  if (query.category?.trim()) values.set('category', query.category.trim())
  for (const camera of query.cameras ?? []) {
    if (camera.trim()) values.append('camera', camera.trim())
  }
  for (const format of query.formats ?? []) {
    if (format.trim()) values.append('format', format.trim())
  }
  if (query.folder_id && Number.isSafeInteger(query.folder_id) && query.folder_id > 0) {
    values.set('folder_id', String(query.folder_id))
  }
  if (query.captured_from) values.set('captured_from', query.captured_from)
  if (query.captured_to) values.set('captured_to', query.captured_to)
  if (query.has_location !== undefined) {
    values.set('has_location', String(query.has_location))
  }
  if (query.favorite !== undefined) {
    values.set('favorite', String(query.favorite))
  }
  if (query.tag?.trim()) values.set('tag', query.tag.trim())
  if (query.person?.trim()) values.set('person', query.person.trim())
  if (query.person_identity?.trim()) {
    values.set('person_identity', query.person_identity.trim())
  }
  if (query.place?.trim()) values.set('place', query.place.trim())
}

export function sessionFromAuth(result: AuthResult): AuthSession {
  return {
    accessToken: result.access_token || result.token,
    refreshToken: result.refresh_token,
    accessExpiresAt: Date.now() + Math.max(0, result.expires_in) * 1000,
  }
}

function appendFileExplorerGrouping(
  params: URLSearchParams,
  grouping: XDriveFileExplorerGrouping | undefined,
) {
  if (!grouping) return
  if (grouping.groupBy !== 'none') params.set('group', grouping.groupBy)
  if (!grouping.foldersFirst) params.set('folders_first', 'false')
}

function appendFileExplorerSearchFilters(
  params: URLSearchParams,
  filters: XDriveFileExplorerSearchFilters = {},
) {
  if (filters.kind) params.set('kind', filters.kind)
  if (filters.modifiedFrom) params.set('modified_from', filters.modifiedFrom)
  if (filters.modifiedTo) params.set('modified_to', filters.modifiedTo)
  if (filters.minSize !== undefined) params.set('min_size', String(Math.max(0, Math.trunc(filters.minSize))))
  if (filters.maxSize !== undefined) params.set('max_size', String(Math.max(0, Math.trunc(filters.maxSize))))
  if (filters.sourceID) params.set('source_id', String(Math.max(1, Math.trunc(filters.sourceID))))
  if (filters.tagID) params.set('tag_id', String(Math.max(1, Math.trunc(filters.tagID))))
}

const transferSession = {
  key: '',
  api: null as XDriveApi | null,
  controller: new AbortController(),
}

export class XDriveApi {
  private session: AuthSession
  private readonly onSession?: (session: AuthSession) => void
  private refreshPromise: Promise<void> | null = null
  private transferSessionKey?: string
  private transferSessionController?: AbortController
  private transferSessionEpoch = 0

  constructor(session?: Partial<AuthSession>, onSession?: (session: AuthSession) => void) {
    this.session = {
      accessToken: session?.accessToken ?? '',
      refreshToken: session?.refreshToken ?? '',
      accessExpiresAt: session?.accessExpiresAt ?? 0,
    }
    this.onSession = onSession
  }

  setTransferSessionKey(key: string) {
    if (transferSession.key !== key) {
      transferSession.controller.abort()
      transferSession.controller = new AbortController()
      transferSession.key = key
      webTransferStore.setSessionKey(key)
    }
    if (this.transferSessionController && this.transferSessionController !== transferSession.controller) {
      this.transferSessionEpoch += 1
    }
    this.transferSessionKey = key
    this.transferSessionController = transferSession.controller
    transferSession.api = this
  }

  disposeTransfers() {
    if (transferSession.api && transferSession.api !== this) return
    transferSession.controller.abort()
    transferSession.controller = new AbortController()
    transferSession.api = null
    transferSession.key = ''
    webTransferStore.setSessionKey('')
  }

  private transferContext() {
    if (this.transferSessionKey !== undefined && (
      this.transferSessionKey !== transferSession.key ||
      this.transferSessionController !== transferSession.controller
    )) {
      throw xDriveTransferAbortError()
    }
    const signal = transferSession.controller.signal
    const check = () => { if (signal.aborted) throw xDriveTransferAbortError() }
    return {
      signal,
      check,
      api: () => { check(); return transferSession.api ?? this },
    }
  }

  transfers() {
    return webTransferStore.snapshot()
  }

  onTransfers(listener: (items: XDriveTransferTask[]) => void) {
    return webTransferStore.subscribe(listener)
  }

  clearTransferHistory(scope: 'all' | 'network' | 'local' = 'all') {
    webTransferStore.clearHistory(scope)
  }

  startTransferGroup(input: {
    fileName: string
    path?: string
    bytesTotal: number
    itemsTotal: number
    kind?: 'upload' | 'download'
    direction?: 'upload' | 'download'
    speedSource?: 'client' | 'server'
  }) {
    return webTransferStore.startGroup({ ...input, speedSource: input.speedSource ?? 'client' })
  }

  startTransferChild(groupID: string, input: {
    fileName: string
    relativePath: string
    bytesTotal: number
  }) {
    return webTransferStore.startChild(groupID, input)
  }

  startTransferChildren(groupID: string, inputs: readonly {
    fileName: string
    relativePath: string
    bytesTotal: number
  }[]) {
    return webTransferStore.startChildren(groupID, inputs)
  }

  beginTransfer(id: string) {
    webTransferStore.begin(id)
  }

  progressTransfer(id: string, bytesDone: number, bytesTotal: number) {
    webTransferStore.progress(id, bytesDone, bytesTotal)
  }

  updateTransferGroup(id: string, progress: {
    scanComplete: boolean
    bytesDone: number
    bytesTotal: number
    itemsTotal: number
    itemsCompleted: number
    itemsFailed: number
    itemsRunning: number
    itemsQueued: number
  }) {
    webTransferStore.updateGroup(id, progress)
  }

  finishTransfer(id: string, input: {
    state: 'completed' | 'partial' | 'failed' | 'cancelled'
    error?: string
    skipped?: boolean
  }) {
    webTransferStore.finishLifecycle(id, input)
  }

  batchTransferUpdates<T>(run: () => T) {
    return webTransferStore.batchUpdates(run)
  }

  clearFileOperationHistory() {
    return this.request<void>('/api/v1/file-operations', {
      method: 'DELETE',
    })
  }

  private setSession(session: AuthSession) {
    this.session = session
    this.onSession?.(session)
  }

  private async refresh(force = false, signal?: AbortSignal | null) {
    if (!this.session.refreshToken) throw new ApiError(401, 'Session expired')
    if (!force && this.session.accessExpiresAt > Date.now() + 120_000) return
    if (this.refreshPromise) return this.refreshPromise

    const sessionController = this.transferSessionController
    const sessionEpoch = this.transferSessionEpoch
    this.refreshPromise = (async () => {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.session.refreshToken }),
        signal,
      })
      if (!response.ok) {
        let message = 'Session expired'
        try {
          const body = (await response.json()) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // Keep generic message.
        }
        throw new ApiError(response.status, message)
      }
      const result = (await response.json()) as AuthResult
      // A child effect can start this refresh before App registers its session.
      // Check the later registration too; a re-bound API must not revive work
      // from the lifecycle it disposed, even when the account name is unchanged.
      if (
        signal?.aborted || sessionController?.signal.aborted ||
        this.transferSessionController?.signal.aborted ||
        this.transferSessionEpoch !== sessionEpoch
      ) throw xDriveTransferAbortError()
      this.setSession(sessionFromAuth(result))
    })()

    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async ensureFresh(signal?: AbortSignal | null) {
    if (signal?.aborted) throw xDriveTransferAbortError()
    if (this.session.refreshToken && this.session.accessExpiresAt > 0 && this.session.accessExpiresAt <= Date.now() + 120_000) {
      await this.refresh(false, signal)
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    await this.ensureFresh(init.signal)
    if (init.signal?.aborted) throw xDriveTransferAbortError()
    const headers = new Headers(init.headers)
    if (this.session.accessToken) headers.set('Authorization', `Bearer ${this.session.accessToken}`)
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    let response = await fetch(`${API_BASE}${path}`, { ...init, headers })
    if (response.status === 401 && retry && this.session.refreshToken) {
      await this.refresh(true, init.signal)
      if (init.signal?.aborted) throw xDriveTransferAbortError()
      const retryHeaders = new Headers(init.headers)
      if (this.session.accessToken) retryHeaders.set('Authorization', `Bearer ${this.session.accessToken}`)
      if (init.body && !(init.body instanceof FormData) && !retryHeaders.has('Content-Type')) {
        retryHeaders.set('Content-Type', 'application/json')
      }
      response = await fetch(`${API_BASE}${path}`, { ...init, headers: retryHeaders })
    }
    if (!response.ok) {
      let message = response.statusText || 'Request failed'
      let detail = ''
      try {
        const body = (await response.json()) as { error?: string; detail?: string }
        if (body.error) message = body.error
        if (body.detail) detail = body.detail
      } catch {
        // Keep the HTTP status text when the response is not JSON.
      }
      throw new ApiError(response.status, message, detail)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  async serverVersion() {
    const response = await fetch(`${API_BASE}/api/v1/version`, { cache: 'no-store' })
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText || 'Server version unavailable')
    }
    return response.json() as Promise<BuildInfo>
  }

  login(username: string, password: string) {
    return this.request<AuthResult>('/api/v1/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }, false)
  }

  async logout() {
    if (!this.session.refreshToken) return
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.session.refreshToken }),
    })
  }

  me() {
    return this.request<MeResult>('/api/v1/me')
  }

  quota() {
    return this.request<QuotaUsage>('/api/v1/me/quota')
  }

  storageStats() {
    return this.request<StorageStats>('/api/v1/me/storage')
  }

  adminStorageStats() {
    return this.request<StorageStats>('/api/v1/admin/storage')
  }

  adminCleanupStorageCache(kind: StorageCacheCleanupKind) {
    return this.request<StorageCacheCleanup>('/api/v1/admin/storage/cache/cleanup', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    })
  }

  adminServerUpdate() {
    return this.request<XDriveServerUpdateState>('/api/v1/admin/update')
  }

  adminStartServerUpdate(source: XDriveServerUpdateSource, channel: XDriveServerUpdateChannel, backupFileData: boolean) {
    return this.request<XDriveServerUpdateState>('/api/v1/admin/update', {
      method: 'POST',
      body: JSON.stringify({ source, channel, backup_file_data: backupFileData }),
    })
  }

  adminStorageHealth() {
    return this.request<StorageHealth>('/api/v1/admin/storage/health')
  }

  adminStorageHistory(days = 30) {
    return this.request<StorageHistory>(`/api/v1/admin/storage/history?days=${days}`)
  }

  adminStorageLegacyObjects(limit = 20, cursor = '') {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
    })
    if (cursor) query.set('cursor', cursor)
    return this.request<StorageLegacyObjectPage>(`/api/v1/admin/storage/legacy?${query.toString()}`)
  }

  adminStorageUnreferencedBlobs(limit = 20, cursor = '') {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
    })
    if (cursor) query.set('cursor', cursor)
    return this.request<StorageUnreferencedBlobPage>(`/api/v1/admin/storage/unreferenced-blobs?${query.toString()}`)
  }

  adminUploadStaging(limit = 50, cursor = '', fresh = false) {
    const query = new URLSearchParams({
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
    })
    if (cursor) query.set('cursor', cursor)
    if (fresh) query.set('fresh', '1')
    return this.request<UploadStagingDetail>(`/api/v1/admin/storage/staging?${query.toString()}`)
  }

  adminStagingCleanupRuns(limit = 20, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<StagingCleanupRun[]>(`/api/v1/admin/storage/staging/cleanup-runs?${query.toString()}`)
  }

  adminStagingCleanupFailures(runID: number, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<StagingCleanupFailure[]>(`/api/v1/admin/storage/staging/cleanup-runs/${runID}/failures?${query.toString()}`)
  }

  adminCleanupUploadStaging() {
    return this.request<UploadStagingCleanup>('/api/v1/admin/storage/staging/cleanup', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const result = await this.request<AuthResult>('/api/v1/me/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    })
    this.setSession(sessionFromAuth(result))
    return result
  }

  adminUsers() {
    return this.request<AdminUser[]>('/api/v1/admin/users')
  }

  adminAudit(params: {
    limit?: number
    before_id?: number
    action?: string
    result?: 'success' | 'failure'
    actor?: string
  } = {}) {
    const query = new URLSearchParams()
    if (params.limit) query.set('limit', String(params.limit))
    if (params.before_id) query.set('before_id', String(params.before_id))
    if (params.action) query.set('action', params.action)
    if (params.result) query.set('result', params.result)
    if (params.actor) query.set('actor', params.actor)
    const suffix = query.toString()
    return this.request<AuditEvent[]>(`/api/v1/admin/audit${suffix ? `?${suffix}` : ''}`)
  }

  adminAuditRange(params: {
    limit: number
    offset: number
    snapshot_max_id?: number
    action?: string
    result?: 'success' | 'failure'
    actor?: string
  }, signal?: AbortSignal) {
    const query = new URLSearchParams()
    query.set('range', 'true')
    query.set('limit', String(params.limit))
    query.set('offset', String(params.offset))
    if (params.snapshot_max_id !== undefined) {
      query.set('snapshot_max_id', String(params.snapshot_max_id))
    }
    if (params.action) query.set('action', params.action)
    if (params.result) query.set('result', params.result)
    if (params.actor) query.set('actor', params.actor)
    return this.request<AuditEventRange>(`/api/v1/admin/audit?${query.toString()}`, { signal })
  }

  adminCreateUser(input: { username: string; password: string; role: 'user' | 'admin'; must_change_password: boolean; quota_bytes: number }) {
    return this.request<AdminUser>('/api/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  adminUpdateUser(id: number, input: { role?: 'user' | 'admin'; disabled?: boolean; quota_bytes?: number }) {
    return this.request<AdminUser>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  adminResetPassword(id: number, password: string, mustChangePassword = true) {
    return this.request<void>(`/api/v1/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password, must_change_password: mustChangePassword }),
    })
  }

  adminRevokeSessions(id: number) {
    return this.request<void>(`/api/v1/admin/users/${id}/revoke-sessions`, { method: 'POST' })
  }

  adminDeleteUser(id: number) {
    return this.request<void>(`/api/v1/admin/users/${id}`, { method: 'DELETE' })
  }

  mediaItem(nodeID: number, signal?: AbortSignal) {
    return this.request<MediaItem>(`/api/v1/media/items/${nodeID}`, { signal })
  }

  nodeLocation(nodeID: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(nodeID) || nodeID <= 0) {
      return Promise.reject(new Error('Invalid Node ID'))
    }
    return this.request<NodeLocation>(`/api/v1/nodes/${nodeID}/location`, { signal })
  }

  mediaItems(
    kind = '',
    limit = 100,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    if (kind) query.set('kind', kind)
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItem[]>(`/api/v1/media/items?${query.toString()}`)
  }
  mediaItemRange(
    kind = '',
    limit = 200,
    offset = 0,
    filters: MediaGalleryQuery = {},
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    if (kind) query.set('kind', kind)
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItemRange>(`/api/v1/media/items?${query.toString()}`, { signal })
  }



  mediaFacets(filters: MediaGalleryQuery = {}, albumID = '') {
    const query = new URLSearchParams()
    appendMediaGalleryQuery(query, filters)
    if (albumID.trim()) query.set('album', albumID.trim())
    const encoded = query.toString()
    return this.request<MediaGalleryFacets>(
      `/api/v1/media/facets${encoded ? `?${encoded}` : ''}`,
    )
  }

  mediaIndexStatus() {
    return this.request<MediaGalleryIndexStatus>('/api/v1/media/index-status')
  }

  mediaSyncFolders() {
    return this.request<MediaSyncFolder[]>('/api/v1/media/sync-folders')
  }

  mediaSyncFolder(sourceID: number, folderID: number) {
    return this.request<MediaFolderView>(
      `/api/v1/media/sync-folders/${sourceID}/folders/${folderID}`,
    )
  }

  mediaTrashRange(limit = 200, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaItemRange>(`/api/v1/media/trash?${query.toString()}`)
  }

  mediaAlbums() {
    return this.request<MediaAlbum[]>('/api/v1/media/albums')
  }

  mediaAlbumFolders() {
    return this.request<MediaAlbumFolder[]>('/api/v1/media/album-folders')
  }

  createMediaAlbumFolder(name: string, parentID: number) {
    return this.request<MediaAlbumFolder>('/api/v1/media/album-folders', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentID }),
    })
  }

  updateMediaAlbumFolder(
    folderID: number,
    revision: number,
    change: { name?: string; parent_id?: number },
  ) {
    return this.request<MediaAlbumFolder>(`/api/v1/media/album-folders/${folderID}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify(change),
    })
  }

  deleteMediaAlbumFolder(folderID: number, revision: number) {
    return this.request<void>(`/api/v1/media/album-folders/${folderID}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${revision}"` },
    })
  }

  moveMediaAlbumToFolder(albumID: string, revision: number, folderID: number) {
    return this.request<MediaAlbum>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/folder`, {
        method: 'PATCH',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ folder_id: folderID }),
      },
    )
  }

  mediaPlaces(limit = 24) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
    })
    return this.request<MediaPlaceFacet[]>(`/api/v1/media/places?${query.toString()}`)
  }

  mediaMemories(anchorDate = '', limit = 24, timeZone = 'UTC') {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
      time_zone: timeZone,
    })
    if (anchorDate.trim()) query.set('anchor_date', anchorDate.trim())
    return this.request<MediaMemory[]>(
      `/api/v1/media/memories?${query.toString()}`,
    )
  }

  mediaMemoryItemRange(
    memoryID: string,
    limit = 200,
    offset = 0,
    timeZone = 'UTC',
  ) {
    const query = new URLSearchParams({
      time_zone: timeZone,
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaItemRange>(
      `/api/v1/media/memories/${encodeURIComponent(memoryID)}/items?${query.toString()}`,
    )
  }

  mediaDuplicateOrganizePlan(keeperNodeID: number, nodeIDs: number[]) {
    const query = new URLSearchParams({ keeper_id: String(keeperNodeID) })
    for (const nodeID of nodeIDs) query.append('node_id', String(nodeID))
    return this.request<MediaDuplicateOrganizePlan>(
      `/api/v1/media/duplicate-organize/plan?${query.toString()}`,
    )
  }

  mediaDuplicateGroups(limit = 24, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaDuplicateGroupList>(
      `/api/v1/media/duplicates?${query.toString()}`,
    )
  }

  mediaDuplicateItemRange(
    duplicateID: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaItemRange>(
      `/api/v1/media/duplicates/${encodeURIComponent(duplicateID)}/items?${query.toString()}`,
    )
  }

  mediaBurstReviews(limit = 24, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaBurstReviewList>(
      `/api/v1/media/bursts?${query.toString()}`,
    )
  }

  mediaBurstReviewItemRange(
    burstID: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaItemRange>(
      `/api/v1/media/bursts/${encodeURIComponent(burstID)}/items?${query.toString()}`,
    )
  }

  mediaPets() {
    return this.request<MediaPetFacet[]>('/api/v1/media/pets')
  }

  mediaPetItemRange(
    petKind: string,
    limit = 200,
    offset = 0,
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaItemRange>(
      `/api/v1/media/pets/${encodeURIComponent(petKind)}/items?${query.toString()}`,
    )
  }

  mediaSuggestedPeople(limit = 24) {
    return this.mediaSuggestedPeopleWithReview(false, limit)
  }

  mediaSuggestedPeopleWithReview(includeReviewed = false, limit = 24) {
    const query = new URLSearchParams({
      include_reviewed: String(includeReviewed),
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
    })
    return this.request<MediaSuggestedPerson[]>(
      `/api/v1/media/people/suggestions?${query.toString()}`,
    )
  }

  mediaSuggestedPersonItems(
    personID: string,
    limit = 100,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItem[]>(
      `/api/v1/media/people/suggestions/${encodeURIComponent(personID)}/items?${query.toString()}`,
    )
  }
  mediaSuggestedPersonItemRange(
    personID: string,
    limit = 200,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItemRange>(
      `/api/v1/media/people/suggestions/${encodeURIComponent(personID)}/items?${query.toString()}`,
    )
  }



  reviewMediaSuggestedPerson(
    suggestionID: string,
    state: 'pending' | 'dismissed',
  ) {
    return this.request<MediaPersonSuggestionReview>(
      `/api/v1/media/people/suggestions/${encodeURIComponent(suggestionID)}/review`,
      {
        method: 'PATCH',
        body: JSON.stringify({ state }),
      },
    )
  }

  addMediaSuggestedPersonToPerson(
    suggestionID: string,
    personID: string,
    revision: number,
  ) {
    return this.request<MediaPersonIdentity>(
      `/api/v1/media/people/identities/${encodeURIComponent(personID)}/suggestions/${encodeURIComponent(suggestionID)}`,
      {
        method: 'POST',
        headers: { 'If-Match': `"${revision}"` },
      },
    )
  }

  mediaPeople(includeHidden = false, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    if (includeHidden) query.set('include_hidden', 'true')
    return this.request<MediaPersonIdentity[]>(
      `/api/v1/media/people/identities?${query.toString()}`,
    )
  }

  mediaPersonItems(
    personID: string,
    limit = 100,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItem[]>(
      `/api/v1/media/people/identities/${encodeURIComponent(personID)}/items?${query.toString()}`,
    )
  }
  mediaPersonItemRange(
    personID: string,
    limit = 200,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItemRange>(
      `/api/v1/media/people/identities/${encodeURIComponent(personID)}/items?${query.toString()}`,
    )
  }



  adoptMediaSuggestedPerson(suggestionID: string, name: string) {
    return this.request<MediaPersonIdentity>(
      `/api/v1/media/people/suggestions/${encodeURIComponent(suggestionID)}/adopt`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
    )
  }

  updateMediaPerson(
    personID: string,
    revision: number,
    input: UpdateMediaPersonIdentityInput,
  ) {
    return this.request<MediaPersonIdentity>(
      `/api/v1/media/people/identities/${encodeURIComponent(personID)}`,
      {
        method: 'PATCH',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify(input),
      },
    )
  }

  mergeMediaPeople(targetID: string, revision: number, sourceIDs: string[]) {
    return this.request<MediaPersonIdentity>(
      `/api/v1/media/people/identities/${encodeURIComponent(targetID)}/merge`,
      {
        method: 'POST',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ source_ids: sourceIDs }),
      },
    )
  }

  splitMediaPerson(
    personID: string,
    revision: number,
    nodeIDs: number[],
    name: string,
  ) {
    return this.request<MediaPersonSplit>(
      `/api/v1/media/people/identities/${encodeURIComponent(personID)}/split`,
      {
        method: 'POST',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ node_ids: nodeIDs, name }),
      },
    )
  }

  createMediaAlbum(name: string) {
    return this.request<MediaAlbum>('/api/v1/media/albums', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  renameMediaAlbum(albumID: string, revision: number, name: string) {
    return this.request<MediaAlbum>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}`,
      {
        method: 'PATCH',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ name }),
      },
    )
  }

  setMediaAlbumCover(albumID: string, revision: number, nodeID: number) {
    return this.request<MediaAlbum>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/cover`,
      {
        method: 'PUT',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ node_id: nodeID }),
      },
    )
  }

  deleteMediaAlbum(albumID: string, revision: number) {
    return this.request<void>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}`,
      {
        method: 'DELETE',
        headers: { 'If-Match': `"${revision}"` },
      },
    )
  }

  addMediaAlbumItems(albumID: string, revision: number, nodeIDs: number[]) {
    return this.request<MediaAlbum>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/items`,
      {
        method: 'POST',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify({ node_ids: nodeIDs }),
      },
    )
  }

  removeMediaAlbumItem(albumID: string, revision: number, nodeID: number) {
    return this.request<MediaAlbum>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/items/${nodeID}`,
      {
        method: 'DELETE',
        headers: { 'If-Match': `"${revision}"` },
      },
    )
  }

  createSmartMediaAlbum(name: string, query: MediaGalleryQuery) {
    return this.request<MediaAlbum>('/api/v1/media/smart-albums', {
      method: 'POST',
      body: JSON.stringify({ name, query }),
    })
  }

  updateSmartMediaAlbum(
    albumID: string,
    revision: number,
    input: { name?: string; query?: MediaGalleryQuery },
  ) {
    return this.request<MediaAlbum>(
      `/api/v1/media/smart-albums/${encodeURIComponent(albumID)}`,
      {
        method: 'PATCH',
        headers: { 'If-Match': `"${revision}"` },
        body: JSON.stringify(input),
      },
    )
  }

  deleteSmartMediaAlbum(albumID: string, revision: number) {
    return this.request<void>(
      `/api/v1/media/smart-albums/${encodeURIComponent(albumID)}`,
      {
        method: 'DELETE',
        headers: { 'If-Match': `"${revision}"` },
      },
    )
  }

  mediaAlbumItems(
    albumID: string,
    limit = 100,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItem[]>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/items?${query.toString()}`,
    )
  }
  mediaAlbumItemRange(
    albumID: string,
    limit = 200,
    offset = 0,
    filters: MediaGalleryQuery = {},
  ) {
    const query = new URLSearchParams({
      range: 'true',
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    appendMediaGalleryQuery(query, filters)
    return this.request<MediaItemRange>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/items?${query.toString()}`,
    )
  }



  setMediaFavorite(nodeID: number, favorite: boolean) {
    return this.request<{ favorite: boolean }>(
      `/api/v1/media/items/${nodeID}/favorite`,
      {
        method: 'PATCH',
        body: JSON.stringify({ favorite }),
      },
    )
  }

  setMediaFavoriteBatch(nodeIDs: number[], favorite: boolean) {
    return this.request<{ updated: number; favorite: boolean }>(
      '/api/v1/media/batch/favorite',
      {
        method: 'PATCH',
        body: JSON.stringify({ node_ids: nodeIDs, favorite }),
      },
    )
  }

  addMediaTagsBatch(nodeIDs: number[], tags: string[]) {
    return this.request<{ updated: number; tags: string[] }>(
      '/api/v1/media/batch/tags',
      {
        method: 'POST',
        body: JSON.stringify({ node_ids: nodeIDs, tags }),
      },
    )
  }

  setMediaTags(nodeID: number, tags: string[]) {
    return this.request<{ tags: string[] }>(
      `/api/v1/media/items/${nodeID}/tags`,
      {
        method: 'PATCH',
        body: JSON.stringify({ tags }),
      },
    )
  }

  setMediaPeople(nodeID: number, people: string[]) {
    return this.request<{ people: string[] }>(
      `/api/v1/media/items/${nodeID}/people`,
      {
        method: 'PATCH',
        body: JSON.stringify({ people }),
      },
    )
  }

  setMediaDescription(nodeID: number, description: string) {
    return this.request<{ description: string }>(
      `/api/v1/media/items/${nodeID}/description`,
      {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      },
    )
  }

  mediaEditRecipe(nodeID: number) {
    return this.request<MediaEditRecipe>(
      `/api/v1/media/items/${nodeID}/edit`,
    )
  }

  saveMediaEditRecipe(nodeID: number, input: MediaEditRecipeInput) {
    return this.request<MediaEditRecipe>(
      `/api/v1/media/items/${nodeID}/edit`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    )
  }

  resetMediaEditRecipe(nodeID: number, revision: number) {
    return this.request<MediaEditRecipe>(
      `/api/v1/media/items/${nodeID}/edit?revision=${encodeURIComponent(String(revision))}`,
      { method: 'DELETE' },
    )
  }

  createMediaCreativeGeneration(
    nodeID: number,
    input: MediaCreativeInput,
  ) {
    return this.request<MediaCreativeGeneration>(
      `/api/v1/media/items/${nodeID}/creative`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    )
  }

  mediaCreativeGeneration(generationID: string) {
    return this.request<MediaCreativeGeneration>(
      `/api/v1/media/creative/${encodeURIComponent(generationID)}`,
    )
  }

  cancelMediaCreativeGeneration(generationID: string) {
    return this.request<MediaCreativeGeneration>(
      `/api/v1/media/creative/${encodeURIComponent(generationID)}/cancel`,
      { method: 'POST' },
    )
  }

  async mediaThumbnail(nodeID: number, signal?: AbortSignal): Promise<Blob> {
    await this.ensureFresh(signal)
    signal?.throwIfAborted()
    const path = `/api/v1/media/items/${nodeID}/thumbnail?v=3`
    let response = await fetch(`${API_BASE}${path}`, {
      headers: this.session.accessToken
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : undefined,
      signal,
    })
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true, signal)
      signal?.throwIfAborted()
      response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.session.accessToken}` },
        signal,
      })
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.statusText || 'Thumbnail unavailable',
      )
    }
    return response.blob()
  }

  /**
   * Authenticated bounded JPEG derivative for RAW images whose canonical
   * originals cannot be safely opened through the binary preview-ticket API.
   */
  async mediaAnalysisPreview(nodeID: number, signal?: AbortSignal, revision?: number): Promise<Blob> {
    await this.ensureFresh(signal)
    signal?.throwIfAborted()
    // Cache identity includes the current source revision. The Server derivative
    // is revision/SHA fenced, while a browser may cache the authenticated GET.
    const revisionQuery = Number.isSafeInteger(revision) && (revision ?? 0) > 0
      ? `?revision=${revision}`
      : ''
    const path = `/api/v1/media/items/${nodeID}/analysis-preview${revisionQuery}`
    const send = () => fetch(`${API_BASE}${path}`, {
      cache: revisionQuery ? 'default' : 'no-store',
      headers: this.session.accessToken
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : undefined,
      signal,
    })
    let response = await send()
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true, signal)
      signal?.throwIfAborted()
      response = await send()
    }
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText || 'RAW compatibility preview unavailable')
    }
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('image/jpeg')) {
      throw new ApiError(502, 'RAW preview response is not JPEG')
    }
    const blob = await response.blob()
    signal?.throwIfAborted()
    return blob
  }

  async mediaAnalysisPreviewURL(nodeID: number, signal?: AbortSignal, revision?: number): Promise<string> {
    const blob = await this.mediaAnalysisPreview(nodeID, signal, revision)
    signal?.throwIfAborted()
    return URL.createObjectURL(blob)
  }

  async mediaVideoPoster(nodeID: number, revision: number, poster: Blob, signal?: AbortSignal): Promise<void> {
    await this.ensureFresh(signal)
    signal?.throwIfAborted()
    const path = `/api/v1/media/items/${nodeID}/video-poster`
    const send = () => fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        ...(this.session.accessToken ? { Authorization: `Bearer ${this.session.accessToken}` } : {}),
        'Content-Type': 'image/jpeg',
        'If-Match': `"${revision}"`,
      },
      body: poster,
      signal,
    })
    let response = await send()
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true, signal)
      signal?.throwIfAborted()
      response = await send()
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.statusText || 'Video poster cache update failed',
      )
    }
  }

  async mediaLivePhotoMotionURL(nodeID: number): Promise<string> {
    const ticket = await this.request<{
      url: string
      expires_at: string
      kind: 'video'
      mime_type: string
    }>(`/api/v1/media/items/${nodeID}/live-photo-motion-ticket`, { method: 'POST' })
    if (
      !ticket.url.startsWith('/api/v1/media-live-photo-motion/') ||
      ticket.url.startsWith('//')
    ) {
      throw new ApiError(500, 'Invalid Live Photo motion URL')
    }
    return `${API_BASE}${ticket.url}`
  }

  sources() {
    return this.request<ExternalSource[]>('/api/v1/sources')
  }

  sourceOverview() {
    return this.request<ExternalSourceOverview[]>('/api/v1/sources/overview')
  }

  createSource(input: CreateExternalSourceInput) {
    return this.request<ExternalSource>('/api/v1/sources', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  triggerSource(sourceID: number) {
    return this.request<ExternalSource>(`/api/v1/sources/${sourceID}/trigger`, { method: 'POST' })
  }

  sourceRuns(sourceID: number, limit = 1, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<ExternalSourceRun[]>(`/api/v1/sources/${sourceID}/runs?${query.toString()}`)
  }

  sourceRunFailures(sourceID: number, runID: string, limit = 20, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(1000, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<ExternalSourceRunFailure[]>(
      `/api/v1/sources/${sourceID}/runs/${encodeURIComponent(runID)}/failures?${query.toString()}`,
    )
  }

  cancelSourceRun(sourceID: number, runID: string) {
    return this.request<ExternalSourceRun>(`/api/v1/sources/${sourceID}/runs/${encodeURIComponent(runID)}/cancel`, { method: 'POST' })
  }

  sourceItems(sourceID: number, state = '', limit = 1000, offset = 0) {
    const query = new URLSearchParams()
    if (state) query.set('state', state)
    query.set('limit', String(Math.min(1000, Math.max(1, Math.trunc(limit)))))
    if (offset > 0) query.set('offset', String(Math.trunc(offset)))
    return this.request<ExternalSourceItem[]>(`/api/v1/sources/${sourceID}/items?${query.toString()}`)
  }

  sourceCollections(sourceID: number, state = '') {
    const query = new URLSearchParams()
    if (state) query.set('state', state)
    const suffix = query.toString()
    return this.request<ExternalSourceCollection[]>(
      `/api/v1/sources/${sourceID}/collections${suffix ? `?${suffix}` : ''}`,
    )
  }

  sourceCollectionItems(sourceID: number, collectionID: number, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(1000, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<ExternalSourceCollectionItem[]>(
      `/api/v1/sources/${sourceID}/collections/${collectionID}/items?${query.toString()}`,
    )
  }

  sourceCredentialStatus(sourceID: number) {
    return this.request<ExternalSourceCredentialStatus>(`/api/v1/sources/${sourceID}/credential`)
  }

  revealSourceCredential(sourceID: number) {
    return this.request<ExternalSourceCredentialReveal>(`/api/v1/sources/${sourceID}/credential/reveal`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  testSourceCredential(kind: string, payload: Record<string, unknown>) {
    return this.request<ExternalSourceCredentialTestResult>('/api/v1/source-credentials/test', {
      method: 'POST',
      body: JSON.stringify({ kind, payload }),
    })
  }

  testStoredSourceCredential(sourceID: number) {
    return this.request<ExternalSourceCredentialTestResult>(`/api/v1/sources/${sourceID}/credential/test`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  updateSource(sourceID: number, revision: number, input: UpdateExternalSourceInput) {
    return this.request<ExternalSource>(`/api/v1/sources/${sourceID}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify(input),
    })
  }

  deleteSource(sourceID: number, revision: number) {
    return this.request<void>(`/api/v1/sources/${sourceID}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${revision}"` },
    })
  }

  setSourceCredential(sourceID: number, payload: Record<string, unknown>) {
    return this.request<ExternalSourceCredentialStatus>(`/api/v1/sources/${sourceID}/credential`, {
      method: 'PUT',
      body: JSON.stringify({ payload }),
    })
  }

  deleteSourceCredential(sourceID: number) {
    return this.request<void>(`/api/v1/sources/${sourceID}/credential`, { method: 'DELETE' })
  }

  sourceConnectorConfig(sourceID: number) {
    return this.request<ExternalSourceConnectorConfig>(`/api/v1/sources/${sourceID}/connector-config`)
  }

  sourceBrowseDirectories(sourceID: number, path = '', limit = 200, offset = 0) {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (path) query.set('path', path)
    return this.request<ExternalSourceBrowsePage>(`/api/v1/sources/${sourceID}/browse?${query.toString()}`)
  }

  setSourceConnectorConfig(sourceID: number, revision: number, payload: Record<string, unknown>) {
    return this.request<ExternalSourceConnectorConfig>(`/api/v1/sources/${sourceID}/connector-config`, {
      method: 'PUT',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ payload }),
    })
  }

  root() {
    return this.request<Node>('/api/v1/nodes/root')
  }

  node(id: number) {
    return this.request<Node>(`/api/v1/nodes/${id}`)
  }

  list(parentID: number) {
    return this.request<Node[]>(`/api/v1/nodes/${parentID}/children`)
  }

  listPage(parentID: number, options: XDriveCloudFilesPageOptions = {}) {
    return this.listPageAbortable(parentID, options)
  }

  listPageAbortable(parentID: number, options: XDriveCloudFilesPageOptions = {}, signal?: AbortSignal) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(options.limit ?? 200)))),
      sort: options.sort ?? 'name',
      order: options.order ?? 'asc',
    })
    if (options.cursor?.trim()) query.set('cursor', options.cursor.trim())
    if (options.name) query.set('name', options.name)
    if (options.nameInsensitive) query.set('name_ci', options.nameInsensitive)
    return this.request<XDriveCloudFilesPage<Node>>(
      `/api/v1/nodes/${parentID}/children?${query.toString()}`,
      signal ? { signal } : {},
    )
  }

  listRange(
    parentID: number,
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    includeCount = true,
    grouping?: XDriveFileExplorerGrouping,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted()
    const query = new URLSearchParams({
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
    })
    if (!includeCount) query.set('include_count', 'false')
    appendFileExplorerGrouping(query, grouping)
    return this.request<XDriveCloudFilesRange<Node>>(
      `/api/v1/nodes/${parentID}/children?${query.toString()}`,
      { signal },
    )
  }

  nodeChanges(after = 0, limit = 200) {
    const query = new URLSearchParams({
      after: String(Math.max(0, Math.trunc(after))),
      limit: String(Math.min(1000, Math.max(1, Math.trunc(limit)))),
    })
    return this.request<XDriveCloudFilesChangePage<Node>>(
      `/api/v1/changes?${query.toString()}`,
    )
  }

  fileQuickAccess() {
    return this.request<XDriveFileQuickAccessItem<Node>[]>('/api/v1/file-quick-access')
  }

  pinFileQuickAccess(nodeID: number) {
    return this.request<XDriveFileQuickAccessItem<Node>>(`/api/v1/file-quick-access/${nodeID}`, {
      method: 'PUT',
    })
  }

  unpinFileQuickAccess(nodeID: number) {
    return this.request<void>(`/api/v1/file-quick-access/${nodeID}`, {
      method: 'DELETE',
    })
  }


  reorderFileQuickAccess(nodeIDs: number[]) {
    return this.request<void>('/api/v1/file-quick-access/order', {
      method: 'PUT',
      body: JSON.stringify({ node_ids: nodeIDs }),
    })
  }

  fileTags() {
    return this.request<XDriveFileTag[]>('/api/v1/file-tags')
  }

  createFileTag(name: string, color: string) {
    return this.request<XDriveFileTag>('/api/v1/file-tags', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    })
  }

  updateFileTag(id: number, input: { name?: string; color?: string }) {
    return this.request<XDriveFileTag>(`/api/v1/file-tags/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  deleteFileTag(id: number) {
    return this.request<void>(`/api/v1/file-tags/${id}`, { method: 'DELETE' })
  }

  fileNodeTags(nodeIDs: number[]) {
    return this.request<XDriveFileNodeTags[]>('/api/v1/nodes/tags/query', {
      method: 'POST',
      body: JSON.stringify({ node_ids: nodeIDs }),
    })
  }

  setFileTagNodes(tagID: number, nodeIDs: number[], assigned: boolean) {
    return this.request<{ updated: number }>(`/api/v1/file-tags/${tagID}/nodes`, {
      method: assigned ? 'PUT' : 'DELETE',
      body: JSON.stringify({ node_ids: nodeIDs }),
    })
  }

  fileSavedSearches() {
    return this.request<XDriveFileSavedSearch[]>('/api/v1/file-saved-searches')
  }

  createFileSavedSearch(input: XDriveFileSavedSearchInput) {
    return this.request<XDriveFileSavedSearch>('/api/v1/file-saved-searches', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  updateFileSavedSearch(id: number, input: XDriveFileSavedSearchInput) {
    return this.request<XDriveFileSavedSearch>(`/api/v1/file-saved-searches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  deleteFileSavedSearch(id: number) {
    return this.request<void>(`/api/v1/file-saved-searches/${id}`, { method: 'DELETE' })
  }

  reorderFileSavedSearches(ids: number[]) {
    return this.request<void>('/api/v1/file-saved-searches/order', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    })
  }

  fileFavorites() {
    return this.request<XDriveFileFavoriteItem<Node>[]>('/api/v1/file-favorites')
  }

  favoriteFile(nodeID: number) {
    return this.request<XDriveFileFavoriteItem<Node>>(`/api/v1/file-favorites/${nodeID}`, {
      method: 'PUT',
    })
  }

  unfavoriteFile(nodeID: number) {
    return this.request<void>(`/api/v1/file-favorites/${nodeID}`, {
      method: 'DELETE',
    })
  }

  fileRecent(limit = 16) {
    return this.request<XDriveFileRecentItem<Node>[]>(`/api/v1/file-recent?limit=${Math.min(50, Math.max(1, Math.trunc(limit)))}`)
  }

  touchFileRecent(nodeID: number) {
    return this.request<XDriveFileRecentItem<Node>>(`/api/v1/file-recent/${nodeID}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  clearFileRecent() {
    return this.request<void>('/api/v1/file-recent', {
      method: 'DELETE',
    })
  }

  search(
    query: string,
    limit = 200,
    cursor = '',
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    filters: XDriveFileExplorerSearchFilters = {},
  ) {
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
    })
    if (cursor.trim()) params.set('cursor', cursor.trim())
    appendFileExplorerSearchFilters(params, filters)
    return this.request<SearchPage>(`/api/v1/search?${params.toString()}`)
  }

  async searchRange(
    query: string,
    filters: XDriveFileExplorerSearchFilters,
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    grouping?: XDriveFileExplorerGrouping,
  ): Promise<XDriveCloudFilesSearchRange<Node>> {
    const params = new URLSearchParams({
      q: query.trim(),
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
    })
    appendFileExplorerSearchFilters(params, filters)
    appendFileExplorerGrouping(params, grouping)
    const page = await this.request<{
      items: SearchResult[]
      total_count: number
      offset: number
      limit: number
      sort: 'name' | 'updated' | 'size' | 'type'
      order: 'asc' | 'desc'
      groups?: XDriveCloudFilesSearchRange<Node>['groups']
    }>(`/api/v1/search?${params.toString()}`)
    return {
      items: page.items.map((item) => ({
        node: item.node,
        path: item.path,
        crumbs: item.breadcrumbs,
      })),
      total_count: page.total_count,
      offset: page.offset,
      limit: page.limit,
      sort: page.sort,
      order: page.order,
      groups: page.groups,
    }
  }

  createDirectory(parentID: number, name: string) {
    return this.request<Node>(`/api/v1/nodes/${parentID}/directories`, {
      method: 'POST', body: JSON.stringify({ name }),
    })
  }

  uploadConflictPreflight(parentID: number, name: string) {
    return this.request<XDriveUploadConflictPreflight>('/api/v1/uploads/preflight', {
      method: 'POST',
      body: JSON.stringify({ parent_id: parentID, name }),
    })
  }

  async uploadConflictPreflightBatch(
    items: readonly { parent_id: number; name: string }[],
  ) {
    const result = await this.request<{ items: XDriveUploadConflictPreflight[] }>(
      '/api/v1/uploads/preflight/batch',
      { method: 'POST', body: JSON.stringify({ items }) },
    )
    return result.items
  }

  async upload(parentID: number, file: File, onProgress?: (percent: number) => void): Promise<Node> {
    const result = await this.uploadWithConflictPolicy(parentID, file, 'fail', onProgress)
    return result.node
  }

  async uploadWithConflictPolicy(
    parentID: number,
    file: File,
    conflictPolicy: XDriveUploadConflictPolicy,
    onProgress?: (percent: number) => void,
    transferID = '',
  ): Promise<XDriveUploadResult> {
    const tracking = this.transferContext()
    const managedExternally = Boolean(transferID)
    const activeTransferID = transferID || webTransferStore.create({
      fileName: file.name,
      path: file.name,
      kind: 'upload',
      bytesTotal: file.size,
      speedSource: 'client',
    })
    webTransferStore.trackNetwork(activeTransferID, 'client')
    const reportProgress = (completed: number) => {
      tracking.check()
      if (!managedExternally) webTransferStore.progress(activeTransferID, completed, file.size)
      onProgress?.(file.size === 0 ? 100 : Math.round((completed / file.size) * 100))
    }

    try {
      const chunkSize = 8 * 1024 * 1024
      const chunkCount = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
      const chunkHashes: string[] = []
      const hashScratch: UploadHashScratch = { buffer: null, byob: true }
      for (let index = 0; index < chunkCount; index += 1) {
        tracking.check()
        const start = index * chunkSize
        const end = Math.min(file.size, start + chunkSize)
        chunkHashes.push(await sha256Blob(file.slice(start, end), hashScratch))
      }

      const resumeIdentity = conflictPolicy === 'fail'
        ? `${file.name}\n${file.size}\n${file.lastModified}`
        : `xdrive-upload-conflict-v1\n${parentID}\n${file.name}\n${conflictPolicy}\n${file.size}\n${file.lastModified}`
      const resumeKey = await sha256Buffer(
        new TextEncoder().encode(resumeIdentity).buffer,
      )
      const session = await tracking.api().request<UploadSessionState>('/api/v1/uploads', {
        method: 'POST',
        body: JSON.stringify({
          parent_id: parentID,
          name: file.name,
          size: file.size,
          chunk_size: chunkSize,
          chunk_sha256: chunkHashes,
          resume_key: resumeKey,
          conflict_policy: conflictPolicy,
        }),
        signal: tracking.signal,
      })
      tracking.check()
      if (session.status === 'skipped' && session.result) {
        if (!managedExternally) webTransferStore.completeSkipped(activeTransferID, file.size)
        return { node: session.result, skipped: true, transferred_bytes: 0 }
      }
      if (session.status === 'finalized' && session.result) {
        reportProgress(file.size)
        if (!managedExternally) webTransferStore.complete(activeTransferID, file.size, file.size)
        return { node: session.result, skipped: false, transferred_bytes: 0 }
      }

      const received = new Map(session.received_chunks.map((part) => [part.index, part]))
      let completed = 0
      let transferredBytes = 0
      let networkBytes = 0

      for (let index = 0; index < session.chunk_count; index += 1) {
        tracking.check()
        const start = index * session.chunk_size
        const end = Math.min(file.size, start + session.chunk_size)
        const expectedSize = end - start
        const hash = chunkHashes[index]
        const existing = received.get(index)
        if (existing && existing.size === expectedSize && existing.sha256 === hash) {
          completed += expectedSize
          reportProgress(completed)
          continue
        }

        const chunk = file.slice(start, end)
        const actualHash = await sha256Blob(chunk, hashScratch)
        if (actualHash !== hash) throw new Error(`File changed while uploading chunk ${index}`)
        let reported = 0
        await this.putUploadChunk(session.id, index, hash, chunk, tracking, (loaded, delta) => {
          tracking.check()
          networkBytes += delta
          reported = Math.max(reported, loaded)
          webTransferStore.batchUpdates(() => {
            webTransferStore.networkProgress(activeTransferID, networkBytes)
            reportProgress(completed + reported)
          })
        })
        tracking.check()
        completed += expectedSize
        transferredBytes += expectedSize
        reportProgress(completed)
      }

      const finalized = await tracking.api().request<UploadSessionState>(`/api/v1/uploads/${session.id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({}),
        signal: tracking.signal,
      })
      tracking.check()
      if (!finalized.result) throw new ApiError(500, 'Finalize upload returned no file')
      reportProgress(file.size)
      if (!managedExternally) webTransferStore.complete(activeTransferID, file.size, file.size)
      return {
        node: finalized.result,
        skipped: finalized.status === 'skipped',
        transferred_bytes: transferredBytes,
      }
    } catch (error) {
      if (!managedExternally && !tracking.signal.aborted) webTransferStore.fail(activeTransferID, error)
      throw error
    }
  }

  private async putUploadChunk(
    sessionID: string, index: number, hash: string, data: Blob,
    tracking: ReturnType<XDriveApi['transferContext']>,
    onProgress: (loaded: number, delta: number) => void,
  ) {
    await tracking.api().ensureFresh(tracking.signal)
    const send = () => {
      const api = tracking.api()
      let sent = 0
      return xDriveUploadBytes(`${API_BASE}/api/v1/uploads/${sessionID}/chunks/${index}`, {
        headers: {
          'Authorization': `Bearer ${api.session.accessToken}`,
          'Content-Type': 'application/octet-stream',
          'X-Chunk-SHA256': hash,
        },
        body: data,
        signal: tracking.signal,
        onProgress: (loaded) => {
          if (tracking.signal.aborted || loaded <= sent) return
          const delta = loaded - sent
          sent = loaded
          onProgress(loaded, delta)
        },
      })
    }

    let response = await send()
    if (response.status === 401 && tracking.api().session.refreshToken) {
      await tracking.api().refresh(true, tracking.signal)
      response = await send()
    }
    if (!response.ok) {
      let error = response.statusText || 'Chunk upload failed'
      try {
        const body = (await response.json()) as { error?: string }
        if (body.error) error = body.error
      } catch {
        // Keep the HTTP status text.
      }
      throw new ApiError(response.status, error)
    }
  }

  fileTextPreview(id: number) {
    return this.request<XDriveFileTextPreview>(`/api/v1/files/${id}/preview/text`)
  }

  async mediaLivePhotoStillURL(nodeID: number): Promise<string> {
    const ticket = await this.request<{
      url: string
      expires_at: string
      kind: 'image'
      mime_type: string
    }>(`/api/v1/media/items/${nodeID}/live-photo-still-ticket`, { method: 'POST' })
    if (
      !ticket.url.startsWith('/api/v1/media-live-photo-still/') ||
      ticket.url.startsWith('//')
    ) {
      throw new ApiError(500, 'Invalid Live Photo still URL')
    }
    return `${API_BASE}${ticket.url}`
  }

  async filePreviewURL(nodeID: number, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const ticket = await this.request<{
      url: string
      expires_at: string
      kind: 'image' | 'video' | 'audio' | 'pdf'
      mime_type: string
    }>(`/api/v1/files/${nodeID}/preview-ticket`, { method: 'POST', signal })
    signal?.throwIfAborted()
    if (
      !ticket.url.startsWith('/api/v1/file-preview/') ||
      ticket.url.startsWith('//')
    ) {
      throw new ApiError(500, 'Invalid file preview URL')
    }
    return `${API_BASE}${ticket.url}`
  }

  copy(nodeID: number, parentID: number, name?: string) {
    return this.request<Node>(`/api/v1/nodes/${nodeID}/copy`, {
      method: 'POST',
      body: JSON.stringify({ parent_id: parentID, ...(name ? { name } : {}) }),
    })
  }

  move(nodeID: number, revision: number, parentID: number) {
    return this.request<Node>(`/api/v1/nodes/${nodeID}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ parent_id: parentID }),
    })
  }

  batchCopy(items: BatchNodeRef[], parentID: number) {
    return this.request<BatchNodesResult>('/api/v1/nodes/batch/copy', {
      method: 'POST',
      body: JSON.stringify({ items, parent_id: parentID }),
    })
  }

  batchMove(items: BatchNodeRef[], parentID: number) {
    return this.request<BatchNodesResult>('/api/v1/nodes/batch/move', {
      method: 'POST',
      body: JSON.stringify({ items, parent_id: parentID }),
    })
  }

  batchDelete(items: BatchNodeRef[]) {
    return this.request<BatchNodesResult>('/api/v1/nodes/batch/delete', {
      method: 'POST',
      body: JSON.stringify({ items }),
    })
  }

  filePropertiesStats(items: BatchNodeRef[], signal?: AbortSignal) {
    return this.request<XDriveFileExplorerPropertiesStats>('/api/v1/nodes/properties/stats', {
      method: 'POST',
      body: JSON.stringify({ items }),
      signal,
    })
  }

  async fileMediaDetails(
    items: readonly XDriveFileExplorerMediaDetailsRef[],
    signal?: AbortSignal,
  ) {
    const result = await this.request<{ items: XDriveFileExplorerMediaDetails[] }>(
      '/api/v1/nodes/media-details',
      {
        method: 'POST',
        body: JSON.stringify({ items }),
        signal,
      },
    )
    return result.items
  }

  createFileOperation(
    type: XDriveFileOperationType,
    items: BatchNodeRef[],
    parentID?: number,
    conflictPolicy?: XDriveFileOperation['conflict_policy'],
  ) {
    return this.request<XDriveFileOperation>('/api/v1/file-operations', {
      method: 'POST',
      body: JSON.stringify({
        type,
        items,
        ...(parentID ? { parent_id: parentID } : {}),
        ...(conflictPolicy ? { conflict_policy: conflictPolicy } : {}),
      }),
    })
  }

  resolveFileOperationConflict(id: string, conflictPolicy: 'skip' | 'keep_both' | 'replace') {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ conflict_policy: conflictPolicy }),
    })
  }

  backgroundTaskActiveSummary() {
    return this.request<XDriveBackgroundTaskActiveSummary>(
      '/api/v1/background-tasks/active-summary',
    )
  }

  backgroundTasks(limit = 100) {
    const bounded = Math.min(200, Math.max(1, Math.trunc(limit)))
    return this.request<XDriveBackgroundTask[]>(`/api/v1/background-tasks?limit=${bounded}`)
  }

  backgroundTaskPage(limit = 50, cursor = '') {
    const bounded = Math.min(200, Math.max(1, Math.trunc(limit)))
    const query = new URLSearchParams({ limit: String(bounded) })
    if (cursor.trim()) query.set('cursor', cursor.trim())
    return this.request<XDriveBackgroundTaskPage>(
      `/api/v1/background-tasks/page?${query.toString()}`,
    )
  }

  adminBackgroundTaskPage(limit = 50, cursor = '') {
    const bounded = Math.min(200, Math.max(1, Math.trunc(limit)))
    const query = new URLSearchParams({ limit: String(bounded) })
    if (cursor.trim()) query.set('cursor', cursor.trim())
    return this.request<XDriveBackgroundTaskPage>(
      `/api/v1/admin/background-tasks/page?${query.toString()}`,
    )
  }

  adminBackgroundTasks(limit = 100) {
    const bounded = Math.min(200, Math.max(1, Math.trunc(limit)))
    return this.request<XDriveBackgroundTask[]>(`/api/v1/admin/background-tasks?limit=${bounded}`)
  }

  controlBackgroundTask(
    id: string,
    action: XDriveBackgroundTaskControlAction,
    global = false,
  ) {
    const endpoint = global
      ? '/api/v1/admin/background-tasks/control'
      : '/api/v1/background-tasks/control'
    return this.request<XDriveBackgroundTaskControlResult>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ id, action }),
    })
  }

  fileOperations(limit = 100) {
    const bounded = Math.min(200, Math.max(1, Math.trunc(limit)))
    return this.request<XDriveFileOperation[]>(`/api/v1/file-operations?limit=${bounded}`)
  }

  fileOperation(id: string) {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}`)
  }

  cancelFileOperation(id: string) {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  retryFileOperation(id: string) {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  undoFileOperation(id: string) {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}/undo`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  redoFileOperation(id: string) {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}/redo`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }

  rename(nodeID: number, revision: number, name: string) {
    return this.request<Node>(`/api/v1/nodes/${nodeID}`, {
      method: 'PATCH',
      headers: { 'If-Match': `"${revision}"` },
      body: JSON.stringify({ name }),
    })
  }

  remove(nodeID: number, revision: number) {
    return this.request<void>(`/api/v1/nodes/${nodeID}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${revision}"` },
    })
  }

  trash() {
    return this.request<Node[]>('/api/v1/trash')
  }

  trashRange(
    offset: number,
    limit = 200,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    includeCount = true,
  ) {
    const query = new URLSearchParams({
      range: 'true',
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      sort,
      order,
      include_count: String(includeCount),
    })
    return this.request<XDriveCloudFilesRange<Node>>(`/api/v1/trash?${query.toString()}`)
  }

  restoreTrash(nodeID: number, revision: number) {
    return this.request<Node>(`/api/v1/trash/${nodeID}/restore`, {
      method: 'POST',
      headers: { 'If-Match': `"${revision}"` },
    })
  }

  permanentlyDeleteTrash(nodeID: number, revision: number) {
    return this.request<void>(`/api/v1/trash/${nodeID}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${revision}"` },
    })
  }

  versions(nodeID: number) {
    return this.request<FileVersion[]>(`/api/v1/files/${nodeID}/versions`)
  }

  restoreVersion(nodeID: number, currentRevision: number, versionID: number) {
    return this.request<Node>(`/api/v1/files/${nodeID}/versions/${versionID}/restore`, {
      method: 'POST',
      headers: { 'If-Match': `"${currentRevision}"` },
    })
  }

  createShare(nodeID: number, input: { expires_at?: string; password?: string; max_downloads?: number }) {
    return this.request<CreatedFileShare>(`/api/v1/files/${nodeID}/shares`, {
      method: 'POST',
      body: JSON.stringify({
        expires_at: input.expires_at || null,
        password: input.password || '',
        max_downloads: input.max_downloads ?? 0,
      }),
    })
  }

  shares(nodeID: number) {
    return this.request<FileShare[]>(`/api/v1/files/${nodeID}/shares`)
  }

  revokeShare(shareID: number) {
    return this.request<void>(`/api/v1/shares/${shareID}`, { method: 'DELETE' })
  }

  publicShare(token: string) {
    return this.request<PublicShare>('/api/v1/public/share', {
      headers: { 'X-XDrive-Share-Token': token },
    }, false)
  }

  async downloadPublicShare(token: string, password: string, filename: string) {
    const response = await fetch(
      `${API_BASE}/api/v1/public/share/download-ticket`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XDrive-Share-Token': token,
        },
        body: JSON.stringify({ password }),
      },
    )
    if (!response.ok) {
      let error = response.statusText || 'Shared download failed'
      try {
        const body = (await response.json()) as { error?: string }
        if (body.error) error = body.error
      } catch {
        // Keep the HTTP status text.
      }
      throw new ApiError(response.status, error)
    }
    const ticket = (await response.json()) as AuthenticatedDownloadTicket
    xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), filename)
  }

  downloadURL(nodeID: number) {
    return `${API_BASE}/api/v1/files/${nodeID}/content`
  }

  private nativeDownloadURL(path: string) {
    return `${API_BASE}${path}`
  }

  private async startNativeDownload(ticketPath: string, filename: string, bytesTotal = 0) {
    const tracking = this.transferContext()
    const transferID = webTransferStore.create({
      fileName: filename,
      kind: 'download',
      bytesTotal,
      speedSource: 'server',
    })
    try {
      const ticket = await tracking.api().request<AuthenticatedDownloadTicket>(ticketPath, {
        method: 'POST', signal: tracking.signal,
      })
      tracking.check()
      xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), filename)
      if (ticket.transfer_id) {
        void this.monitorNativeDownload(transferID, ticket.transfer_id, tracking)
      } else {
        webTransferStore.handedOff(transferID)
      }
      return true
    } catch (error) {
      if (!tracking.signal.aborted) webTransferStore.fail(transferID, error)
      throw error
    }
  }

  private async monitorNativeDownload(
    transferID: string, serverTransferID: string,
    tracking: ReturnType<XDriveApi['transferContext']>,
  ) {
    const launchDeadline = Date.now() + 60_000
    let observedActive = false
    try {
      while (true) {
        const progress = await this.nativeDownloadProgress(serverTransferID, tracking)
        if (!progress) {
          webTransferStore.handedOff(transferID)
          return
        }
        webTransferStore.batchUpdates(() => {
          const total = Math.max(0, progress.bytes_total)
          const done = total > 0 ? Math.min(progress.bytes_sent, total) : progress.bytes_sent
          webTransferStore.progress(transferID, done, total)
          webTransferStore.networkProgress(transferID, progress.bytes_sent, progress.updated_at)
        })
        if (progress.state === 'running') observedActive = true
        if (progress.state === 'completed') {
          webTransferStore.complete(transferID, progress.bytes_sent, progress.bytes_total || progress.bytes_sent)
          return
        }
        if (progress.state === 'failed' || progress.state === 'cancelled') {
          webTransferStore.finishLifecycle(transferID, { state: progress.state, error: progress.error })
          return
        }
        if (!observedActive && Date.now() > launchDeadline) throw new Error('浏览器未开始下载。')
        await xDriveWaitForTransferPoll(tracking.signal)
      }
    } catch (error) {
      if (tracking.signal.aborted) return
      webTransferStore.fail(transferID, error)
    }
  }

  private async nativeDownloadProgress(
    serverTransferID: string,
    tracking: ReturnType<XDriveApi['transferContext']>,
  ): Promise<NativeDownloadProgress | null> {
    try {
      const progress = await tracking.api().request<NativeDownloadProgress>(
        `/api/v1/download/progress/${encodeURIComponent(serverTransferID)}`,
        { signal: tracking.signal },
      )
      tracking.check()
      if (
        !progress || progress.transfer_id !== serverTransferID ||
        !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(progress.state) ||
        !Number.isFinite(progress.bytes_sent) || progress.bytes_sent < 0 ||
        !Number.isFinite(progress.bytes_total) || progress.bytes_total < 0 ||
        typeof progress.updated_at !== 'string' || !Number.isFinite(Date.parse(progress.updated_at))
      ) return null
      return progress
    } catch {
      tracking.check()
      // The browser owns the payload connection. An unavailable observation
      // cannot establish whether that separate download failed or completed.
      return null
    }
  }

  async downloadVersion(node: Node, version: FileVersion) {
    const tracking = this.transferContext()
    const downloadSink = await xDriveOpenWebDownloadSink(node.name)
    if (downloadSink.kind === 'cancelled') return false
    try {
      tracking.check()
      if (downloadSink.kind === 'blob') {
        return await this.startNativeDownload(
          `/api/v1/files/${node.id}/versions/${version.id}/download-ticket`,
          node.name,
          version.size,
        )
      }
      await this.downloadAuthenticated(
        `/api/v1/files/${node.id}/versions/${version.id}/content`,
        node.name,
        {},
        true,
        downloadSink,
      )
      return true
    } catch (error) {
      await xDriveAbortWebDownloadSink(downloadSink, error)
      throw error
    }
  }

  async download(node: Node) {
    const tracking = this.transferContext()
    const downloadSink = await xDriveOpenWebDownloadSink(node.name)
    if (downloadSink.kind === 'cancelled') return false
    try {
      tracking.check()
      if (downloadSink.kind === 'blob') {
        return await this.startNativeDownload(
          `/api/v1/files/${node.id}/download-ticket`,
          node.name,
          node.size,
        )
      }
      await this.downloadAuthenticated(
        `/api/v1/files/${node.id}/content`,
        node.name,
        {},
        true,
        downloadSink,
      )
      return true
    } catch (error) {
      await xDriveAbortWebDownloadSink(downloadSink, error)
      throw error
    }
  }

  async downloadArchive(ids: number[], filename: string) {
    const tracking = this.transferContext()
    const downloadSink = await xDriveOpenWebDownloadSink(filename)
    if (downloadSink.kind === 'cancelled') return false

    let groupID = ''
    const childIDs = new Map<string, string>()
    const childStates = new Map<string, ArchiveDownloadProgressFile['state']>()
    let stopPolling = false
    let polling: Promise<void> | null = null

    const applyProgress = (progress: ArchiveDownloadProgress) => {
      tracking.check()
      this.batchTransferUpdates(() => {
        for (const file of progress.files) {
          const childID = childIDs.get(file.path)
          if (!childID) continue
          const previous = childStates.get(file.path)
          if (file.state === 'transferring' && previous !== 'transferring') {
            this.beginTransfer(childID)
          }
          this.progressTransfer(childID, file.done, file.size)
          if (
            (file.state === 'completed' || file.state === 'failed' || file.state === 'cancelled') &&
            previous !== file.state
          ) {
            this.finishTransfer(childID, {
              state: file.state,
              ...(file.error ? { error: file.error } : {}),
            })
          }
          childStates.set(file.path, file.state)
        }
        this.updateTransferGroup(groupID, {
          scanComplete: true,
          bytesDone: progress.bytes_done,
          bytesTotal: progress.bytes_total,
          itemsTotal: progress.items_total,
          itemsCompleted: progress.items_completed,
          itemsFailed: progress.items_failed,
          itemsRunning: progress.items_running,
          itemsQueued: progress.items_queued,
        })
      })
    }

    try {
      tracking.check()
      groupID = this.startTransferGroup({
        fileName: filename,
        path: filename,
        bytesTotal: 0,
        itemsTotal: 0,
        kind: 'download',
        direction: 'download',
        speedSource: downloadSink.kind === 'blob' ? 'server' : 'client',
      })
      let prepared = await tracking.api().request<ArchiveDownloadPrepare>('/api/v1/download/archive/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
        signal: tracking.signal,
      })
      while (
        prepared.state === 'queued' ||
        prepared.state === 'running' ||
        prepared.state === 'cancel_requested'
      ) {
        await xDriveWaitForTransferPoll(tracking.signal, 200)
        prepared = await tracking.api().request<ArchiveDownloadPrepare>(
          `/api/v1/download/archive/prepare/${encodeURIComponent(prepared.transfer_id)}`,
          { signal: tracking.signal },
        )
      }
      tracking.check()
      if (prepared.state !== 'completed') {
        throw new ApiError(409, prepared.error || `Archive prepare ${prepared.state}`)
      }
      const preparedFiles = prepared.files ?? []
      const preparedTotalBytes = prepared.total_bytes ?? 0
      const preparedFilename = prepared.filename || filename

      const registeredChildIDs = this.startTransferChildren(
        groupID,
        preparedFiles.map((file) => ({
          fileName: file.path.split('/').at(-1) || file.path,
          relativePath: file.path,
          bytesTotal: file.size,
        })),
      )
      if (registeredChildIDs.length !== preparedFiles.length) {
        throw new Error('归档下载传输子任务数量不匹配。')
      }
      for (let index = 0; index < preparedFiles.length; index += 1) {
        const file = preparedFiles[index]
        const childID = registeredChildIDs[index]
        childIDs.set(file.path, childID)
        childStates.set(file.path, 'queued')
      }
      this.updateTransferGroup(groupID, {
        scanComplete: true,
        bytesDone: 0,
        bytesTotal: preparedTotalBytes,
        itemsTotal: preparedFiles.length,
        itemsCompleted: 0,
        itemsFailed: 0,
        itemsRunning: 0,
        itemsQueued: preparedFiles.length,
      })

      if (downloadSink.kind === 'blob') {
        const ticket = await tracking.api().request<AuthenticatedDownloadTicket>(
          `/api/v1/download/archive/prepare/${encodeURIComponent(prepared.transfer_id)}/download-ticket`,
          { method: 'POST', signal: tracking.signal },
        )
        tracking.check()
        xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), preparedFilename)

        const handOff = () => {
          this.batchTransferUpdates(() => {
            for (const childID of childIDs.values()) webTransferStore.handedOff(childID)
            webTransferStore.handedOff(groupID)
          })
        }
        if (!ticket.transfer_id) {
          handOff()
          return true
        }
        const launchDeadline = Date.now() + 60_000
        let observedActive = false
        while (true) {
          const network = await this.nativeDownloadProgress(ticket.transfer_id, tracking)
          if (!network) {
            handOff()
            return true
          }
          webTransferStore.networkProgress(groupID, network.bytes_sent, network.updated_at)
          if (network.state === 'failed') {
            throw new ApiError(409, network.error || 'Archive download failed')
          }
          if (network.state === 'cancelled') {
            this.batchTransferUpdates(() => {
              for (const childID of childIDs.values()) this.finishTransfer(childID, { state: 'cancelled' })
              this.finishTransfer(groupID, { state: 'cancelled', error: network.error })
            })
            return false
          }
          if (network.state === 'completed') break
          if (network.state === 'running') observedActive = true
          try {
            applyProgress(await tracking.api().request<ArchiveDownloadProgress>(
              `/api/v1/download/archive/progress/${encodeURIComponent(prepared.transfer_id)}`,
              { signal: tracking.signal },
            ))
          } catch {
            tracking.check()
            // Per-entry logical progress is process-local. A different instance
            // may have no record, while shared response telemetry remains valid.
          }
          if (!observedActive && Date.now() > launchDeadline) {
            throw new Error('浏览器未开始归档下载。')
          }
          await xDriveWaitForTransferPoll(tracking.signal)
        }
      } else {
        polling = (async () => {
          while (!stopPolling) {
            try {
              applyProgress(await tracking.api().request<ArchiveDownloadProgress>(
                `/api/v1/download/archive/progress/${encodeURIComponent(prepared.transfer_id)}`,
                { signal: tracking.signal },
              ))
            } catch {
              if (tracking.signal.aborted) return
              // Side-channel progress must never abort the archive transport.
            }
            try {
              await xDriveWaitForTransferPoll(tracking.signal, 200)
            } catch {
              return
            }
          }
        })()

        try {
          await this.downloadAuthenticated('/api/v1/download/archive', preparedFilename, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, transfer_id: prepared.transfer_id }),
          }, false, downloadSink, groupID)
        } finally {
          stopPolling = true
          await polling
          polling = null
        }

        try {
          applyProgress(await tracking.api().request<ArchiveDownloadProgress>(
            `/api/v1/download/archive/progress/${encodeURIComponent(prepared.transfer_id)}`,
            { signal: tracking.signal },
          ))
        } catch {
          // A successful archive response proves every entry was fully streamed.
        }
      }

      tracking.check()
      this.batchTransferUpdates(() => {
        for (const file of preparedFiles) {
          const childID = childIDs.get(file.path)
          if (!childID || childStates.get(file.path) === 'completed') continue
          this.progressTransfer(childID, file.size, file.size)
          this.finishTransfer(childID, { state: 'completed' })
          childStates.set(file.path, 'completed')
        }
        this.updateTransferGroup(groupID, {
          scanComplete: true,
          bytesDone: preparedTotalBytes,
          bytesTotal: preparedTotalBytes,
          itemsTotal: preparedFiles.length,
          itemsCompleted: preparedFiles.length,
          itemsFailed: 0,
          itemsRunning: 0,
          itemsQueued: 0,
        })
        this.finishTransfer(groupID, { state: 'completed' })
      })
      return true
    } catch (error) {
      stopPolling = true
      await xDriveAbortWebDownloadSink(downloadSink, error)
      if (polling) await polling
      if (tracking.signal.aborted || !groupID) throw error
      this.batchTransferUpdates(() => {
        for (const [path, childID] of childIDs) {
          const state = childStates.get(path)
          if (state === 'completed' || state === 'failed' || state === 'cancelled') continue
          this.finishTransfer(childID, { state: 'cancelled' })
        }
        this.finishTransfer(groupID, {
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      })
      throw error
    }
  }

  private async downloadAuthenticated(
    path: string,
    filename: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
    trackTransfer = true,
    downloadSink: XDriveWebActiveDownloadSink = { kind: 'blob' },
    networkTransferID = '',
  ) {
    const tracking = this.transferContext()
    const transferID = trackTransfer ? webTransferStore.create({
      fileName: filename,
      path: filename,
      kind: 'download',
      speedSource: 'client',
    }) : ''
    const wireID = transferID || networkTransferID
    let transferProgress: ReturnType<typeof xDriveCreateWebDownloadProgressReporter> | null = null

    try {
      await tracking.api().ensureFresh(tracking.signal)
      const send = () => fetch(`${API_BASE}${path}`, {
        method: init.method,
        headers: {
          ...init.headers,
          ...(tracking.api().session.accessToken ? { Authorization: `Bearer ${tracking.api().session.accessToken}` } : {}),
        },
        body: init.body,
        signal: tracking.signal,
      })
      let response = await send()
      if (response.status === 401 && tracking.api().session.refreshToken) {
        await tracking.api().refresh(true, tracking.signal)
        response = await send()
      }
      tracking.check()
      if (!response.ok) throw new ApiError(response.status, response.statusText || 'Download failed')

      const contentLength = Number(response.headers.get('Content-Length') || '0')
      const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0
      let completed = 0
      if (wireID) {
        transferProgress = xDriveCreateWebDownloadProgressReporter((done) => {
          tracking.check()
          webTransferStore.batchUpdates(() => {
            webTransferStore.networkProgress(wireID, done)
            if (trackTransfer) webTransferStore.progress(transferID, done, total)
          })
        })
      }

      if (downloadSink.kind === 'file-system') {
        completed = await xDriveWriteWebDownloadToSink(
          response.body,
          downloadSink,
          () => response.blob(),
          (done) => {
            transferProgress?.progress(done)
          },
        )
      } else {
        const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
        let blob: Blob
        if (response.body) {
          const reader = response.body.getReader()
          const chunks: BlobPart[] = []
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            completed += value.byteLength
            chunks.push(value as BlobPart)
            transferProgress?.progress(completed)
          }
          blob = new Blob(chunks, { type: contentType })
        } else {
          blob = await response.blob()
          completed = blob.size
          transferProgress?.progress(completed)
        }

        tracking.check()
        const url = URL.createObjectURL(blob)
        try {
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
        } finally {
          URL.revokeObjectURL(url)
        }
      }

      tracking.check()
      transferProgress?.flush()
      if (trackTransfer) webTransferStore.complete(transferID, completed, total || completed)
    } catch (error) {
      await xDriveAbortWebDownloadSink(downloadSink, error)
      if (trackTransfer && !tracking.signal.aborted) {
        transferProgress?.flush()
        webTransferStore.fail(transferID, error)
      }
      throw error
    }
  }
}

type UploadHashScratch = { buffer: ArrayBuffer | null; byob: boolean }

async function sha256Blob(blob: Blob, scratch: UploadHashScratch): Promise<string> {
  if (!scratch.byob || typeof blob.stream !== 'function' || blob.size === 0 || blob.size > 8 * 1024 * 1024) {
    return sha256Buffer(await blob.arrayBuffer())
  }
  let reader: ReadableStreamBYOBReader
  try {
    reader = blob.stream().getReader({ mode: 'byob' })
  } catch (error) {
    if (!(error instanceof TypeError) && !(error && typeof error === 'object' && 'name' in error && error.name === 'TypeError')) throw error
    scratch.byob = false
    return sha256Buffer(await blob.arrayBuffer())
  }
  try {
    const minReader = reader as ReadableStreamBYOBReader & {
      read(view: Uint8Array, options: { min: number }): Promise<ReadableStreamReadResult<Uint8Array>>
    }
    scratch.buffer ??= new ArrayBuffer(blob.size)
    let filled = 0
    while (filled < blob.size) {
      const remaining = blob.size - filled
      const { done, value } = await minReader.read(new Uint8Array(scratch.buffer, filled, remaining), { min: remaining })
      if (value) {
        scratch.buffer = value.buffer as ArrayBuffer
        filled += value.byteLength
      }
      if (done && filled < blob.size) throw new Error(`Upload hash stream ended at ${filled} of ${blob.size} bytes`)
    }
    // The digest settles before the next chunk takes ownership of the scratch.
    return await sha256Buffer(scratch.buffer, blob.size)
  } finally {
    try { await reader.cancel() } catch { /* Preserve any original read/hash error. */ }
    reader.releaseLock()
  }
}

async function sha256Buffer(data: ArrayBuffer, byteLength = data.byteLength): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data, 0, byteLength))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
