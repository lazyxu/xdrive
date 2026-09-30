import { readFile } from 'node:fs/promises'

export type AgentHello = {
  discovery_version: number
  protocol_min: number
  protocol_max: number
  agent_version: string
  pid: number
  platform: string
  arch: string
  capabilities: string[]
}

export type AgentBuildInfo = {
  version: string
  channel?: string
  commit?: string
  commit_message?: string
  commit_time?: string
  build_time?: string
}

export type AgentStatus = {
  revision: number
  configured: boolean
  username?: string
  server?: string
  mount_path?: string
  auth_status: string
  sync_status: string
  paused: boolean
  must_change_password: boolean
  last_error?: string
  has_conflict: boolean
  conflict_count: number
  version: string
  server_build?: AgentBuildInfo
}

export type AgentSettings = {
  mount_path: string
  cache_limit_bytes: number
  sync_rules: Array<{ path: string; mode: string }>
}

export type AgentUpdateMode = 'manual' | 'check' | 'download' | 'install'
export type AgentUpdateSource = 'github' | 'gitlab'

export type AgentUpdateState = {
  mode: AgentUpdateMode
  source: AgentUpdateSource
  status: 'idle' | 'checking' | 'available' | 'up_to_date' | 'downloading' | 'downloaded' | 'installing' | 'error' | string
  current_version: string
  latest_version?: string
  release_name?: string
  published_at?: string
  release_notes?: string
  release_url?: string
  channel?: string
  update_available: boolean
  downloaded: boolean
  install_supported: boolean
  last_checked_at?: string
  message?: string
  last_error?: string
  bytes_done?: number
  bytes_total?: number
  bytes_per_second?: number
}

export type AgentFileAvailability = {
  Path: string
  Mode: string
  Placeholder: boolean
  Pinned: boolean
  OnlineOnly: boolean
  AvailableOffline: boolean
  InSync: boolean
  Syncing: boolean
}

export type AgentConflict = {
  id: string
  server?: string
  username?: string
  original_path: string
  conflict_path: string
  original_node_id?: number
  conflict_node_id?: number
  created_at: string
}

export type AgentStatusEvent = {
  type: 'status.changed'
  revision: number
  status: AgentStatus
}

export type AgentTransfer = {
  id: string
  file_name: string
  path?: string
  kind: 'upload' | 'download' | 'hydration' | 'dehydration' | string
  direction: 'upload' | 'download' | 'local' | string
  state: 'running' | 'completed' | 'failed' | 'retrying' | string
  bytes_done: number
  bytes_total: number
  percent: number
  instant_bytes_per_second: number
  average_bytes_per_second: number
  elapsed_ms: number
  error?: string
  retry_count: number
  retryable: boolean
  started_at: string
  updated_at: string
  completed_at?: string
}

export type AgentTransfers = {
  revision: number
  transfers: AgentTransfer[]
}

export type AgentTransferEvent = {
  type: 'transfers.changed'
  revision: number
  transfers: AgentTransfer[]
}

export type AgentSource = {
  id: number
  name: string
  kind: string
  direction: 'push' | 'pull'
  sync_mode: 'backup' | 'mirror'
  run_mode: 'scan' | 'sync'
  status: 'active' | 'paused'
  schedule_type?: 'interval' | 'cron' | 'manual'
  schedule_expression?: string
  schedule_timezone?: string
  revision: number
  target_node_id?: number
  ignore_rules?: string
  checkpoint?: string
  last_run_at?: string
  last_success_at?: string
  last_error?: string
  run_requested_at?: string
  created_at: string
  updated_at: string
}

export type AgentCreateSourceInput = {
  name: string
  kind: string
  direction: 'push' | 'pull'
  sync_mode: 'backup'
  run_mode: 'scan' | 'sync'
  schedule_type?: 'interval' | 'cron' | 'manual'
  schedule_expression?: string
  schedule_timezone?: string
  target_node_id: number
  ignore_rules?: string
}

export type AgentUpdateSourceInput = {
  name?: string
  run_mode?: 'scan' | 'sync'
  status?: 'active' | 'paused'
  schedule_type?: 'interval' | 'cron' | 'manual'
  schedule_expression?: string
  schedule_timezone?: string
  target_node_id?: number
  ignore_rules?: string
}

