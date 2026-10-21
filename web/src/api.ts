import { xDriveValidBaiduNativeCellsPage } from '../../ui/shared/src/media-gallery-baidu-jsapi4-cells'
import {
  xDriveBaiduNativeCellRangeParams, xDriveValidBaiduNativeCellRangePage,
} from '../../ui/shared/src/media-gallery-baidu-jsapi4-cell-range'
import type { XDriveBaiduCellRangeSort } from '../../ui/shared/src/media-gallery-baidu-jsapi4-cell-range'
import type { XDriveDeviceBackupOverview, XDriveDeviceBackupRunPage, XDriveDeviceBackupFolderPage } from '../../ui/shared/src'
import type { XDriveBaiduMapAdminConfig, XDriveBaiduMapAdminUpdate, XDriveBaiduMapAKReveal, XDriveBaiduMapVerification, XDriveBaiduMapProviderInfo, XDriveBaiduStaticMapRequest } from '../../ui/shared/src'
import type { XDriveServiceDependenciesSnapshot, XDriveSourceWorkerConfig, XDriveSourceWorkerUpdate, XDriveSourceWorkerRevisionPage, XDriveSourceWorkerRollbackInput, XDriveGeoNamesConfig, XDriveGeoNamesReloadResult, XDriveGeoNamesUpdate, XDriveGeoNamesRevisionPage, XDriveGeoNamesRollbackInput, XDrivePhotoAutoConfig, XDrivePhotoAutoUpdate, XDrivePhotoAutoRevisionPage, XDrivePhotoAutoRollbackInput } from '../../ui/shared/src'
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
  ExternalSourceRunSkip,
  FileShare,
  BuildInfo,
  FileVersion,
  MeResult,
  MediaAlbum,
  MediaAlbumFolder,
  MediaGalleryFacets,
  MediaGalleryIndexStatus,
  MediaSelectionSnapshot,
  MediaSelectionSnapshotPage,
  MediaSelectionJob,
  MediaSelectionJobFailurePage,
  NodeLocation,
  MediaGalleryQuery,
  MediaSyncFolder,
  MediaFolderView,
  MediaItem,
  MediaItemRange,
  MediaMemory,
  MediaDuplicateGroupList,
  MediaDuplicateOrganizePlan,
  MediaDuplicateOrganizeApplyInput,
  MediaDuplicateOrganizeApplyResult,
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
  MediaPlacesPage,
  MediaPlacesViewportBounds,
  MediaPlacesViewportPage,
  MediaBaiduNativeViewportBounds,
  MediaBaiduNativeViewportPage,
  MediaBaiduNativeCellsPage,
  MediaBaiduNativeCellSelection,
  MediaBaiduMapConsent,
  MediaBaiduMapConsentInput,
  MediaBaiduMapIndexJob,
  MediaBaiduMapIndexJobInput,
  MediaSuggestedPerson,
  UpdateMediaPersonIdentityInput,
  Node,
  PublicShare,
  PublicShareChildren,
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
  XDriveCloudFilesPosition,
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
import { xDriveCloudFilesPositionMatchesRequest } from '../../ui/shared/src/cloud-files'
import { webTransferStore } from './transfers'
import { xDriveMediaResponseBlob } from './mediaBinaryProgress'
import { XDRIVE_NATIVE_SHARE_MAX_BYTES, xDriveReadBoundedNativeShareBlob } from './nativeFileShare'
import {
  xDriveAbortWebDownloadSink,
  xDriveCreateWebDownloadProgressReporter,
  xDriveOpenWebDownloadSink,
  xDriveStartBrowserDownload,
  xDriveWriteWebDownloadToSink,
} from './downloadSink'
import type { XDriveWebActiveDownloadSink } from './downloadSink'
import { xDriveTransferAbortError, xDriveUploadBytes, xDriveWaitForTransferPoll } from './transferTransport'
import { xDriveFetchPwaSafeRead } from './pwaSafeReadRetry'

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

type PublicShareArchivePrepare = {
  prepare_id: string
  state: 'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed'
  filename?: string
  total_bytes?: number
  error?: string
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


/**
 * A thumbnail generator can return 503 with Retry-After during short queue
 * overloads. Wait at most 8s and retry just ONCE, using cache bypass to
 * defeat stale negative responses cached by older xDrive Servers. The same
 * AbortSignal owns the network request and the intervening wait.
 */
async function xDriveThumbnailRetryAfter503(
  response: Response,
  retryFetch: () => Promise<Response>,
  signal?: AbortSignal,
): Promise<Response> {
  if (response.status !== 503) return response
  const retryAfter = response.headers.get('Retry-After')?.trim()
  if (!retryAfter || !/^[1-8]$/.test(retryAfter)) return response
  signal?.throwIfAborted()
  await response.body?.cancel().catch(() => undefined)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Number(retryAfter) * 1000)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  signal?.throwIfAborted()
  return retryFetch()
}


/**
 * Inspect only a bounded header/trailer of a decoded thumbnail Blob. A
 * previously cached HTTP 200 can contain truncated JPEG/PNG bytes even after
 * Server-side derived-cache repair. This is an envelope check, not a
 * whole-image decode or a request for original photo bytes.
 */
