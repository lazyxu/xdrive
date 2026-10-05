import type {
  AdminUser,
  AuditEvent,
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
  MediaGalleryQuery,
  MediaItem,
  MediaPlaceFacet,
  MediaSuggestedPerson,
  Node,
  PublicShare,
  QuotaUsage,
  StorageHealth,
  StorageHistory,
  StorageStats,
  StagingCleanupFailure,
  StagingCleanupRun,
  UploadStagingCleanup,
  UploadStagingDetail,
  UpdateExternalSourceInput,
  XDriveServerUpdateChannel,
  XDriveServerUpdateSource,
  XDriveServerUpdateState,
  XDriveTransferTask,
  XDriveFileOperation,
  XDriveFileTextPreview,
  XDriveCloudFilesPage,
  XDriveCloudFilesPageOptions,
  XDriveFileOperationType,
  XDriveFileQuickAccessItem,
  XDriveFileRecentItem,
  XDriveUploadConflictPolicy,
  XDriveUploadConflictPreflight,
} from '../../ui/shared/src'
import { webTransferStore } from './transfers'

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
  if (query.search?.trim()) values.set('q', query.search.trim())
  if (query.asset_kind) values.set('asset_kind', query.asset_kind)
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
  if (query.place?.trim()) values.set('place', query.place.trim())
}

export function sessionFromAuth(result: AuthResult): AuthSession {
  return {
    accessToken: result.access_token || result.token,
    refreshToken: result.refresh_token,
    accessExpiresAt: Date.now() + Math.max(0, result.expires_in) * 1000,
  }
}

export class XDriveApi {
  private session: AuthSession
  private readonly onSession?: (session: AuthSession) => void
  private refreshPromise: Promise<void> | null = null

  constructor(session?: Partial<AuthSession>, onSession?: (session: AuthSession) => void) {
    this.session = {
      accessToken: session?.accessToken ?? '',
      refreshToken: session?.refreshToken ?? '',
      accessExpiresAt: session?.accessExpiresAt ?? 0,
    }
    this.onSession = onSession
  }

  transfers() {
    return webTransferStore.snapshot()
  }

  onTransfers(listener: (items: XDriveTransferTask[]) => void) {
    return webTransferStore.subscribe(listener)
  }

  clearTransferHistory() {
    webTransferStore.clearHistory()
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

  private async refresh(force = false) {
    if (!this.session.refreshToken) throw new ApiError(401, 'Session expired')
    if (!force && this.session.accessExpiresAt > Date.now() + 120_000) return
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = (async () => {
      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.session.refreshToken }),
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
      this.setSession(sessionFromAuth(result))
    })()