export type AgentSourceRunFailure = {
  id: number
  source_item_id: number
  external_id: string
  kind: string
  path: string
  size: number
  error: string
  failed_at: string
}

export type AgentSourceRun = {
  id: string
  source_id: number
  source_revision: number
  target_node_id?: number
  mode: 'scan' | 'sync'
  trigger: string
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  scanned_items: number
  scanned_bytes: number
  ignored_items: number
  ignored_bytes: number
  new_items: number
  new_bytes: number
  changed_items: number
  changed_bytes: number
  moved_items: number
  unchanged_items: number
  unchanged_bytes: number
  missing_items: number
  missing_bytes: number
  planned_transfer_items: number
  planned_transfer_bytes: number
  processed_transfer_items?: number
  processed_transfer_bytes?: number
  created_items: number
  updated_items: number
  skipped_items: number
  transferred_items: number
  transferred_bytes: number
  failed_items: number
  active_transfer_path?: string
  active_transfer_bytes?: number
  active_transfer_total_bytes?: number
  cancel_requested_at?: string
  error?: string
  started_at: string
  finished_at?: string
}

export type AgentSourceItemMetadata = {
  original_path?: string
  owner_external_id?: string
  captured_at?: string
  remote_created_at?: string
  content_md5?: string
  thumbnail_url?: string
  pair_group_id?: string
  pair_role?: string
}

export type AgentSourceItem = {
  source_item_id: number
  external_id: string
  node_id?: number
  kind: string
  path: string
  size: number
  modified_at?: string
  sha256?: string
  remote_revision?: string
  state: string
  last_error?: string
  metadata?: AgentSourceItemMetadata
}

export type AgentSourceCollection = {
  id: number
  external_id: string
  kind: string
  name: string
  state: string
  remote_revision?: string
  item_count: number
  last_seen_at: string
  created_at: string
  updated_at: string
}

export type AgentSourceCollectionItem = AgentSourceItem & {
  position: number
}

export type AgentSourceCredentialStatus = {
  configured: boolean
  key_version?: number
  updated_at?: string
}

export type AgentSourceConnectorConfig = {
  configured: boolean
  revision: number
  payload: Record<string, unknown>
  updated_at?: string
}

export type AgentSourceCredentialTestResult = {
  valid: boolean
  kind: string
  account_external_id?: string
  account_name?: string
}

export type AgentCloudNode = {
  id: number
  parent_id?: number
  name: string
  type: 'dir' | 'file'
  size: number
  revision: number
  sha256?: string
  deleted_at?: string
  created_at: string
  updated_at: string
}

export type AgentMediaMetadata = {
  media_kind: 'image' | 'video'
  mime_type?: string
  width?: number
  height?: number
  orientation?: number
  rotation_degrees?: number
  duration_ms?: number
  frame_rate?: number
  bit_rate?: number
  video_codec?: string
  audio_codec?: string
  captured_at?: string
  latitude?: number
  longitude?: number
  altitude_m?: number
  camera_make?: string
  camera_model?: string
  lens_model?: string
  exif?: Record<string, unknown>
  video?: Record<string, unknown>
  index_state: string
  index_error?: string
  has_thumbnail: boolean
  thumbnail_mime_type?: string
  thumbnail_width?: number
  thumbnail_height?: number
}

export type AgentMediaItem = {
  node: AgentCloudNode
  metadata: AgentMediaMetadata
}

export type AgentMediaAlbum = {
  id: string
  kind: string
  name: string
  item_count: number
  cover_node_id?: number
  updated_at?: string
}

export type AgentMediaThumbnail = {
  content_type: string
  data_base64: string
}

export type AgentCloudQuota = {
  quota_bytes: number
  physical_used_bytes: number
  available_bytes: number
  disk_available_bytes?: number
  logical_file_bytes: number
  trash_bytes: number
  history_bytes: number
  over_quota: boolean
}

