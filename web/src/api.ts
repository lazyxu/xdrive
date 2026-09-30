import type {
  AdminUser,
  AuditEvent,
  CreateExternalSourceInput,
  CreatedFileShare,
  ExternalSource,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceCredentialStatus,
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
  MediaItem,
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
} from '../../ui/shared/src'

export type {
  ExternalSource,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceCredentialStatus,
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

export interface UploadChunkState {
  index: number
  size: number
  sha256: string
  reused?: boolean
}

export interface UploadSessionState {
  id: string
  parent_id?: number
  node_id?: number
  name?: string
  size: number
  chunk_size: number
  chunk_count: number
  sha256?: string
  resume_key?: string
  expected_revision?: number
  status: 'active' | 'finalized'
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

  mediaItems(kind = '', limit = 100, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    if (kind) query.set('kind', kind)
    return this.request<MediaItem[]>(`/api/v1/media/items?${query.toString()}`)
  }

  mediaAlbums() {
    return this.request<MediaAlbum[]>('/api/v1/media/albums')
  }

  mediaAlbumItems(albumID: string, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(500, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaItem[]>(
      `/api/v1/media/albums/${encodeURIComponent(albumID)}/items?${query.toString()}`,
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

  async upload(parentID: number, file: File, onProgress?: (percent: number) => void): Promise<Node> {
    const chunkSize = 8 * 1024 * 1024
    const chunkCount = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)
    const chunkHashes: string[] = []
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * chunkSize
      const end = Math.min(file.size, start + chunkSize)
      chunkHashes.push(await sha256Buffer(await file.slice(start, end).arrayBuffer()))
    }

    const resumeKey = await sha256Buffer(
      new TextEncoder().encode(`${file.name}\n${file.size}\n${file.lastModified}`).buffer,
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
      }),
    })
    if (session.status === 'finalized' && session.result) {
      onProgress?.(100)
      return session.result
    }

    const received = new Map(session.received_chunks.map((part) => [part.index, part]))
    let completed = 0

    for (let index = 0; index < session.chunk_count; index += 1) {
      const start = index * session.chunk_size
      const end = Math.min(file.size, start + session.chunk_size)
      const expectedSize = end - start
      const hash = chunkHashes[index]
      const existing = received.get(index)
      if (existing && existing.size === expectedSize && existing.sha256 === hash) {
        completed += expectedSize
        onProgress?.(file.size === 0 ? 100 : Math.round((completed / file.size) * 100))
        continue
      }

      const data = await file.slice(start, end).arrayBuffer()
      const actualHash = await sha256Buffer(data)
      if (actualHash !== hash) throw new Error(`File changed while uploading chunk ${index}`)
      await this.putUploadChunk(session.id, index, hash, data)
      completed += data.byteLength
      onProgress?.(file.size === 0 ? 100 : Math.round((completed / file.size) * 100))
    }

    const finalized = await this.request<UploadSessionState>(`/api/v1/uploads/${session.id}/finalize`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    if (!finalized.result) throw new ApiError(500, 'Finalize upload returned no file')
    onProgress?.(100)
    return finalized.result
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

  private async downloadAuthenticated(path: string, filename: string) {
    await this.ensureFresh()
    let response = await fetch(`${API_BASE}${path}`, {
      headers: this.session.accessToken ? { Authorization: `Bearer ${this.session.accessToken}` } : undefined,
    })
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true)
      response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.session.accessToken}` },
      })
    }
    if (!response.ok) throw new ApiError(response.status, response.statusText || 'Download failed')
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
}

async function sha256Buffer(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