async function xDriveThumbnailHasSafeImageEnvelope(
  blob: Blob,
  contentType: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  const mime = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  const jpeg = mime === 'image/jpeg'
  const png = mime === 'image/png'
  if ((!jpeg && !png) || blob.size < (jpeg ? 64 : 45)) return false
  signal?.throwIfAborted()
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  signal?.throwIfAborted()
  const tail = new Uint8Array(await blob.slice(-12).arrayBuffer())
  signal?.throwIfAborted()
  if (jpeg) {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff &&
      tail[10] === 0xff && tail[11] === 0xd9
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]
  return signature.every((part, index) => head[index] === part) &&
    iend.every((part, index) => tail[index] === part)
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
  if (query.initial_position) values.set('initial_position', query.initial_position)
  if (query.unknown_first) values.set('unknown_first', 'true')
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
    if (query.include_descendants) values.set('include_descendants', 'true')
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
  if (query.nearby?.trim()) values.set('nearby', query.nearby.trim())
  if (query.bbox?.trim()) values.set('bbox', query.bbox.trim())
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

// A grouped Web upload has one owner even when an authenticated API instance
// is renewed. Never serialize cancellation callbacks with persisted history.
type WebUploadGroupOwner = {
  tracking: { signal: AbortSignal; check: () => void; api: () => XDriveApi }
  requestedByUser: () => boolean
  release: () => void
}
const webUploadGroupOwners = new Map<string, WebUploadGroupOwner>()

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
      for (const owner of webUploadGroupOwners.values()) owner.release()
      webUploadGroupOwners.clear()
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
    for (const owner of webUploadGroupOwners.values()) owner.release()
    webUploadGroupOwners.clear()
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

  private cancellableTransferContext(
    id: string,
    session: ReturnType<XDriveApi['transferContext']>,
  ) {
    const controller = new AbortController()
    const abortOnSessionChange = () => controller.abort()
    if (session.signal.aborted) controller.abort()
    else session.signal.addEventListener('abort', abortOnSessionChange, { once: true })
    let requestedByUser = false
    webTransferStore.registerCancellation(id, () => {
      requestedByUser = true
      controller.abort()
    })
    return {
      tracking: {
        signal: controller.signal,
        check: () => {
          session.check()
          if (controller.signal.aborted) throw xDriveTransferAbortError()
        },
        api: session.api,
      },
      requestedByUser: () => requestedByUser,
      release: () => {
        session.signal.removeEventListener('abort', abortOnSessionChange)
        webTransferStore.unregisterCancellation(id)
      },
    }
  }

  transfers() {
    return webTransferStore.snapshot()
  }

  canCancelTransfer(id: string) {
    return webTransferStore.canCancel(id)
  }

  cancelTransfer(id: string) {
    return webTransferStore.cancel(id)
  }

  isTransferCancelRequested(id: string) {
    return webUploadGroupOwners.get(id)?.requestedByUser() === true
  }

  uploadGroupSignal(id: string) {
    return webUploadGroupOwners.get(id)?.tracking.signal
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
    const session = this.transferContext()
    const id = webTransferStore.startGroup({ ...input, speedSource: input.speedSource ?? 'client' })
    if ((input.kind ?? 'upload') === 'upload') {
      try {
        webUploadGroupOwners.set(id, this.cancellableTransferContext(id, session))
      } catch (error) {
        webTransferStore.finishLifecycle(id, { state: 'failed', error: String(error) })
        throw error
      }
    }
    return id
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
    const owner = webUploadGroupOwners.get(id)
    if (owner) {
      owner.release()
      webUploadGroupOwners.delete(id)
    }
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
    let response = await xDriveFetchPwaSafeRead(`${API_BASE}${path}`, path, { ...init, headers })
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

  adminServices() {
    return this.request<XDriveServiceDependenciesSnapshot>('/api/v1/admin/services')
  }

  adminCaddyHTTPSConfig() {
    return this.request<import('../../ui/shared/src').XDriveCaddyHTTPSConfig>(
      '/api/v1/admin/services/caddy/https', { cache: 'no-store' },
    )
  }
  adminSaveCaddyHTTPS(input: import('../../ui/shared/src').XDriveCaddyHTTPSUpdate) {
    return this.request<import('../../ui/shared/src').XDriveCaddyHTTPSConfig>(
      '/api/v1/admin/services/caddy/https', {
        method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminCaddyHTTPSRevisions() {
    return this.request<import('../../ui/shared/src').XDriveCaddyHTTPSRevisionPage>(
      '/api/v1/admin/services/caddy/https/revisions', { cache: 'no-store' },
    )
  }
  adminRollbackCaddyHTTPS(input: import('../../ui/shared/src').XDriveCaddyHTTPSRollbackInput) {
    return this.request<import('../../ui/shared/src').XDriveCaddyHTTPSConfig>(
      '/api/v1/admin/services/caddy/https/rollback', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }

  adminVerifyCaddyAliDNSRead(input: import('../../ui/shared/src').XDriveCaddyAliDNSReadVerifyInput) {
    return this.request<import('../../ui/shared/src').XDriveCaddyAliDNSReadVerify>(
      '/api/v1/admin/services/caddy/alidns/verify-read', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }

  adminCaddyHTTPSPreflight() {
    return this.request<import('../../ui/shared/src').XDriveCaddyHTTPSPreflight>(
      '/api/v1/admin/services/caddy/https/preflight', { cache: 'no-store' },
    )
  }

  adminCaddyHTTPSHostPlan() {
    return this.request<import('../../ui/shared/src').XDriveCaddyHTTPSHostPlan>(
      '/api/v1/admin/services/caddy/https/host-plan', { cache: 'no-store' },
    )
  }

  adminCaddyAliDNSConfig() {
    return this.request<import('../../ui/shared/src').XDriveCaddyAliDNSConfig>(
      '/api/v1/admin/services/caddy/alidns', { cache: 'no-store' },
    )
  }
  adminSaveCaddyAliDNS(input: import('../../ui/shared/src').XDriveCaddyAliDNSUpdate) {
    return this.request<import('../../ui/shared/src').XDriveCaddyAliDNSConfig>(
      '/api/v1/admin/services/caddy/alidns', {
        method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminRevealCaddyAliDNS(revision: number) {
    return this.request<import('../../ui/shared/src').XDriveCaddyAliDNSReveal>(
      '/api/v1/admin/services/caddy/alidns/reveal', {
        method: 'POST', body: JSON.stringify({ revision }), cache: 'no-store',
      },
    )
  }

  adminMediaWorkerConfig() {
    return this.request<import('../../ui/shared/src').XDriveMediaWorkerConfig>(
      '/api/v1/admin/services/media-worker', { cache: 'no-store' },
    )
  }
  adminSaveMediaWorker(input: import('../../ui/shared/src').XDriveMediaWorkerUpdate) {
    return this.request<import('../../ui/shared/src').XDriveMediaWorkerConfig>(
      '/api/v1/admin/services/media-worker', {
        method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminApplyMediaWorker(input: { revision: number }) {
    return this.request<import('../../ui/shared/src').XDriveMediaWorkerApplyResult>(
      '/api/v1/admin/services/media-worker/apply', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminMediaWorkerRevisions() {
    return this.request<import('../../ui/shared/src').XDriveMediaWorkerRevisionPage>(
      '/api/v1/admin/services/media-worker/revisions', { cache: 'no-store' },
    )
  }
  adminRollbackMediaWorker(input: import('../../ui/shared/src').XDriveMediaWorkerRollbackInput) {
    return this.request<import('../../ui/shared/src').XDriveMediaWorkerConfig>(
      '/api/v1/admin/services/media-worker/rollback', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }

  adminPostgresPoolConfig() {
    return this.request<import('../../ui/shared/src').XDrivePostgresPoolConfig>('/api/v1/admin/services/postgresql/pool', { cache: 'no-store' })
  }
  adminSavePostgresPoolConfig(input: import('../../ui/shared/src').XDrivePostgresPoolUpdate) {
    return this.request<import('../../ui/shared/src').XDrivePostgresPoolConfig>('/api/v1/admin/services/postgresql/pool', {
      method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
    })
  }
  adminPostgresPoolRevisions() {
    return this.request<import('../../ui/shared/src').XDrivePostgresPoolRevisionPage>(
      '/api/v1/admin/services/postgresql/pool/revisions', { cache: 'no-store' },
    )
  }
  adminRollbackPostgresPool(input: import('../../ui/shared/src').XDrivePostgresPoolRollbackInput) {
    return this.request<import('../../ui/shared/src').XDrivePostgresPoolConfig>(
      '/api/v1/admin/services/postgresql/pool/rollback', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }

  adminSourceWorkerConfig() {
    return this.request<XDriveSourceWorkerConfig>('/api/v1/admin/services/source-worker', { cache: 'no-store' })
  }
  adminSaveSourceWorkerConfig(input: XDriveSourceWorkerUpdate) {
    return this.request<XDriveSourceWorkerConfig>('/api/v1/admin/services/source-worker', {
      method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
    })
  }
  adminSourceWorkerRevisions() {
    return this.request<XDriveSourceWorkerRevisionPage>('/api/v1/admin/services/source-worker/revisions', { cache: 'no-store' })
  }
  adminRollbackSourceWorker(input: XDriveSourceWorkerRollbackInput) {
    return this.request<XDriveSourceWorkerConfig>('/api/v1/admin/services/source-worker/rollback', {
      method: 'POST', body: JSON.stringify(input), cache: 'no-store',
    })
  }

  adminPhotoHostConfig() {
    return this.request<import('../../ui/shared/src').XDrivePhotoHostConfig>(
      '/api/v1/admin/services/photo-intelligence/host', { cache: 'no-store' },
    )
  }
  adminPhotoHostPreflight() {
    return this.request<import('../../ui/shared/src').XDrivePhotoHostPreflight>(
      '/api/v1/admin/services/photo-intelligence/host/preflight', { cache: 'no-store' },
    )
  }
  adminApplyPhotoHost(input: import('../../ui/shared/src').XDrivePhotoHostApplyInput) {
    return this.request<import('../../ui/shared/src').XDrivePhotoHostApplyResult>(
      '/api/v1/admin/services/photo-intelligence/host/apply', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminSavePhotoHost(input: import('../../ui/shared/src').XDrivePhotoHostUpdate) {
    return this.request<import('../../ui/shared/src').XDrivePhotoHostConfig>(
      '/api/v1/admin/services/photo-intelligence/host', {
        method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminPhotoHostRevisions() {
    return this.request<import('../../ui/shared/src').XDrivePhotoHostRevisionPage>(
      '/api/v1/admin/services/photo-intelligence/host/revisions', { cache: 'no-store' },
    )
  }
  adminRollbackPhotoHost(input: import('../../ui/shared/src').XDrivePhotoHostRollbackInput) {
    return this.request<import('../../ui/shared/src').XDrivePhotoHostConfig>(
      '/api/v1/admin/services/photo-intelligence/host/rollback', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminPhotoAutoConfig() {
    return this.request<XDrivePhotoAutoConfig>('/api/v1/admin/services/photo-intelligence')
  }
  adminSavePhotoAutoConfig(input: XDrivePhotoAutoUpdate) {
    return this.request<XDrivePhotoAutoConfig>('/api/v1/admin/services/photo-intelligence', {
      method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
    })
  }
  adminPhotoAutoRevisions() {
    return this.request<XDrivePhotoAutoRevisionPage>('/api/v1/admin/services/photo-intelligence/revisions', { cache: 'no-store' })
  }
  adminRollbackPhotoAuto(input: XDrivePhotoAutoRollbackInput) {
    return this.request<XDrivePhotoAutoConfig>('/api/v1/admin/services/photo-intelligence/rollback', {
      method: 'POST', body: JSON.stringify(input), cache: 'no-store',
    })
  }

  adminSaveGeoNamesConfig(input: XDriveGeoNamesUpdate) {
    return this.request<XDriveGeoNamesConfig>('/api/v1/admin/services/geonames', {
      method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
    })
  }
  adminGeoNamesConfig() {
    return this.request<XDriveGeoNamesConfig>('/api/v1/admin/services/geonames')
  }
  adminGeoNamesRevisions() {
    return this.request<XDriveGeoNamesRevisionPage>('/api/v1/admin/services/geonames/revisions', { cache: 'no-store' })
  }
  adminRollbackGeoNames(input: XDriveGeoNamesRollbackInput) {
    return this.request<XDriveGeoNamesConfig>('/api/v1/admin/services/geonames/rollback', {
      method: 'POST', body: JSON.stringify(input), cache: 'no-store',
    })
  }
  adminApplyGeoNamesDataset(input: import('../../ui/shared/src').XDriveGeoNamesDatasetApplyInput) {
    return this.request<XDriveGeoNamesConfig>(
      '/api/v1/admin/services/geonames/dataset-snapshots/apply', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminRestoreMissingGeoNamesSnapshot(input: import('../../ui/shared/src').XDriveGeoNamesRestoreMissingInput) {
    return this.request<XDriveGeoNamesConfig>(
      '/api/v1/admin/services/geonames/dataset-snapshots/restore-missing', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminStageGeoNamesSnapshot(input: import('../../ui/shared/src').XDriveGeoNamesSnapshotInput) {
    return this.request<import('../../ui/shared/src').XDriveGeoNamesSnapshotResult>(
      '/api/v1/admin/services/geonames/dataset-snapshots', {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }
  adminReloadGeoNames(expectedVersion: string) {
    return this.request<XDriveGeoNamesReloadResult>('/api/v1/admin/services/geonames/reload', {
      method: 'POST', body: JSON.stringify({ expected_version: expectedVersion }), cache: 'no-store',
    })
  }
  adminBaiduJSAPIConfig() {
    return this.request<import('../../ui/shared/src').XDriveBaiduJSAPIConfig>(
      '/api/v1/admin/services/baidu-jsapi', { cache: 'no-store' },
    )
  }
  adminSaveBaiduJSAPIConfig(input: import('../../ui/shared/src').XDriveBaiduJSAPIUpdate) {
    return this.request<import('../../ui/shared/src').XDriveBaiduJSAPIConfig>(
      '/api/v1/admin/services/baidu-jsapi',
      { method: 'PUT', body: JSON.stringify(input), cache: 'no-store' },
    )
  }
  adminVerifyBaiduJSAPI4Loader(revision: number) {
    return this.request<import('../../ui/shared/src').XDriveBaiduJSAPI4LoaderProbe>(
      '/api/v1/admin/services/baidu-jsapi/verify-loader',
      { method: 'POST', body: JSON.stringify({ revision }), cache: 'no-store' },
    )
  }
  adminBaiduMapConfig() {
    return this.request<XDriveBaiduMapAdminConfig>('/api/v1/admin/services/baidu-map')
  }

  adminVerifyBaiduMap(revision: number) {
    return this.request<XDriveBaiduMapVerification>('/api/v1/admin/services/baidu-map/verify', {
      method: 'POST', body: JSON.stringify({ revision }), cache: 'no-store',
    })
  }

  adminRevealBaiduMapAK(revision: number) {
    return this.request<XDriveBaiduMapAKReveal>('/api/v1/admin/services/baidu-map/reveal', {
      method: 'POST',
      body: JSON.stringify({ revision }),
      cache: 'no-store',
    })
  }

  adminSaveBaiduMapConfig(input: XDriveBaiduMapAdminUpdate) {
    return this.request<XDriveBaiduMapAdminConfig>('/api/v1/admin/services/baidu-map', {
      method: 'PUT',
      body: JSON.stringify(input),
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

  /** G07: read-only frozen query selection, not a file-operation endpoint. */
  createMediaSelectionSnapshot(filters: MediaGalleryQuery, albumID = '', day = '') {
    const params = new URLSearchParams()
    appendMediaGalleryQuery(params, filters)
    if (albumID) params.set('album_id', albumID)
    if (day) params.set('day', day)
    return this.request<MediaSelectionSnapshot>(
      `/api/v1/media/selection-snapshots?${params.toString()}`,
      { method: 'POST' },
    )
  }

  getMediaSelectionSnapshot(token: string, offset = 0, limit = 100) {
    const params = new URLSearchParams({
      offset: String(Math.max(0, Math.trunc(offset))),
      limit: String(Math.max(1, Math.min(200, Math.trunc(limit)))),
    })
    return this.request<MediaSelectionSnapshotPage>(
      `/api/v1/media/selection-snapshots/${encodeURIComponent(token)}?${params}`,
    )
  }

  setMediaSelectionExcluded(token: string, nodeID: number, excluded: boolean, version: number) {
    return this.request<MediaSelectionSnapshot>(
      `/api/v1/media/selection-snapshots/${encodeURIComponent(token)}/exclusion`,
      { method: 'PATCH', body: JSON.stringify({
        node_id: nodeID, excluded, version,
      }) },
    )
  }

  deleteMediaSelectionSnapshot(token: string) {
    return this.request<void>(
      `/api/v1/media/selection-snapshots/${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    )
  }

  submitMediaSelectionFavoriteJob(token: string, version: number, favorite: boolean) {
    return this.request<MediaSelectionJob>(
      `/api/v1/media/selection-snapshots/${encodeURIComponent(token)}/jobs`,
      { method: 'POST', body: JSON.stringify({
        version, action: 'favorite', favorite, confirm: true,
      }) },
    )
  }

  getMediaSelectionJob(jobID: string) {
    return this.request<MediaSelectionJob>(
      `/api/v1/media/selection-jobs/${encodeURIComponent(jobID)}`,
    )
  }

  listMediaSelectionJobs() {
    return this.request<MediaSelectionJob[]>('/api/v1/media/selection-jobs')
  }

  cancelMediaSelectionJob(jobID: string) {
    return this.request<void>(
      `/api/v1/media/selection-jobs/${encodeURIComponent(jobID)}/cancel`,
      { method: 'POST' },
    )
  }

  retryMediaSelectionJob(jobID: string) {
    return this.request<MediaSelectionJob>(
      `/api/v1/media/selection-jobs/${encodeURIComponent(jobID)}/retry`,
      { method: 'POST' },
    )
  }

  mediaSelectionJobFailures(jobID: string, offset = 0, limit = 100) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
    return this.request<MediaSelectionJobFailurePage>(
      `/api/v1/media/selection-jobs/${encodeURIComponent(jobID)}/failures?${params}`,
    )
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

  // One Owner-scoped Server contract for wide Web, Mobile Web, and PWA.
  // This endpoint only manages consent; it never activates JSAPI4 or exports GPS.
  mediaBaiduMapConsent(nodeID: number) {
    return this.request<MediaBaiduMapConsent>(
      `/api/v1/media/items/${nodeID}/baidu-map-consent`, { cache: 'no-store' },
    )
  }

  saveMediaBaiduMapConsent(nodeID: number, input: MediaBaiduMapConsentInput) {
    return this.request<MediaBaiduMapConsent>(
      `/api/v1/media/items/${nodeID}/baidu-map-consent`, {
        method: 'PUT', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }

  revokeMediaBaiduMapConsent(nodeID: number, revision: number) {
    return this.request<MediaBaiduMapConsent>(
      `/api/v1/media/items/${nodeID}/baidu-map-consent`, {
        method: 'DELETE', headers: { 'If-Match': `"${revision}"` }, cache: 'no-store',
      },
    )
  }

  // Explicit Owner request only: GET is passive; POST queues with confirm=true,
  // DELETE cancels the matching consent generation. No JSAPI4 activation.
  mediaBaiduMapIndexJob(nodeID: number) {
    return this.request<MediaBaiduMapIndexJob>(
      `/api/v1/media/items/${nodeID}/baidu-map-index-job`, { cache: 'no-store' },
    )
  }

  enqueueMediaBaiduMapIndexJob(nodeID: number, input: MediaBaiduMapIndexJobInput) {
    return this.request<MediaBaiduMapIndexJob>(
      `/api/v1/media/items/${nodeID}/baidu-map-index-job`, {
        method: 'POST', body: JSON.stringify(input), cache: 'no-store',
      },
    )
  }

  cancelMediaBaiduMapIndexJob(nodeID: number, revision: number) {
    return this.request<MediaBaiduMapIndexJob>(
      `/api/v1/media/items/${nodeID}/baidu-map-index-job`, {
        method: 'DELETE', headers: { 'If-Match': `"${revision}"` }, cache: 'no-store',
      },
    )
  }

  mediaBaiduMapProvider() {
    return this.request<XDriveBaiduMapProviderInfo>('/api/v1/media/places/map-provider')
  }

  async mediaBaiduStaticMap(input: XDriveBaiduStaticMapRequest, signal?: AbortSignal): Promise<Blob> {
    const query = new URLSearchParams({
      lat: String(input.latitude), lng: String(input.longitude),
      zoom: String(input.zoom), width: String(input.width), height: String(input.height),
    })
    const path = `/api/v1/media/places/baidu-static?${query.toString()}`
    await this.ensureFresh(signal)
    const requestImage = () => fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.session.accessToken}` },
      cache: 'no-store',
      signal,
    })
    let response = await requestImage()
    if (response.status === 401 && this.session.refreshToken && !signal?.aborted) {
      await this.refresh(true, signal)
      response = await requestImage()
    }
    if (!response.ok) throw new ApiError(response.status, '百度地图加载失败')
    if ((response.headers.get('Content-Type') || '').split(';', 1)[0].trim() !== 'image/png') {
      throw new Error('百度地图返回了无效的图片格式')
    }
    const blob = await response.blob()
    if (blob.size > 3 * 1024 * 1024 || !blob.size) throw new Error('百度地图图片大小无效')
    return blob
  }

  // P0-Places-A1: bounded, owner-scoped location pages. Legacy array API
  // remains for older clients and independent gallery previews.
  mediaPlacesPage(limit = 48, offset = 0) {
    const query = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, Math.trunc(limit)))),
      offset: String(Math.max(0, Math.trunc(offset))),
    })
    return this.request<MediaPlacesPage>(`/api/v1/media/places/page?${query.toString()}`)
  }

  // All viewport consumers, including compact Mobile Web and PWA, use the
  // same Owner-authenticated REST query and abortable transport. No map AK.
  mediaPlacesViewport(
    bounds: MediaPlacesViewportBounds, limit = 64, offset = 0, signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      west: String(bounds.west), south: String(bounds.south),
      east: String(bounds.east), north: String(bounds.north),
      limit: String(limit), offset: String(offset),
    })
    return this.request<MediaPlacesViewportPage>(
      `/api/v1/media/places/viewport?${query.toString()}`,
      { signal, cache: 'no-store' },
    )
  }

  /** Runtime comes only from Server's current signed, revocable release. */
  mediaBaiduJSAPI4Status(signal?: AbortSignal) {
    return this.request<{
      provider: 'baidu-jsapi-4.0'
      enabled: boolean
      activation_state: string
    }>('/api/v1/media/places/baidu-jsapi/status',
      { signal, cache: 'no-store' }).then(status => {
      if (!status || status.provider !== 'baidu-jsapi-4.0' ||
          typeof status.enabled !== 'boolean' ||
          typeof status.activation_state !== 'string' ||
          (status.enabled && status.activation_state !== 'authorized_signed_release')) {
        throw new Error('Invalid signed map runtime status')
      }
      return status
    })
  }

  /** Real authenticated Session POST sets a Secure HttpOnly Cookie exclusively
   * for /_BMapService/. Browser AK and Bearer never enter its response or URL.
   * A cross-origin API_BASE or file:/HTTP view may not mint this Cookie. */
  mediaBaiduJSAPI4Session(signal: AbortSignal) {
    if (!signal || signal.aborted || typeof window === 'undefined' ||
        window.location.protocol !== 'https:' ||
        new URL(`${API_BASE}/api/v1/media/places/baidu-jsapi/session`,
          window.location.href).origin !== window.location.origin) {
      return Promise.reject(new Error('baidu_jsapi4_not_authorized'))
    }
    return this.request<{
      provider: 'baidu-jsapi-4.0'
      runtime_enabled: true
    }>('/api/v1/media/places/baidu-jsapi/session', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin', signal,
    }).then(grant => {
      if (!grant || grant.provider !== 'baidu-jsapi-4.0' ||
          grant.runtime_enabled !== true || signal.aborted) {
        throw new Error('baidu_jsapi4_not_authorized')
      }
      return grant
    })
  }

  // An authenticated native BD09LL viewport is *not* a WGS84 photo
  // query, is not an SDK loader and never carries Browser AK or provider URLs.
  mediaBaiduNativeViewport(
    bounds: MediaBaiduNativeViewportBounds, limit = 64, offset = 0, signal?: AbortSignal,
  ) {
    if (!bounds || bounds.coordinate_space !== 'bd09ll' ||
        ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
        bounds.west < -180 || bounds.west > 180 ||
        bounds.east < -180 || bounds.east > 180 ||
        bounds.south < -90 || bounds.north > 90 ||
        bounds.south >= bounds.north || bounds.west === bounds.east ||
        (bounds.west === 180 && bounds.east === -180) ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) {
      return Promise.reject(new Error('Invalid BD09 native viewport'))
    }
    const q = new URLSearchParams({
      west: String(bounds.west), south: String(bounds.south),
      east: String(bounds.east), north: String(bounds.north),
      limit: String(limit), offset: String(offset),
    })
    return this.request<MediaBaiduNativeViewportPage>(
      `/api/v1/media/places/baidu-jsapi/viewport?${q.toString()}`,
      { signal, cache: 'no-store' },
    ).then(page => {
      if (page.coordinate_space !== 'bd09ll' ||
          page.index_scope !== 'explicit_opt_in_only' ||
          page.offset !== offset || page.limit !== limit ||
          !Number.isSafeInteger(page.total_count) || page.total_count < 0 ||
          !Array.isArray(page.items) || page.items.length > limit ||
          page.has_more !== (page.total_count > offset + page.items.length)) {
        throw new Error('Invalid BD09 native viewport response')
      }
      return page
    })
  }

  /** Signed runtime only: 8x8 bounded Owner BD09 aggregate, never Browser AK. */
  mediaBaiduNativeCells(bounds: MediaBaiduNativeViewportBounds, signal: AbortSignal) {
    if (!signal || signal.aborted || !bounds || bounds.coordinate_space !== 'bd09ll' ||
        ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
        bounds.west < -180 || bounds.west > 180 || bounds.east < -180 ||
        bounds.east > 180 || bounds.south < -90 || bounds.north > 90 ||
        bounds.south >= bounds.north || bounds.west === bounds.east ||
        (bounds.west === 180 && bounds.east === -180)) {
      return Promise.reject(new Error('Invalid BD09 cell bounds'))
    }
    const q = new URLSearchParams({
      west:String(bounds.west), south:String(bounds.south),
      east:String(bounds.east), north:String(bounds.north),
    })
    return this.request<MediaBaiduNativeCellsPage>(
      `/api/v1/media/places/baidu-jsapi/cells?${q.toString()}`,
      {signal,cache:'no-store'},
    ).then(page => {
      if (signal.aborted || !xDriveValidBaiduNativeCellsPage(page,bounds))
        throw new Error('Invalid BD09 cell response')
      return page
    })
  }

  /** Signed-Owner W1 cell-to-original-Gallery Range. Never a Provider SDK URL
   * or a general share-token /media/items access. */
  mediaBaiduNativeCellItems(
    selection: MediaBaiduNativeCellSelection,
    limit: number, offset: number,
    sort: XDriveBaiduCellRangeSort, signal: AbortSignal,
  ) {
    const query = xDriveBaiduNativeCellRangeParams(selection, limit, offset, sort)
    if (!query || signal?.aborted)
      return Promise.reject(new Error('Invalid or cancelled BD09 cell selection'))
    return this.request<MediaItemRange>(
      `/api/v1/media/places/baidu-jsapi/cell-items?${query.toString()}`,
      { signal, cache: 'no-store' },
    ).then(page => {
      if (signal.aborted || !xDriveValidBaiduNativeCellRangePage(page, limit, offset))
        throw new Error('Invalid or cancelled BD09 cell Range')
      return page
    })
  }

  mediaPlaces(limit = 24) {
    const query = new URLSearchParams({
      limit: String(Math.min(1000, Math.max(1, Math.trunc(limit)))),
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

  mediaDuplicateOrganizeApply(input: MediaDuplicateOrganizeApplyInput) {
    return this.request<MediaDuplicateOrganizeApplyResult>(
      '/api/v1/media/duplicate-organize/apply',
      { method: 'POST', body: JSON.stringify(input) },
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

  async mediaThumbnail(nodeID: number, signal?: AbortSignal, revision?: number, onProgress?: (loaded: number, total?: number, alphaMask?: string | null) => void, bypassHTTPCache = false): Promise<Blob> {
    await this.ensureFresh(signal)
    signal?.throwIfAborted()
    // Known source revisions get immutable browser-cache URL identities.
    // Album/Memory covers without a revision must revalidate the Server
    // ETag rather than reuse one hour of stale browser-cached pixels.
    const sourceRevision = Number.isSafeInteger(revision) && (revision ?? 0) > 0
      ? revision : undefined
    const revisionQuery = sourceRevision ? `&revision=${sourceRevision}` : ''
    const path = `/api/v1/media/items/${nodeID}/thumbnail?v=4${revisionQuery}`
    const send = (cacheOverride?: RequestCache) => fetch(`${API_BASE}${path}`, {
      cache: cacheOverride ?? (sourceRevision ? 'default' : 'no-cache'),
      headers: this.session.accessToken
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : undefined,
      signal,
    })
    // The shared Scheduler allows this only after a real browser <img> decode
    // error, on its NEXT visible mount, not from a speculative prefetch.
    // Preserve the exact authenticated path/revision and request AbortSignal.
    let response = await send(bypassHTTPCache ? 'no-store' : undefined)
    if (response.status === 401 && this.session.refreshToken) {
      await this.refresh(true, signal)
      signal?.throwIfAborted()
      response = await send(bypassHTTPCache ? 'no-store' : undefined)
    }
    // Only the Server-directed 503 path retries; never replay a permanent
    // missing/unsupported/revision-conflict result. One bounded retry max.
    // A Server-directed 503 already gets one bounded uncached retry.
    // Never turn that into a third request if its resulting bytes are bad.
    const retried503 = response.status === 503
    if (!bypassHTTPCache) {
      response = await xDriveThumbnailRetryAfter503(
        response, () => send('no-store'), signal,
      )
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.statusText || 'Thumbnail unavailable',
      )
    }
    let blob = await xDriveMediaResponseBlob(response, signal, onProgress, true)
    if (await xDriveThumbnailHasSafeImageEnvelope(blob, response.headers.get('Content-Type'), signal)) {
      return blob
    }
    if (retried503 || bypassHTTPCache) {
      // A forced uncached HTTP200 must not initiate yet another recovery
      // request: an actual DOM decoder will settle success/failure later.
      throw new ApiError(502, 'Invalid thumbnail image bytes')
    }
    // A formerly cached HTTP 200 may be broken although the Server's
    // canonical derivative has already recovered. Only this visible
    // request may bypass that cache, and at most once. No image onError
    // loop, source download, or second gallery/virtualization code path.
    signal?.throwIfAborted()
    try { onProgress?.(0, undefined, null) } catch { /* UI callbacks do not own I/O */ }
    signal?.throwIfAborted()
    response = await send('no-store')
    if (!response.ok) {
      throw new ApiError(
        response.status,
        response.statusText || 'Thumbnail unavailable',
      )
    }
    blob = await xDriveMediaResponseBlob(response, signal, onProgress, true)
    if (!(await xDriveThumbnailHasSafeImageEnvelope(blob, response.headers.get('Content-Type'), signal))) {
      throw new ApiError(502, 'Invalid thumbnail image bytes')
    }
    return blob
  }
  /**
   * Authenticated bounded JPEG derivative for RAW images whose canonical
   * originals cannot be safely opened through the binary preview-ticket API.
   */
  async mediaAnalysisPreview(nodeID: number, signal?: AbortSignal, revision?: number, onProgress?: (loaded: number, total?: number) => void): Promise<Blob> {
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
    const blob = await xDriveMediaResponseBlob(response, signal, onProgress)
    signal?.throwIfAborted()
    return blob
  }

  async mediaAnalysisPreviewURL(nodeID: number, signal?: AbortSignal, revision?: number, onProgress?: (loaded: number, total?: number) => void): Promise<string> {
    const blob = await this.mediaAnalysisPreview(nodeID, signal, revision, onProgress)
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

  deviceBackups() {
    return this.request<XDriveDeviceBackupOverview>('/api/v1/device-backups')
  }

  // Same redacted endpoint and keyset contract as Desktop's Go Client.
  deviceBackupsPage(limit = 100, afterDeviceID = '') {
    const params = new URLSearchParams({ limit: String(limit) })
    if (afterDeviceID) params.set('after_device_id', afterDeviceID)
    return this.request<XDriveDeviceBackupOverview>(`/api/v1/device-backups?${params.toString()}`)
  }

  // Only the redacted owner-scoped projection; shared MUI pagination is a
  // separate phase so older Server/Agent versions cannot claim complete data.
  deviceBackupFoldersPage(deviceID: string, limit = 100, afterSourceID = 0) {
    const params = new URLSearchParams({ device_id: deviceID, limit: String(limit) })
    if (afterSourceID > 0) params.set('after_source_id', String(afterSourceID))
    return this.request<XDriveDeviceBackupFolderPage>(`/api/v1/device-backups/folders?${params.toString()}`)
  }

  deviceBackupRunSummaries(sourceID: number, limit = 20, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    return this.request<XDriveDeviceBackupRunPage>(`/api/v1/device-backups/${sourceID}/runs?${params.toString()}`)
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

  sourceRunSkips(sourceID: number, runID: string, limit = 20, offset = 0) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    return this.request<ExternalSourceRunSkip[]>(
      `/api/v1/sources/${sourceID}/runs/${encodeURIComponent(runID)}/skips?${query.toString()}`,
    )
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

  /** Abortable shared Web/Mobile transport; does not directly mutate viewport. */
  childPosition(
    parentID: number, nodeID: number,
    sort: 'name' | 'updated' | 'size' | 'type' = 'name',
    order: 'asc' | 'desc' = 'asc',
    grouping: XDriveFileExplorerGrouping = { groupBy: 'none', foldersFirst: true },
    signal?: AbortSignal,
  ): Promise<XDriveCloudFilesPosition> {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(parentID) || parentID <= 0 ||
        !Number.isSafeInteger(nodeID) || nodeID <= 0) {
      return Promise.reject(new Error('无效的文件夹或文件 ID'))
    }
    const query = new URLSearchParams({ node_id: String(nodeID), sort, order })
    appendFileExplorerGrouping(query, grouping)
    return this.request<XDriveCloudFilesPosition>(
      `/api/v1/nodes/${parentID}/children/position?${query.toString()}`,
      { signal },
    ).then((position) => {
      if (!xDriveCloudFilesPositionMatchesRequest(position, {
        nodeID, sort, order, grouping,
      })) throw new Error('文件位置结果已过期或不匹配')
      return position
    })
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
    signal?: AbortSignal,
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
    }>(`/api/v1/search?${params.toString()}`, { signal })
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

  uploadConflictPreflight(parentID: number, name: string, signal?: AbortSignal) {
    return this.request<XDriveUploadConflictPreflight>('/api/v1/uploads/preflight', {
      method: 'POST',
      body: JSON.stringify({ parent_id: parentID, name }),
      signal,
    })
  }

  async uploadConflictPreflightBatch(
    items: readonly { parent_id: number; name: string }[],
    signal?: AbortSignal,
  ) {
    const result = await this.request<{ items: XDriveUploadConflictPreflight[] }>(
      '/api/v1/uploads/preflight/batch',
      { method: 'POST', body: JSON.stringify({ items }), signal },
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
    groupID = '',
    expectedResumeManifestSHA256 = '',
  ): Promise<XDriveUploadResult> {
    const session = this.transferContext()
    const managedExternally = Boolean(transferID)
    const activeTransferID = transferID || webTransferStore.create({
      fileName: file.name,
      path: file.name,
      cloudParentID: parentID,
      kind: 'upload',
      bytesTotal: file.size,
      speedSource: 'client',
      resumeFileLastModified: conflictPolicy === 'fail' ? file.lastModified : undefined,
      resumeConflictPolicy: conflictPolicy === 'fail' ? 'fail' : undefined,
    })
    const owned = managedExternally ? null : this.cancellableTransferContext(activeTransferID, session)
    const groupOwner = groupID ? webUploadGroupOwners.get(groupID) : undefined
    if (groupID && !groupOwner) throw xDriveTransferAbortError()
    const tracking = groupOwner?.tracking ?? owned?.tracking ?? session
    webTransferStore.trackNetwork(activeTransferID, 'client')
    const reportProgress = (completed: number) => {
      tracking.check()
      if (!managedExternally) webTransferStore.progress(activeTransferID, completed, file.size)
      onProgress?.(file.size === 0 ? 100 : Math.round((completed / file.size) * 100))
    }

    try {
      tracking.check()
      // The shared folder controller owns the child's terminal state, but
      // only this Web transport knows its trustworthy cloud destination and
      // original File metadata. Bind them to the existing child before I/O.
      // Never persist the File/Blob, local absolute path or upload session key.
      if (managedExternally && groupID && conflictPolicy === 'fail') {
        webTransferStore.setUploadResumeContext(
          activeTransferID, groupID, parentID, file.name, file.size, file.lastModified,
        )
      }
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

      // A small ordered chunk-manifest digest binds a resumed file to its
      // original bytes before any Server mutation or resumed chunk request.
      const manifestSHA256 = await sha256Buffer(
        new TextEncoder().encode(chunkHashes.join('\n')).buffer,
      )
      tracking.check()
      if (expectedResumeManifestSHA256 &&
          manifestSHA256 !== expectedResumeManifestSHA256) {
        throw new Error('所选文件内容与原上传不同；未向服务器发起续传请求。')
      }
      if (conflictPolicy === 'fail' && (!managedExternally || Boolean(groupID))) {
        // Only a matching, active child with its cloud parent bound can retain
        // this digest; destructive conflict modes are never resumeable.
        webTransferStore.setUploadResumeManifest(activeTransferID, manifestSHA256)
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
      if (!managedExternally && !session.signal.aborted) {
        if (owned?.requestedByUser()) webTransferStore.finishLifecycle(activeTransferID, { state: 'cancelled' })
        else webTransferStore.fail(activeTransferID, error)
      } else if (managedExternally && groupID && !session.signal.aborted && !tracking.signal.aborted) {
        // The group controller still finalizes the child and parent. Preserve
        // only this failed child's validated resume identity before that
        // terminal receipt; never relabel a cancelled group as a failure.
        webTransferStore.fail(activeTransferID, error)
      }
      throw error
    } finally {
      owned?.release()
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
    return this.request<CreatedFileShare>(`/api/v1/nodes/${nodeID}/shares`, {
      method: 'POST',
      body: JSON.stringify({
        expires_at: input.expires_at || null,
        password: input.password || '',
        max_downloads: input.max_downloads ?? 0,
      }),
    })
  }

  shares(nodeID: number) {
    return this.request<FileShare[]>(`/api/v1/nodes/${nodeID}/shares`)
  }

  revokeShare(shareID: number) {
    return this.request<void>(`/api/v1/shares/${shareID}`, { method: 'DELETE' })
  }

  publicShare(token: string, signal?: AbortSignal) {
    return this.request<PublicShare>('/api/v1/public/share', {
      headers: { 'X-XDrive-Share-Token': token },
      signal,
    }, false)
  }

  publicShareChildren(token: string, password: string, parentID: number, cursor = 0, signal?: AbortSignal) {
    return this.request<PublicShareChildren>('/api/v1/public/share/children', {
      method: 'POST',
      headers: { 'X-XDrive-Share-Token': token },
      body: JSON.stringify({ password, parent_id: parentID, cursor }),
      signal,
    }, false)
  }

  // Share-only, revision-scoped cached derivative. Never use account thumbnail
  // endpoints or the original 32MiB public-image-preview endpoint for tiles.
  async publicShareThumbnailURL(token: string, password: string, nodeID: number, revision?: number, signal?: AbortSignal) {
    const ticket = await this.request<{ url: string; expires_at: string; mime_type: string }>(
      '/api/v1/public/share/thumbnail-ticket', {
        method: 'POST',
        headers: { 'X-XDrive-Share-Token': token },
        body: JSON.stringify({ password, node_id: nodeID, revision: revision ?? 0 }),
        signal,
      }, false,
    )
    signal?.throwIfAborted()
    if (!['image/jpeg', 'image/png'].includes(ticket.mime_type)) {
      throw new ApiError(415, 'Unsupported public cached thumbnail type')
    }
    const response = await fetch(this.nativeDownloadURL(ticket.url), {
      signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) {
      if (response.status === 404 || response.status === 415) return null
      throw new ApiError(response.status, 'Shared cached thumbnail unavailable')
    }
    const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
    if (mime !== ticket.mime_type) throw new ApiError(415, 'Public thumbnail MIME mismatch')
    const sizeLimit = 4 * 1024 * 1024
    const declaredSize = Number(response.headers.get('Content-Length') || 0)
    if (declaredSize > sizeLimit) throw new ApiError(413, 'Public thumbnail body too large')
    const blob = await response.blob()
    signal?.throwIfAborted()
    if (blob.size > sizeLimit || !await xDriveThumbnailHasSafeImageEnvelope(blob, mime, signal)) {
      throw new ApiError(415, 'Public thumbnail image bytes are invalid')
    }
    return URL.createObjectURL(blob)
  }

  // Public-only, short-lived image preview purpose: never use Owner JWT or download ticket.
  async publicShareImagePreviewURL(token: string, password: string, nodeID = 0, signal?: AbortSignal) {
    const ticket = await this.request<{ url: string; expires_at: string; mime_type: string }>(
      '/api/v1/public/share/preview-ticket', {
        method: 'POST',
        headers: { 'X-XDrive-Share-Token': token },
        body: JSON.stringify({ password, node_id: nodeID }),
        signal,
      }, false,
    )
    signal?.throwIfAborted()
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(ticket.mime_type)) {
      throw new ApiError(415, 'Unsupported public image preview type')
    }
    // This is a bounded explicit raster preview only, not the durable
    // download/ZIP path. The same AbortSignal now owns ticket POST and
    // actual image GET, so closing a Viewer cancels Go request work.
    const response = await fetch(this.nativeDownloadURL(ticket.url), {
      signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) throw new ApiError(response.status, 'Shared image preview unavailable')
    const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
    if (mime !== ticket.mime_type) throw new ApiError(415, 'Public image preview MIME mismatch')
    const declaredSize = Number(response.headers.get('Content-Length') || 0)
    if (declaredSize > 32 * 1024 * 1024) throw new ApiError(413, 'Public image preview is too large')
    const image = await response.blob()
    signal?.throwIfAborted()
    if (image.size > 32 * 1024 * 1024) throw new ApiError(413, 'Public image preview is too large')
    return URL.createObjectURL(image)
  }

  async downloadPublicShare(token: string, password: string, filename: string, nodeID?: number) {
    const response = await fetch(
      `${API_BASE}/api/v1/public/share/download-ticket`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XDrive-Share-Token': token,
        },
        body: JSON.stringify({ password, node_id: nodeID ?? 0 }),
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

  // The public archive is a separate capability: no Owner FileExplorer API,
  // account authorization, saved share password or bearer in a download URL.
  preparePublicShareArchive(token: string, password: string, signal?: AbortSignal, folderID = 0) {
    // A nested folder is a Share-only selection; never invoke the Owner ZIP API.
    return this.request<PublicShareArchivePrepare>('/api/v1/public/share/archive/prepare', {
      method: 'POST',
      headers: { 'X-XDrive-Share-Token': token },
      body: JSON.stringify(folderID ? { password, folder_id: folderID } : { password }),
      signal,
    }, false)
  }

  publicShareArchiveStatus(token: string, password: string, prepareID: string, signal?: AbortSignal) {
    return this.request<PublicShareArchivePrepare>('/api/v1/public/share/archive/status', {
      method: 'POST',
      headers: { 'X-XDrive-Share-Token': token },
      body: JSON.stringify({ password, prepare_id: prepareID }),
      signal,
    }, false)
  }

  cancelPublicShareArchive(token: string, password: string, prepareID: string) {
    return this.request<PublicShareArchivePrepare>('/api/v1/public/share/archive/cancel', {
      method: 'POST',
      headers: { 'X-XDrive-Share-Token': token },
      body: JSON.stringify({ password, prepare_id: prepareID }),
    }, false)
  }

  async downloadPublicShareArchive(token: string, password: string, prepareID: string, filename: string, signal?: AbortSignal) {
    const ticket = await this.request<AuthenticatedDownloadTicket>(
      '/api/v1/public/share/archive/download-ticket', {
        method: 'POST',
        headers: { 'X-XDrive-Share-Token': token },
        body: JSON.stringify({ password, prepare_id: prepareID }),
        signal,
      }, false,
    )
    signal?.throwIfAborted()
    // The browser saves the streamed ZIP directly, never buffers a whole
    // 100k-file ZIP in renderer JS/OPFS memory.
    xDriveStartBrowserDownload(this.nativeDownloadURL(ticket.url), filename)
  }

  downloadURL(nodeID: number) {
    return `${API_BASE}/api/v1/files/${nodeID}/content`
  }

  private nativeDownloadURL(path: string) {
    return `${API_BASE}${path}`
  }

  private async startNativeDownload(
    ticketPath: string, filename: string, bytesTotal = 0,
    cloudParentID?: number, cloudNodeID?: number,
  ) {
    const tracking = this.transferContext()
    const transferID = webTransferStore.create({
      fileName: filename,
      cloudParentID,
      cloudNodeID,
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

  /**
   * Optional mobile system file share, separate from xDrive's share-link dialog.
   * A second explicit user tap invokes navigator.share() after the bounded bytes
   * have been prepared; we must not assume a network await retains activation.
   */
  async prepareNativeShareFile(nodeID: number, signal?: AbortSignal): Promise<File> {
    if (!Number.isSafeInteger(nodeID) || nodeID <= 0) throw new Error('无效的分享文件。')
    const lifecycleEpoch = this.transferSessionEpoch
    const node = await this.request<Node>(`/api/v1/nodes/${nodeID}`, { signal })
    signal?.throwIfAborted()
    if (node.id !== nodeID || node.type !== 'file') throw new Error('文件不存在或类型已变化。')
    if (!Number.isSafeInteger(node.size) || node.size < 0) throw new Error('无法确认文件大小，请使用下载或分享链接。')
    if (node.size > XDRIVE_NATIVE_SHARE_MAX_BYTES) {
      throw new Error('文件超过 16 MiB，请使用下载或分享链接。')
    }

    await this.ensureFresh(signal)
    signal?.throwIfAborted()
    const send = () => fetch(`${API_BASE}/api/v1/files/${nodeID}/content`, {
      cache: 'no-store',
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
    if (!response.ok) throw new ApiError(response.status, response.statusText || '文件内容读取失败')
    const blob = await xDriveReadBoundedNativeShareBlob(response, signal)
    signal?.throwIfAborted()
    if (lifecycleEpoch !== this.transferSessionEpoch) throw xDriveTransferAbortError()
    if (blob.size !== node.size) throw new Error('文件已发生变化，请刷新后重新分享。')
    const modified = Date.parse(node.updated_at ?? '')
    return new File([blob], node.name, {
      type: blob.type || 'application/octet-stream',
      lastModified: Number.isFinite(modified) ? modified : Date.now(),
    })
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
          node.parent_id,
          node.id,
        )
      }
      await this.downloadAuthenticated(
        `/api/v1/files/${node.id}/versions/${version.id}/content`,
        node.name,
        {},
        true,
        downloadSink,
        '',
        node.parent_id,
        node.id,
        version.size,
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
          node.parent_id,
          node.id,
        )
      }
      await this.downloadAuthenticated(
        `/api/v1/files/${node.id}/content`,
        node.name,
        {},
        true,
        downloadSink,
        '',
        node.parent_id,
        node.id,
        node.size,
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
    cloudParentID?: number,
    cloudNodeID?: number,
    expectedContentBytes?: number,
  ) {
    const session = this.transferContext()
    const transferID = trackTransfer ? webTransferStore.create({
      fileName: filename,
      path: filename,
      cloudParentID,
      cloudNodeID,
      kind: 'download',
      speedSource: 'client',
    }) : ''
    const owned = transferID ? this.cancellableTransferContext(transferID, session) : null
    const tracking = owned?.tracking ?? session
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

      const lengthHeader = response.headers.get('Content-Length')
      const declaredLength = lengthHeader === null ? undefined : Number(lengthHeader)
      const contentEncoding = (response.headers.get('Content-Encoding') || '').trim().toLowerCase()
      // Fetch yields decoded body bytes; compressed wire size is not file size.
      const identityEncoded = contentEncoding === '' || contentEncoding === 'identity'
      const plainContentLength = identityEncoded && typeof declaredLength === 'number' &&
        Number.isSafeInteger(declaredLength) && declaredLength >= 0 ? declaredLength : undefined
      if (expectedContentBytes !== undefined &&
          (!Number.isSafeInteger(expectedContentBytes) || expectedContentBytes < 0)) {
        throw new Error('无法确认预期下载大小，已终止保存。')
      }
      // Node/version size is authoritative even if a proxy omits Content-Length.
      // Archive uses an identity-encoded response length when available.
      const exactExpectedBytes = expectedContentBytes ?? plainContentLength
      const total = exactExpectedBytes ?? 0
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
          exactExpectedBytes,
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

        if (exactExpectedBytes !== undefined && completed !== exactExpectedBytes) {
          throw new Error('下载内容长度不一致，已终止保存。')
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
      if (trackTransfer && !session.signal.aborted) {
        transferProgress?.flush()
        if (owned?.requestedByUser()) webTransferStore.finishLifecycle(transferID, { state: 'cancelled' })
        else webTransferStore.fail(transferID, error)
      }
      throw error
    } finally {
      owned?.release()
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