export type AgentCloudStorageStats = {
  scope: 'self' | 'global'
  disk_total_bytes?: number
  disk_used_bytes?: number
  disk_available_bytes?: number
  xdrive_physical_bytes?: number
  cas_blob_count: number
  cas_physical_bytes: number
  cas_logical_referenced_bytes: number
  cas_dedup_saved_bytes: number
  cas_dedup_ratio: number
  cas_savings_ratio: number
  average_blob_size_bytes: number
  p50_blob_size_bytes: number
  p90_blob_size_bytes: number
  p99_blob_size_bytes: number
  legacy_blob_count: number
  legacy_physical_bytes: number
  buckets: Array<{ key: string; label: string; count: number; bytes: number }>
  generated_at: string
}

export type AgentCloudVersion = {
  id: number
  node_id: number
  revision: number
  size: number
  sha256?: string
  created_at: string
}

export type AgentCloudShare = {
  id: number
  node_id: number
  has_password: boolean
  expires_at?: string
  max_downloads: number
  download_count: number
  revoked_at?: string
  status: 'active' | 'expired' | 'exhausted' | 'revoked' | string
  created_at: string
  updated_at: string
}

export type AgentCreatedCloudShare = {
  share: AgentCloudShare & { token: string }
  url: string
}

export type AgentCloudCrumb = { id: number; name: string }

export type AgentCloudSearchResult = {
  node: AgentCloudNode
  path: string
  crumbs: AgentCloudCrumb[]
}

export type AgentDiagnosticCheck = {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL'
  detail: string
}

export type AgentDiagnosticReport = {
  generated_at: string
  platform: string
  arch: string
  checks: AgentDiagnosticCheck[]
  summary: { pass: number; warn: number; fail: number }
}

export type AgentStorageTreeNode = {
  path: string
  name: string
  mode: 'default' | 'exclude' | 'always-local'
  effective_mode: 'default' | 'exclude' | 'always-local'
  file_count: number
  total_bytes: number
  children?: AgentStorageTreeNode[]
}

export type AgentCacheStats = {
  supported: boolean
  reason?: string
  used_bytes: number
  limit_bytes: number
  reclaimable_bytes: number
  pinned_bytes: number
  cached_files: number
  reclaimable_files: number
  pinned_files: number
}

export type AgentCacheReleaseResult = {
  stats: AgentCacheStats
  released_bytes: number
  released_files: number
  failed_files: number
}

type AgentDiscovery = {
  version: number
  base_url: string
  token: string
  pid: number
}

export class AgentIPCError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string

  constructor(code: string, status: number, message: string, detail?: string) {
    super(message)
    this.name = 'AgentIPCError'
    this.code = code
    this.status = status
    this.detail = detail?.trim() || undefined
  }
}

export class AgentIPCClient {
  static readonly protocolMin = 1
  static readonly protocolMax = 1

  private readonly discoveryPath: string
  private discovery: AgentDiscovery | null = null

  constructor(discoveryPath: string) {
    this.discoveryPath = discoveryPath
  }

  invalidate() {
    this.discovery = null
  }

  async hello(signal?: AbortSignal) {
    let hello: AgentHello
    try {
      hello = await this.request<AgentHello>('GET', '/v1/hello', undefined, 10_000, signal)
    } catch (error) {
      if (error instanceof AgentIPCError && error.status === 404) {
        throw new AgentIPCError(
          'incompatible_agent',
          404,
          'xdrive-agent is too old for this xDrive Desktop version. Update the xDrive Core package.',
        )
      }
      throw error
    }
    if (
      hello.protocol_max < AgentIPCClient.protocolMin ||
      hello.protocol_min > AgentIPCClient.protocolMax
    ) {
      throw new AgentIPCError(
        'incompatible_agent',
        0,
        `Desktop IPC protocol mismatch: desktop supports ${AgentIPCClient.protocolMin}-${AgentIPCClient.protocolMax}, agent supports ${hello.protocol_min}-${hello.protocol_max}.`,
      )
    }
    return hello
  }

  status(signal?: AbortSignal) {
    return this.request<AgentStatus>('GET', '/v1/status', undefined, 10_000, signal)
  }