    try {
      await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  private async ensureFresh() {
    if (this.session.refreshToken && this.session.accessExpiresAt > 0 && this.session.accessExpiresAt <= Date.now() + 120_000) {
      await this.refresh()
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    await this.ensureFresh()
    const headers = new Headers(init.headers)
    if (this.session.accessToken) headers.set('Authorization', `Bearer ${this.session.accessToken}`)
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    let response = await fetch(`${API_BASE}${path}`, { ...init, headers })
    if (response.status === 401 && retry && this.session.refreshToken) {
      await this.refresh(true)
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

  mediaAlbums() {
    return this.request<MediaAlbum[]>('/api/v1/media/albums')
  }

  mediaPlaces(limit = 24) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
    })
    return this.request<MediaPlaceFacet[]>(`/api/v1/media/places?${query.toString()}`)
  }

  mediaSuggestedPeople(limit = 24) {
    const query = new URLSearchParams({
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

  setMediaFavorite(nodeID: number, favorite: boolean) {
    return this.request<{ favorite: boolean }>(
      `/api/v1/media/items/${nodeID}/favorite`,
      {
        method: 'PATCH',
        body: JSON.stringify({ favorite }),
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

  async mediaThumbnail(nodeID: number): Promise<Blob> {
    await this.ensureFresh()
    const path = `/api/v1/media/items/${nodeID}/thumbnail`
    let response = await fetch(`${API_BASE}${path}`, {
      headers: this.session.accessToken
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : undefined,
    })
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true)
      response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.session.accessToken}` },
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

  async mediaLivePhotoMotion(nodeID: number): Promise<Blob> {
    await this.ensureFresh()
    const path = `/api/v1/media/items/${nodeID}/live-photo-motion`
    let response = await fetch(`${API_BASE}${path}`, {
      headers: this.session.accessToken
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : undefined,
    })
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true)
      response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.session.accessToken}` },
      })
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.statusText || 'Live Photo motion unavailable',
      )
    }
    return response.blob()
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

  list(parentID: number) {
    return this.request<Node[]>(`/api/v1/nodes/${parentID}/children`)
  }

  listPage(parentID: number, options: XDriveCloudFilesPageOptions = {}) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(options.limit ?? 200)))),
      sort: options.sort ?? 'name',
      order: options.order ?? 'asc',
    })
    if (options.cursor?.trim()) query.set('cursor', options.cursor.trim())
    return this.request<XDriveCloudFilesPage<Node>>(`/api/v1/nodes/${parentID}/children?${query.toString()}`)
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

  search(query: string, limit = 200, cursor = '') {
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(Math.min(200, Math.max(1, Math.trunc(limit)))),
    })
    if (cursor.trim()) params.set('cursor', cursor.trim())
    return this.request<SearchPage>(`/api/v1/search?${params.toString()}`)
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

  async upload(parentID: number, file: File, onProgress?: (percent: number) => void): Promise<Node> {
    const result = await this.uploadWithConflictPolicy(parentID, file, 'fail', onProgress)
    return result.node
  }

  async uploadWithConflictPolicy(
    parentID: number,
    file: File,
    conflictPolicy: XDriveUploadConflictPolicy,
    onProgress?: (percent: number) => void,
  ): Promise<XDriveUploadResult> {
    const transferID = webTransferStore.create({
      fileName: file.name,
      path: file.name,
      kind: 'upload',
      bytesTotal: file.size,
    })
    const reportProgress = (completed: number) => {
      webTransferStore.progress(transferID, completed, file.size)
      onProgress?.(file.size === 0 ? 100 : Math.round((completed / file.size) * 100))
    }

    try {
      const chunkSize = 8 * 1024 * 1024
      const chunkCount = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
      const chunkHashes: string[] = []
      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * chunkSize
        const end = Math.min(file.size, start + chunkSize)
        chunkHashes.push(await sha256Buffer(await file.slice(start, end).arrayBuffer()))
      }

      const resumeIdentity = conflictPolicy === 'fail'
        ? `${file.name}\n${file.size}\n${file.lastModified}`
        : `xdrive-upload-conflict-v1\n${parentID}\n${file.name}\n${conflictPolicy}\n${file.size}\n${file.lastModified}`
      const resumeKey = await sha256Buffer(
        new TextEncoder().encode(resumeIdentity).buffer,
      )
      const session = await this.request<UploadSessionState>('/api/v1/uploads', {
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
      })
      if (session.status === 'skipped' && session.result) {
        webTransferStore.completeSkipped(transferID, file.size)
        return { node: session.result, skipped: true, transferred_bytes: 0 }
      }
      if (session.status === 'finalized' && session.result) {
        reportProgress(file.size)
        webTransferStore.complete(transferID, file.size, file.size)
        return { node: session.result, skipped: false, transferred_bytes: 0 }
      }

      const received = new Map(session.received_chunks.map((part) => [part.index, part]))
      let completed = 0
      let transferredBytes = 0

      for (let index = 0; index < session.chunk_count; index += 1) {
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

        const data = await file.slice(start, end).arrayBuffer()
        const actualHash = await sha256Buffer(data)
        if (actualHash !== hash) throw new Error(`File changed while uploading chunk ${index}`)
        await this.putUploadChunk(session.id, index, hash, data)
        completed += data.byteLength
        transferredBytes += data.byteLength
        reportProgress(completed)
      }

      const finalized = await this.request<UploadSessionState>(`/api/v1/uploads/${session.id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      if (!finalized.result) throw new ApiError(500, 'Finalize upload returned no file')
      reportProgress(file.size)
      webTransferStore.complete(transferID, file.size, file.size)
      return {
        node: finalized.result,
        skipped: finalized.status === 'skipped',
        transferred_bytes: transferredBytes,
      }
    } catch (error) {
      webTransferStore.fail(transferID, error)
      throw error
    }
  }

  private async putUploadChunk(sessionID: string, index: number, hash: string, data: ArrayBuffer) {
    await this.ensureFresh()
    const send = () => fetch(`${API_BASE}/api/v1/uploads/${sessionID}/chunks/${index}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.session.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'X-Chunk-SHA256': hash,
      },
      body: data,
    })

    let response = await send()
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true)
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

  async filePreviewURL(nodeID: number): Promise<string> {
    const ticket = await this.request<{
      url: string
      expires_at: string
      kind: 'image' | 'video' | 'audio' | 'pdf'
      mime_type: string
    }>(`/api/v1/files/${nodeID}/preview-ticket`, { method: 'POST' })
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

  resolveFileOperationConflict(id: string, conflictPolicy: 'skip' | 'keep_both') {
    return this.request<XDriveFileOperation>(`/api/v1/file-operations/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ conflict_policy: conflictPolicy }),
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
      `${API_BASE}/api/v1/public/share/download`,
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
    const blob = await response.blob()
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

  downloadURL(nodeID: number) {
    return `${API_BASE}/api/v1/files/${nodeID}/content`
  }

  async downloadVersion(node: Node, version: FileVersion) {
    await this.downloadAuthenticated(
      `/api/v1/files/${node.id}/versions/${version.id}/content`,
      node.name,
    )
  }

  async download(node: Node) {
    await this.downloadAuthenticated(`/api/v1/files/${node.id}/content`, node.name)
  }

  async downloadArchive(ids: number[], filename: string) {
    await this.downloadAuthenticated('/api/v1/download/archive', filename, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
  }

  private async downloadAuthenticated(
    path: string,
    filename: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) {
    const transferID = webTransferStore.create({
      fileName: filename,
      path: filename,
      kind: 'download',
    })

    try {
      await this.ensureFresh()
      const send = () => fetch(`${API_BASE}${path}`, {
        method: init.method,
        headers: {
          ...init.headers,
          ...(this.session.accessToken ? { Authorization: `Bearer ${this.session.accessToken}` } : {}),
        },
        body: init.body,
      })
      let response = await send()
      if (response.status === 401 && this.session.refreshToken) {
        await this.refresh(true)
        response = await send()
      }
      if (!response.ok) throw new ApiError(response.status, response.statusText || 'Download failed')

      const contentLength = Number(response.headers.get('Content-Length') || '0')
      const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0
      const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
      let blob: Blob
      let completed = 0

      if (response.body) {
        const reader = response.body.getReader()
        const chunks: BlobPart[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          completed += value.byteLength
          chunks.push(value as BlobPart)
          webTransferStore.progress(transferID, completed, total)
        }
        blob = new Blob(chunks, { type: contentType })
      } else {
        blob = await response.blob()
        completed = blob.size
        webTransferStore.progress(transferID, completed, total || completed)
      }

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
      webTransferStore.complete(transferID, completed, total || completed)
    } catch (error) {
      webTransferStore.fail(transferID, error)
      throw error
    }
  }
}

async function sha256Buffer(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