  events(afterRevision: number, timeoutMs = 25_000, signal?: AbortSignal) {
    const query = new URLSearchParams({
      after_revision: String(afterRevision),
      timeout_ms: String(timeoutMs),
    })
    return this.request<AgentStatusEvent | null>(
      'GET',
      `/v1/events?${query.toString()}`,
      undefined,
      Math.min(timeoutMs + 5_000, 35_000),
      signal,
    )
  }

  login(input: { server: string; username: string; password: string; mount_path?: string }) {
    return this.request<AgentStatus>('POST', '/v1/auth/login', input, 35_000)
  }

  logout() {
    return this.request<AgentStatus>('POST', '/v1/auth/logout')
  }

  changePassword(input: { current_password: string; new_password: string }) {
    return this.request<AgentStatus>('POST', '/v1/auth/change-password', input, 35_000)
  }

  setPaused(paused: boolean) {
    return this.request<AgentStatus>('POST', paused ? '/v1/sync/pause' : '/v1/sync/resume')
  }

  syncNow() {
    return this.request<AgentStatus>('POST', '/v1/sync/now')
  }

  settings() {
    return this.request<AgentSettings>('GET', '/v1/settings')
  }

  updateSettings(input: { mount_path?: string; cache_limit_bytes?: number }) {
    return this.request<AgentSettings>('PATCH', '/v1/settings', input)
  }

  updateState() {
    return this.request<AgentUpdateState>('GET', '/v1/update')
  }

  setUpdateMode(mode: AgentUpdateMode) {
    return this.request<AgentUpdateState>('PATCH', '/v1/update/settings', { mode })
  }

  setUpdateSource(source: AgentUpdateSource) {
    return this.request<AgentUpdateState>('PATCH', '/v1/update/settings', { source })
  }

  checkUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/check', undefined, 90_000)
  }

  downloadUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/download', undefined, 30 * 60_000)
  }

  installUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/install', undefined, 30 * 60_000)
  }

  cancelUpdate() {
    return this.request<AgentUpdateState>('POST', '/v1/update/cancel')
  }

  setSyncRule(path: string, mode: 'exclude' | 'always-local' | 'default') {
    return this.request<AgentSettings>('PUT', '/v1/settings/sync-rule', { path, mode })
  }

  storageTree() {
    return this.request<AgentStorageTreeNode>('GET', '/v1/storage-tree', undefined, 45_000)
  }

  cacheStats() {
    return this.request<AgentCacheStats>('GET', '/v1/cache')
  }

  releaseCache() {
    return this.request<AgentCacheReleaseResult>('POST', '/v1/cache/release', undefined, 130_000)
  }

  mediaItems(kind = '', limit = 100, offset = 0) {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (kind) query.set('kind', kind)
    return this.request<AgentMediaItem[]>('GET', `/v1/media/items?${query.toString()}`)
  }

  mediaAlbums() {
    return this.request<AgentMediaAlbum[]>('GET', '/v1/media/albums')
  }

  mediaAlbumItems(albumID: string, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      album_id: albumID,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentMediaItem[]>('GET', `/v1/media/albums/items?${query.toString()}`)
  }

  mediaThumbnail(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentMediaThumbnail>(
      'GET',
      `/v1/media/thumbnail?${query.toString()}`,
      undefined,
      45_000,
    )
  }

  sources() {
    return this.request<AgentSource[]>('GET', '/v1/sources')
  }

  sourceRuns(sourceID: number, limit = 1, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentSourceRun[]>('GET', `/v1/sources/runs?${query.toString()}`)
  }

  sourceRunFailures(sourceID: number, runID: string, limit = 20, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      run_id: runID,
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentSourceRunFailure[]>('GET', `/v1/sources/runs/failures?${query.toString()}`)
  }

  cancelSourceRun(sourceID: number, runID: string) {
    return this.request<AgentSourceRun>('POST', '/v1/sources/runs/cancel', {
      source_id: sourceID,
      run_id: runID,
    })
  }

  sourceItems(sourceID: number, state = '', limit = 1000, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      limit: String(limit),
      offset: String(offset),
    })
    if (state) query.set('state', state)
    return this.request<AgentSourceItem[]>('GET', `/v1/sources/items?${query.toString()}`)
  }

  sourceCollections(sourceID: number, state = '') {
    const query = new URLSearchParams({ source_id: String(sourceID) })
    if (state) query.set('state', state)
    return this.request<AgentSourceCollection[]>('GET', `/v1/sources/collections?${query.toString()}`)
  }

  sourceCollectionItems(sourceID: number, collectionID: number, limit = 100, offset = 0) {
    const query = new URLSearchParams({
      source_id: String(sourceID),
      collection_id: String(collectionID),
      limit: String(limit),
      offset: String(offset),
    })
    return this.request<AgentSourceCollectionItem[]>('GET', `/v1/sources/collections/items?${query.toString()}`)
  }

  sourceCredentialStatus(sourceID: number) {
    const query = new URLSearchParams({ source_id: String(sourceID) })
    return this.request<AgentSourceCredentialStatus>('GET', `/v1/sources/credential?${query.toString()}`)
  }

  testSourceCredential(kind: string, payload: string | Record<string, string>) {
    const normalized = typeof payload === 'string' ? { cookie: payload } : payload
    return this.request<AgentSourceCredentialTestResult>('POST', '/v1/source-credentials/test', { kind, payload: normalized }, 20_000)
  }

  testStoredSourceCredential(sourceID: number) {
    return this.request<AgentSourceCredentialTestResult>('POST', '/v1/sources/credential/test', { source_id: sourceID }, 20_000)
  }

  setSourceCredential(sourceID: number, payload: string | Record<string, string>) {
    const normalized = typeof payload === 'string' ? { cookie: payload } : payload
    return this.request<AgentSourceCredentialStatus>('PUT', '/v1/sources/credential', {
      source_id: sourceID,
      payload: normalized,
    })
  }

  deleteSourceCredential(sourceID: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/sources/credential', { source_id: sourceID })
  }

  sourceConnectorConfig(sourceID: number) {
    const query = new URLSearchParams({ source_id: String(sourceID) })
    return this.request<AgentSourceConnectorConfig>('GET', `/v1/sources/connector-config?${query.toString()}`)
  }

  setSourceConnectorConfig(sourceID: number, revision: number, payload: Record<string, unknown>) {
    return this.request<AgentSourceConnectorConfig>('PUT', '/v1/sources/connector-config', {
      source_id: sourceID,
      revision,
      payload,
    })
  }

  createSource(input: AgentCreateSourceInput) {
    return this.request<AgentSource>('POST', '/v1/sources', input)
  }

  updateSource(sourceID: number, revision: number, input: AgentUpdateSourceInput) {
    return this.request<AgentSource>('PATCH', '/v1/sources', {
      source_id: sourceID,
      revision,
      update: input,
    })
  }

  deleteSource(sourceID: number, revision: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/sources', { source_id: sourceID, revision })
  }

  triggerSource(sourceID: number) {
    return this.request<AgentSource>('POST', '/v1/sources/trigger', { source_id: sourceID })
  }

  cloudRoot() {
    return this.request<AgentCloudNode>('GET', '/v1/cloud/root')
  }

  cloudChildren(parentID: number) {
    const query = new URLSearchParams({ parent_id: String(parentID) })
    return this.request<AgentCloudNode[]>('GET', `/v1/cloud/children?${query.toString()}`)
  }

  cloudCreateDirectory(parentID: number, name: string) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/directories', { parent_id: parentID, name }, 45_000)
  }

  cloudRename(id: number, revision: number, name: string) {
    return this.request<AgentCloudNode>('PATCH', '/v1/cloud/nodes', { id, revision, name }, 45_000)
  }

  cloudDelete(id: number, revision: number) {
    return this.request<{ ok: boolean }>('DELETE', '/v1/cloud/nodes', { id, revision }, 45_000)
  }

  cloudUpload(parentID: number, localPath: string, name: string) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/upload', {
      parent_id: parentID,
      local_path: localPath,
      name,
    }, 6 * 60 * 60 * 1000)
  }

  cloudDownload(id: number, destination: string) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/download', {
      id,
      destination,
    }, 6 * 60 * 60 * 1000)
  }

  cloudSearch(queryText: string) {
    const query = new URLSearchParams({ q: queryText })
    return this.request<AgentCloudSearchResult[]>('GET', `/v1/cloud/search?${query.toString()}`, undefined, 45_000)
  }

  cloudQuota() {
    return this.request<AgentCloudQuota>('GET', '/v1/cloud/quota')
  }

  cloudStorageStats() {
    return this.request<AgentCloudStorageStats>('GET', '/v1/cloud/storage-stats')
  }

  cloudTrash() {
    return this.request<AgentCloudNode[]>('GET', '/v1/cloud/trash')
  }

  cloudRestoreTrash(id: number, revision: number) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/trash/restore', { id, revision }, 45_000)
  }

  cloudDeleteTrash(id: number, revision: number) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/trash/delete', { id, revision }, 45_000)
  }

  cloudVersions(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentCloudVersion[]>('GET', `/v1/cloud/versions?${query.toString()}`)
  }

  cloudRestoreVersion(nodeID: number, currentRevision: number, versionID: number) {
    return this.request<AgentCloudNode>('POST', '/v1/cloud/versions/restore', {
      node_id: nodeID,
      current_revision: currentRevision,
      version_id: versionID,
    }, 45_000)
  }

  cloudShares(nodeID: number) {
    const query = new URLSearchParams({ node_id: String(nodeID) })
    return this.request<AgentCloudShare[]>('GET', `/v1/cloud/shares?${query.toString()}`)
  }

  cloudCreateShare(nodeID: number, input: { expires_at?: string; password?: string; max_downloads?: number }) {
    return this.request<AgentCreatedCloudShare>('POST', '/v1/cloud/shares', {
      node_id: nodeID,
      expires_at: input.expires_at || '',
      password: input.password || '',
      max_downloads: input.max_downloads ?? 0,
    })
  }

  cloudRevokeShare(id: number) {
    return this.request<{ ok: boolean }>('POST', '/v1/cloud/shares/revoke', { id })
  }

  fileAvailability(path: string) {
    const query = new URLSearchParams({ path })
    return this.request<AgentFileAvailability>('GET', `/v1/file-availability?${query.toString()}`)
  }

  setFileAvailability(path: string, action: 'keep' | 'release' | 'online' | 'sync') {
    return this.request<AgentFileAvailability | { ok: boolean }>('POST', '/v1/file-availability', { path, action }, 130_000)
  }

  transfers() {
    return this.request<AgentTransfers>('GET', '/v1/transfers')
  }

  transferEvents(afterRevision: number, timeoutMs = 25_000, signal?: AbortSignal) {
    const query = new URLSearchParams({
      after_revision: String(afterRevision),
      timeout_ms: String(timeoutMs),
    })
    return this.request<AgentTransferEvent | null>(
      'GET',
      `/v1/transfer-events?${query.toString()}`,
      undefined,
      Math.min(timeoutMs + 5_000, 35_000),
      signal,
    )
  }

  retryTransfer(id: string) {
    return this.request<AgentTransfers>('POST', '/v1/transfers/retry', { id }, 130_000)
  }

  diagnostics() {
    return this.request<AgentDiagnosticReport>('GET', '/v1/diagnostics', undefined, 60_000)
  }

  diagnosticReport() {
    return this.request<{ report: string }>('GET', '/v1/diagnostics/report', undefined, 60_000)
  }

  reconnect() {
    return this.request<AgentStatus>('POST', '/v1/diagnostics/reconnect', undefined, 45_000)
  }

  repairSyncRoot() {
    return this.request<AgentStatus>('POST', '/v1/diagnostics/repair-sync-root', undefined, 45_000)
  }

  openLogs() {
    return this.request<{ ok: boolean }>('POST', '/v1/diagnostics/open-logs')
  }

  async conflicts() {
    const result = await this.request<{ conflicts: AgentConflict[] }>('GET', '/v1/conflicts')
    return result.conflicts
  }

  openConflict(id: string, both: boolean) {
    return this.request<{ ok: boolean }>('POST', '/v1/conflicts/open', { id, both })
  }

  resolveConflict(id: string, choice: 'server' | 'local') {
    return this.request<{ ok: boolean }>('POST', '/v1/conflicts/resolve', { id, choice }, 130_000)
  }

  openFolder() {
    return this.request<{ ok: boolean }>('POST', '/v1/open-folder')
  }

  openPath(path: string, reveal = false) {
    return this.request<{ ok: boolean }>('POST', '/v1/open-path', { path, reveal })
  }

  shutdown() {
    return this.request<{ ok: boolean }>('POST', '/v1/lifecycle/shutdown')
  }

  private async loadDiscovery(force = false): Promise<AgentDiscovery> {
    if (this.discovery && !force) return this.discovery
    let raw: string
    try {
      raw = await readFile(this.discoveryPath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new AgentIPCError(
        'agent_unavailable',
        0,
        code === 'ENOENT'
          ? 'xdrive-agent is not running or has not published Desktop IPC yet.'
          : 'Unable to read xdrive-agent Desktop IPC discovery data.',
      )
    }

    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new AgentIPCError('invalid_discovery', 0, 'xdrive-agent Desktop IPC discovery data is invalid.')
    }
    const discovery = validateDiscovery(value)
    this.discovery = discovery
    return discovery
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    timeoutMs = 10_000,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const discovery = await this.loadDiscovery(attempt > 0)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const abort = () => controller.abort()
      externalSignal?.addEventListener('abort', abort, { once: true })

      try {
        const response = await fetch(new URL(endpoint, discovery.base_url), {
          method,
          headers: {
            Authorization: `Bearer ${discovery.token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: controller.signal,
        })

        if (response.status === 204) return null as T

        const text = await response.text()
        let payload: unknown = {}
        if (text) {
          try {
            payload = JSON.parse(text)
          } catch {
            throw new AgentIPCError('invalid_response', response.status, 'xdrive-agent returned invalid JSON.')
          }
        }

        if (!response.ok) {
          const errorPayload = payload as { error?: unknown; message?: unknown; detail?: unknown }
          const code = typeof errorPayload.error === 'string' ? errorPayload.error : 'agent_error'
          const message = typeof errorPayload.message === 'string'
            ? errorPayload.message
            : `xdrive-agent request failed with HTTP ${response.status}.`
          const detail = typeof errorPayload.detail === 'string' ? errorPayload.detail : undefined
          const apiError = new AgentIPCError(code, response.status, message, detail)
          if (response.status === 401 && attempt === 0) {
            this.invalidate()
            lastError = apiError
            continue
          }
          throw apiError
        }
        return payload as T
      } catch (error) {
        if (externalSignal?.aborted) {
          throw new AgentIPCError('aborted', 0, 'Desktop IPC request was cancelled.')
        }
        if (error instanceof AgentIPCError) throw error
        lastError = error
        this.invalidate()
        if (attempt === 0) continue
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', abort)
      }
    }

    throw new AgentIPCError(
      'agent_unavailable',
      0,
      lastError instanceof Error ? `xdrive-agent is not reachable: ${lastError.message}` : 'xdrive-agent is not reachable.',
    )
  }
}

function validateDiscovery(value: unknown): AgentDiscovery {
  if (!value || typeof value !== 'object') {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery must be an object.')
  }
  const discovery = value as Partial<AgentDiscovery>
  if (discovery.version !== 1) {
    throw new AgentIPCError('unsupported_ipc_version', 0, 'Unsupported xdrive-agent Desktop IPC version.')
  }
  if (typeof discovery.base_url !== 'string' || typeof discovery.token !== 'string' || typeof discovery.pid !== 'number') {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery is missing required fields.')
  }
  if (!/^[0-9a-f]{64}$/i.test(discovery.token) || !Number.isInteger(discovery.pid) || discovery.pid <= 0) {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC discovery credentials are invalid.')
  }

  let url: URL
  try {
    url = new URL(discovery.base_url)
  } catch {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC base URL is invalid.')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new AgentIPCError('invalid_discovery', 0, 'Desktop IPC must use an ephemeral 127.0.0.1 HTTP endpoint.')
  }
  return discovery as AgentDiscovery
}
