import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { XDriveFeedbackSnackbar } from './FeedbackSnackbar'
import { XDriveSourceCreateDialog } from './SourceManagerCreateDialog'
import { XDriveSourceManagerListPage } from './SourceManagerListPage'
import { XDriveSourceCloudCleanupDialog } from './SourceCloudCleanupDialog'
import type { XDriveSourceCreateValues } from './SourceManagerCreateDialog'
import { XDriveSourceSettingsDialog } from './SourceManagerSettingsDialog'
import type { XDriveSourceSettingsValues } from './SourceManagerSettingsDialog'
import {
  XDriveSourceClearCredentialDialog,
  XDriveSourceDeleteConfirmDialog,
  XDriveSourceErrorDialog,
  XDriveSourceFailedItemsDialog,
} from './SourceManagerDialogs'
import type { XDriveSourceErrorDialogState } from './SourceManagerDialogs'
import { XDriveSourceDetailsDialog } from './SourceManagerDetailsDialog'
import type {
  XDriveSourceCollectionItemPage,
  XDriveSourceDetailReadState,
  XDriveSourceRunFailurePage,
  XDriveSourceRunSkipPage,
} from './SourceManagerDetailsDialog'
import {
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCredentialLabel,
  externalSourceCredentialTestErrorLabel,
  externalSourceDefaults,
  externalSourceDisplayName,
  isReadOnlySynologySource,
  isNativePhotoSource,
  normalizeSynologyFileRoots,
  normalizeSynologyPhotoSpaces,
  synologyFileRootsValidationError,
} from '../external-sources'
import type {
  CreateExternalSourceInput,
  ExternalSource,
  ExternalSourceCloudCleanupPreview,
  ExternalSourceBrowsePage,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceConnectorConfig,
  ExternalSourceCreatePreset,
  ExternalSourceCredentialReveal,
  ExternalSourceCredentialStatus,
  ExternalSourceCredentialTestResult,
  ExternalSourceItem,
  ExternalSourceOverview,
  ExternalSourceRow,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  ExternalSourceRunSkip,
  SynologyPhotoSpace,
  SupportedExternalSourceKind,
  UpdateExternalSourceInput,
} from '../external-sources'

export interface XDriveSourceManagerAdapter {
  authorizeLocalFolder?(sourceID: number): Promise<{ cancelled: boolean; grant?: { root_id: string; path: string; status: string } }>
  me?(): Promise<{ username: string }>
  suggestedPushName?(): Promise<string>
  sourceOverview(signal?: AbortSignal, includeArchived?: boolean): Promise<ExternalSourceOverview[]>
  restoreSource?(sourceID: number, revision: number): Promise<ExternalSource>
  sourceCloudCleanupPreview?(sourceID: number): Promise<ExternalSourceCloudCleanupPreview>
  trashSourceCloudCleanup?(preview: ExternalSourceCloudCleanupPreview, confirmName: string): Promise<unknown>
  canRestoreSource?(row: ExternalSourceRow): boolean
  canDeleteSource?(row: ExternalSourceRow): boolean
  createSource(input: CreateExternalSourceInput): Promise<ExternalSource>
  triggerSource(sourceID: number): Promise<ExternalSource>
  sourceRuns(sourceID: number, limit?: number, offset?: number): Promise<ExternalSourceRun[]>
  sourceRunFailures(sourceID: number, runID: string, limit?: number, offset?: number): Promise<ExternalSourceRunFailure[]>
  sourceRunSkips(sourceID: number, runID: string, limit?: number, offset?: number): Promise<ExternalSourceRunSkip[]>
  cancelSourceRun(sourceID: number, runID: string): Promise<ExternalSourceRun>
  sourceItems(sourceID: number, state?: string, limit?: number, offset?: number): Promise<ExternalSourceItem[]>
  sourceCollections(sourceID: number, state?: string): Promise<ExternalSourceCollection[]>
  sourceCollectionItems(sourceID: number, collectionID: number, limit?: number, offset?: number): Promise<ExternalSourceCollectionItem[]>
  revealSourceCredential(sourceID: number): Promise<ExternalSourceCredentialReveal>
  testSourceCredential(kind: string, payload: Record<string, unknown>): Promise<ExternalSourceCredentialTestResult>
  testStoredSourceCredential(sourceID: number): Promise<ExternalSourceCredentialTestResult>
  updateSource(sourceID: number, revision: number, input: UpdateExternalSourceInput): Promise<ExternalSource>
  deleteSource(sourceID: number, revision: number): Promise<unknown>
  setSourceCredential(sourceID: number, payload: Record<string, unknown>): Promise<ExternalSourceCredentialStatus>
  deleteSourceCredential(sourceID: number): Promise<unknown>
  sourceConnectorConfig(sourceID: number): Promise<ExternalSourceConnectorConfig>
  sourceBrowseDirectories(sourceID: number, path?: string, limit?: number, offset?: number): Promise<ExternalSourceBrowsePage>
  setSourceConnectorConfig(sourceID: number, revision: number, payload: Record<string, unknown>): Promise<ExternalSourceConnectorConfig>
}

export interface XDriveSourceTargetNode {
  id: number
  name: string
  path?: string
}

export interface XDriveSourceTargetBrowser {
  root(): Promise<XDriveSourceTargetNode>
  children(parentID: number): Promise<XDriveSourceTargetNode[]>
}

export interface XDriveSourceManagerProps {
  adapter: XDriveSourceManagerAdapter
  directionFilter?: 'pull'
  initialSourceID?: number
  // One notification may be clicked repeatedly; requestID scopes the focus.
  focusedRun?: { sourceID: number; runID: string; requestID: number }
  defaultTargetNodeID?: number
  defaultTargetLabel: string
  defaultTargetPath: string
  targetBrowser?: XDriveSourceTargetBrowser
  cookieHelpVariant?: 'accordion' | 'dialog'
  onSelectedSourceChange?: (sourceID?: number) => void
  onError: (error: unknown) => void
}

function sourceErrorDetail(error: unknown) {
  if (!error || typeof error !== 'object' || !('detail' in error)) return ''
  const detail = (error as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : ''
}

const SOURCE_HISTORY_PAGE_SIZE = 20
const SOURCE_RUN_FAILURE_PAGE_SIZE = 20
const SOURCE_COLLECTION_ITEM_PAGE_SIZE = 50
const SOURCE_RUNNING_POLL_MS = 2000
const SOURCE_REQUESTED_POLL_MS = 5000

function sourceActivityPollDelay(rows: ExternalSourceRow[]) {
  if (rows.some((row) => row.latestRun?.status === 'running')) return SOURCE_RUNNING_POLL_MS
  if (rows.some((row) => row.source.run_requested_at)) return SOURCE_REQUESTED_POLL_MS
  return null
}

function selectedSourcePollDelay(row: ExternalSourceRow | null) {
  if (!row) return null
  if (row.latestRun?.status === 'running') return SOURCE_RUNNING_POLL_MS
  if (row.source.run_requested_at) return SOURCE_REQUESTED_POLL_MS
  return null
}

function sourceActionErrorMessage(error: unknown, fallback: string) {
  const value = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error ?? '').trim()
  if (!value || value === '[object Object]') return fallback
  return externalSourceCredentialTestErrorLabel(
    value,
    sourceErrorDetail(error),
  )
}

function initialCreateSourceValues(preset: ExternalSourceCreatePreset = 'yike_pull'): XDriveSourceCreateValues {
  const option = externalSourceCreateOption(preset)
  const defaults = externalSourceDefaults(option.kind, option.direction)
  return {
    preset,
    name: defaults.name,
    sync_mode: 'backup',
    run_mode: defaults.runMode,
    schedule_type: defaults.scheduleType,
    schedule_expression: defaults.scheduleExpression,
    schedule_timezone: defaults.scheduleTimezone,
    ignore_rules: defaults.ignoreRules,
    cookie: '',
    base_url: '',
    username: '',
    password: '',
    spaces: ['personal', 'shared'],
    roots: [],
  }
}

function emptySourceSettingsValues(): XDriveSourceSettingsValues {
  return {
    name: '',
    sync_mode: 'backup',
    run_mode: 'sync',
    status: 'active',
    schedule_type: 'interval',
    schedule_expression: '6h',
    schedule_timezone: 'UTC',
    ignore_rules: '',
    cookie: '',
    base_url: '',
    username: '',
    password: '',
    spaces: ['personal', 'shared'],
    roots: [],
  }
}

export function XDriveSourceManager({
  adapter,
  directionFilter,
  initialSourceID,
  focusedRun,
  cookieHelpVariant = 'accordion',
  onSelectedSourceChange,
  onError,
}: XDriveSourceManagerProps) {
  const sourceNoun = directionFilter === 'pull' ? '拉取来源' : '来源'
  // Only the owning Agent can configure local-folder Push. Remote Sources use Yike Pull.
  const defaultCreatePreset: ExternalSourceCreatePreset =
    directionFilter === 'pull' ? 'yike_pull' : adapter.authorizeLocalFolder ? 'local_push' : 'yike_pull'
  const [rows, setRows] = useState<ExternalSourceRow[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [restoringSourceID, setRestoringSourceID] = useState<number | null>(null)
  const initialSourceOpenedRef = useRef<number | null>(null)
  const focusedRequestOpenedRef = useRef<number | null>(null)
  const focusedRunDetailsFetchedRef = useRef('')
  // The initial source overview has no authoritative zero count yet.
  // Never flash "尚未添加" before the first authenticated response.
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [selected, setSelected] = useState<ExternalSourceRow | null>(null)
  const [failedItems, setFailedItems] = useState<ExternalSourceItem[]>([])
  const [failedItemsLoading, setFailedItemsLoading] = useState(false)
  const [failedItemsOpen, setFailedItemsOpen] = useState(false)
  const [failedItemsLimitReached, setFailedItemsLimitReached] = useState(false)
  const [historyRuns, setHistoryRuns] = useState<ExternalSourceRun[]>([])
  const [focusedRunID, setFocusedRunID] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyHasNext, setHistoryHasNext] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyReadState, setHistoryReadState] = useState<XDriveSourceDetailReadState>('unverified')
  // Source details identity and per-request generations prevent an old
  // account/Source/Agent reply from repopulating a newly selected dialog.
  const detailScopeRef = useRef(0)
  const historyRequestRef = useRef(0)
  const collectionItemRequestRef = useRef<Record<number, number>>({})
  const [runFailurePages, setRunFailurePages] = useState<Record<string, XDriveSourceRunFailurePage>>({})
  const [runSkipPages, setRunSkipPages] = useState<Record<string, XDriveSourceRunSkipPage>>({})
  const [collections, setCollections] = useState<ExternalSourceCollection[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionsReadState, setCollectionsReadState] = useState<XDriveSourceDetailReadState>('unverified')
  const [collectionItemPages, setCollectionItemPages] = useState<Record<number, XDriveSourceCollectionItemPage>>({})
  const [setting, setSetting] = useState<ExternalSourceRow | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsValues, setSettingsValues] = useState<XDriveSourceSettingsValues>(emptySourceSettingsValues)
  const [settingsNameError, setSettingsNameError] = useState('')
  const [settingsSpacesError, setSettingsSpacesError] = useState('')
  const [settingsRootsError, setSettingsRootsError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const createNameEditedRef = useRef(false)
  const [creating, setCreating] = useState(false)
  const [triggeringSourceID, setTriggeringSourceID] = useState<number | null>(null)
  const [cancellingRunID, setCancellingRunID] = useState<string | null>(null)
  const [testingCreateCredential, setTestingCreateCredential] = useState(false)
  const [createCredentialTest, setCreateCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [createCredentialTestError, setCreateCredentialTestError] = useState('')
  const [testingSettingsCredential, setTestingSettingsCredential] = useState(false)
  const [revealingSettingsCredential, setRevealingSettingsCredential] = useState(false)
  const [settingsCredentialReveal, setSettingsCredentialReveal] = useState<ExternalSourceCredentialReveal | null>(null)
  const [settingsCredentialTest, setSettingsCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [settingsCredentialTestError, setSettingsCredentialTestError] = useState('')
  const [cleanupPreview, setCleanupPreview] = useState<ExternalSourceCloudCleanupPreview | null>(null)
  const [cleanupPreparingSourceID, setCleanupPreparingSourceID] = useState<number | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ExternalSourceRow | null>(null)
  const [deletingSourceID, setDeletingSourceID] = useState<number | null>(null)
  const [errorDialog, setErrorDialog] = useState<XDriveSourceErrorDialogState | null>(null)
  const [feedback, setFeedback] = useState('')
  const [clearCookieConfirmOpen, setClearCookieConfirmOpen] = useState(false)
  const [clearingCookie, setClearingCookie] = useState(false)
  const [settingsConnectorConfig, setSettingsConnectorConfig] = useState<ExternalSourceConnectorConfig | null>(null)
  const [settingsConnectorLoading, setSettingsConnectorLoading] = useState(false)
  const [settingsConnectorError, setSettingsConnectorError] = useState('')
  const settingsSessionRef = useRef(0)
  const [createValues, setCreateValues] = useState<XDriveSourceCreateValues>(() => initialCreateSourceValues(defaultCreatePreset))
  const [createNameError, setCreateNameError] = useState('')
  const [createSpacesError, setCreateSpacesError] = useState('')
  const [createRootsError, setCreateRootsError] = useState('')
  const createPreset = createValues.preset
  const createOption = externalSourceCreateOption(createPreset)
  const createProfile = externalSourceConnectorProfile(createOption.kind, createOption.direction)

  const settingsSourceID = setting?.source.id
  const settingsBrowseDirectories = setting?.credential?.configured && settingsSourceID !== undefined
    ? (path: string, limit?: number, offset?: number) => adapter.sourceBrowseDirectories(settingsSourceID, path, limit, offset)
    : undefined

  const showActionError = (title: string, error: unknown, fallback: string, detail?: string) => {
    setErrorDialog({
      title,
      message: sourceActionErrorMessage(error, fallback),
      detail,
    })
  }

  // Source overview is a disposable *read*. A new accepted refresh, Owner,
  // route, or visible polling generation revokes only this GET; authenticated
  // Source runs, cancellation commands and configuration writes stay durable.
  const overviewReadRef = useRef<AbortController | null>(null)
  const overviewRequestRef = useRef(0)
  const overviewMountedRef = useRef(false)
  const overviewVisibleReadRef = useRef(false)
  const overviewOwnerRef = useRef({ adapter, directionFilter, showArchived })
  overviewOwnerRef.current = { adapter, directionFilter, showArchived }

  const load = useCallback(async (silent = false) => {
    if (!overviewMountedRef.current) return
    overviewReadRef.current?.abort()
    const controller = new AbortController()
    overviewReadRef.current = controller
    const request = ++overviewRequestRef.current
    // A silent poll can supersede a still-pending visible first read.
    // Inherit the obligation to settle its Loading/Error presentation.
    const visibleRead = !silent || overviewVisibleReadRef.current
    overviewVisibleReadRef.current = visibleRead
    const valid = () => (
      overviewMountedRef.current &&
      !controller.signal.aborted &&
      overviewRequestRef.current === request &&
      overviewOwnerRef.current.adapter === adapter &&
      overviewOwnerRef.current.directionFilter === directionFilter &&
      overviewOwnerRef.current.showArchived === showArchived
    )
    if (!silent) {
      setLoading(true)
    }
    try {
      const overview = await adapter.sourceOverview(controller.signal, showArchived)
      if (!valid()) return
      const next: ExternalSourceRow[] = overview
        .filter((item) => directionFilter !== 'pull' || item.source.direction === 'pull')
        .map((item) => ({
        source: item.source,
        latestRun: item.latest_run,
        credential: item.credential,
      }))
      setRows(next)
      if (visibleRead) setLoadError(false)
      setSelected((current) => current
        ? next.find((row) => row.source.id === current.source.id) ?? current
        : null)
    } catch (error) {
      if (!valid()) return
      // Keep previously accepted rows on refresh failure. On the first
      // request, report a genuine error rather than claiming zero sources.
      if (visibleRead) setLoadError(true)
      onError(error)
    } finally {
      if (overviewReadRef.current === controller) overviewReadRef.current = null
      if (valid() && visibleRead) {
        overviewVisibleReadRef.current = false
        setHasLoaded(true)
        setLoading(false)
      }
    }
  }, [adapter, directionFilter, onError, showArchived])

  const loadRunFailures = useCallback(async (sourceID: number, runID: string, page = 1) => {
    const isIOSPhotoSource = (selected?.source.id === sourceID &&
      selected.source.kind === 'ios_photos') ||
      rows.some((row) => row.source.id === sourceID && row.source.kind === 'ios_photos')
    if (isIOSPhotoSource) {
      setRunFailurePages((current) => ({
        ...current,
        [runID]: { items: [], page: 1, hasNext: false, loading: false, loaded: true },
      }))
      return
    }
    const nextPage = Math.max(1, Math.trunc(page))
    setRunFailurePages((current) => ({
      ...current,
      [runID]: {
        items: current[runID]?.items ?? [],
        page: current[runID]?.page ?? nextPage,
        hasNext: current[runID]?.hasNext ?? false,
        loading: true,
        loaded: current[runID]?.loaded ?? false,
      },
    }))
    try {
      const offset = (nextPage - 1) * SOURCE_RUN_FAILURE_PAGE_SIZE
      const failures = await adapter.sourceRunFailures(sourceID, runID, SOURCE_RUN_FAILURE_PAGE_SIZE + 1, offset)
      setRunFailurePages((current) => ({
        ...current,
        [runID]: {
          items: failures.slice(0, SOURCE_RUN_FAILURE_PAGE_SIZE),
          page: nextPage,
          hasNext: failures.length > SOURCE_RUN_FAILURE_PAGE_SIZE,
          loading: false,
          loaded: true,
        },
      }))
    } catch (error) {
      setRunFailurePages((current) => ({
        ...current,
        [runID]: {
          items: current[runID]?.items ?? [],
          page: current[runID]?.page ?? nextPage,
          hasNext: current[runID]?.hasNext ?? false,
          loading: false,
          loaded: current[runID]?.loaded ?? false,
        },
      }))
      onError(error)
    }
  }, [adapter, onError, rows, selected?.source.id, selected?.source.kind])

  const loadRunSkips = useCallback(async (sourceID: number, runID: string, page = 1) => {
    const nextPage = Math.max(1, Math.trunc(page))
    setRunSkipPages((current) => ({
      ...current,
      [runID]: {
        items: current[runID]?.items ?? [],
        page: current[runID]?.page ?? nextPage,
        hasNext: current[runID]?.hasNext ?? false,
        loading: true,
        loaded: current[runID]?.loaded ?? false,
      },
    }))
    try {
      const offset = (nextPage - 1) * SOURCE_RUN_FAILURE_PAGE_SIZE
      const skips = await adapter.sourceRunSkips(sourceID, runID, SOURCE_RUN_FAILURE_PAGE_SIZE + 1, offset)
      setRunSkipPages((current) => ({
        ...current,
        [runID]: {
          items: skips.slice(0, SOURCE_RUN_FAILURE_PAGE_SIZE),
          page: nextPage,
          hasNext: skips.length > SOURCE_RUN_FAILURE_PAGE_SIZE,
          loading: false,
          loaded: true,
        },
      }))
    } catch (error) {
      setRunSkipPages((current) => ({
        ...current,
        [runID]: {
          items: current[runID]?.items ?? [],
          page: current[runID]?.page ?? nextPage,
          hasNext: current[runID]?.hasNext ?? false,
          loading: false,
          loaded: current[runID]?.loaded ?? false,
        },
      }))
      onError(error)
    }
  }, [adapter, onError])

  useEffect(() => {
    overviewMountedRef.current = true
    void load()
    return () => {
      overviewMountedRef.current = false
      overviewReadRef.current?.abort()
      overviewReadRef.current = null
      overviewVisibleReadRef.current = false
      overviewRequestRef.current += 1
    }
  }, [load])

  useEffect(() => {
    const delay = sourceActivityPollDelay(rows)
    if (delay === null) return

    let stopped = false
    let timer = 0
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        await load(true)
      }
      if (!stopped && document.visibilityState === 'visible') {
        timer = window.setTimeout(() => { void tick() }, delay)
      }
    }
    const schedule = (immediate = false) => {
      window.clearTimeout(timer)
      if (stopped || document.visibilityState !== 'visible') return
      timer = window.setTimeout(() => { void tick() }, immediate ? 0 : delay)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') schedule(true)
      else window.clearTimeout(timer)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [rows, load])
  const loadRunHistory = useCallback(async (sourceID: number, page: number, silent = false) => {
    const nextPage = Math.max(1, Math.trunc(page))
    const scope = detailScopeRef.current
    const request = ++historyRequestRef.current
    if (!silent) setHistoryLoading(true)
    try {
      const offset = (nextPage - 1) * SOURCE_HISTORY_PAGE_SIZE
      const runs = await adapter.sourceRuns(sourceID, SOURCE_HISTORY_PAGE_SIZE + 1, offset)
      if (detailScopeRef.current !== scope || historyRequestRef.current !== request) return
      setHistoryRuns(runs.slice(0, SOURCE_HISTORY_PAGE_SIZE))
      setHistoryHasNext(runs.length > SOURCE_HISTORY_PAGE_SIZE)
      setHistoryPage(nextPage)
      setHistoryReadState('ready')
    } catch (error) {
      if (detailScopeRef.current !== scope || historyRequestRef.current !== request) return
      setHistoryReadState((previous) => previous === 'ready' ? previous : 'error')
      onError(error)
    } finally {
      if (!silent && detailScopeRef.current === scope && historyRequestRef.current === request) {
        setHistoryLoading(false)
      }
    }
  }, [adapter, onError])

  useEffect(() => {
    const delay = selectedSourcePollDelay(selected)
    if (!selected || historyPage !== 1 || delay === null) return

    let stopped = false
    let timer = 0
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        await loadRunHistory(selected.source.id, 1, true)
      }
      if (!stopped && document.visibilityState === 'visible') {
        timer = window.setTimeout(() => { void tick() }, delay)
      }
    }
    const schedule = (immediate = false) => {
      window.clearTimeout(timer)
      if (stopped || document.visibilityState !== 'visible') return
      timer = window.setTimeout(() => { void tick() }, immediate ? 0 : delay)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') schedule(true)
      else window.clearTimeout(timer)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [selected, historyPage, loadRunHistory])

  const openCreate = async () => {
    createNameEditedRef.current = false
    setCreateValues(initialCreateSourceValues(defaultCreatePreset))
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateRootsError('')
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    setCreateOpen(true)
    if (directionFilter !== 'pull' && adapter.suggestedPushName) {
      void adapter.suggestedPushName().then((name) => {
        const suggestion = name.trim()
        if (suggestion && !createNameEditedRef.current) {
          setCreateValues((current) => ({ ...current, name: suggestion }))
        }
      }).catch(() => undefined)
    }
  }

  const changeCreatePreset = (preset: ExternalSourceCreatePreset) => {
    const option = externalSourceCreateOption(preset)
    if (directionFilter === 'pull' && option.direction !== 'pull') return
    const defaults = externalSourceDefaults(option.kind, option.direction)
    createNameEditedRef.current = false
    setCreateValues((current) => ({
      ...current,
      preset,
      name: option.direction === 'push' && adapter.suggestedPushName ? '' : defaults.name,
      sync_mode: 'backup',
      run_mode: defaults.runMode,
      schedule_type: defaults.scheduleType,
      schedule_expression: defaults.scheduleExpression,
      schedule_timezone: defaults.scheduleTimezone,
      ignore_rules: defaults.ignoreRules,
      cookie: '',
      base_url: '',
      username: '',
      password: '',
      spaces: ['personal', 'shared'],
      roots: [],
    }))
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateRootsError('')
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    if (option.direction === 'push' && adapter.suggestedPushName) {
      void adapter.suggestedPushName().then((name) => {
        const suggestion = name.trim()
        if (suggestion && !createNameEditedRef.current) {
          setCreateValues((current) => ({ ...current, name: suggestion }))
        }
      }).catch(() => undefined)
    }
  }

  const createCredentialPayload = () => {
    if (createProfile.credential === 'cookie') {
      const cookie = String(createValues.cookie ?? '').trim()
      return cookie ? { cookie } : null
    }
    if (createProfile.credential === 'synology_dsm') {
      const baseURL = String(createValues.base_url ?? '').trim()
      const username = String(createValues.username ?? '').trim()
      const password = String(createValues.password ?? '')
      return baseURL && username && password
        ? { base_url: baseURL, username, password }
        : null
    }
    return {}
  }

  const testCreateCredential = async () => {
    if (!createProfile.credential) return null
    const payload = createCredentialPayload()
    if (!payload) {
      setCreateCredentialTest(null)
      setCreateCredentialTestError(
        createProfile.credential === 'cookie'
          ? '请先填写一刻相册 Cookie'
          : '请完整填写 DSM 地址、用户名和密码',
      )
      return null
    }
    setTestingCreateCredential(true)
    setCreateCredentialTestError('')
    try {
      const result = await adapter.testSourceCredential(createOption.kind, payload)
      setCreateCredentialTest(result)
      if (!createNameEditedRef.current && result.suggested_name?.trim()) {
        setCreateValues((current) => ({ ...current, name: result.suggested_name!.trim() }))
      }
      return result
    } catch (error) {
      setCreateCredentialTest(null)
      setCreateCredentialTestError(externalSourceCredentialTestErrorLabel(
        error instanceof Error ? error.message : String(error),
        sourceErrorDetail(error),
      ))
      return null
    } finally {
      setTestingCreateCredential(false)
    }
  }

  const createSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = createValues

    const option = externalSourceCreateOption(values.preset)
    let normalizedName = values.name.trim()
    const allowServerDeviceDefault = option.direction === 'push' &&
      option.kind !== 'synology_photos' && Boolean(adapter.suggestedPushName)
    const nameError = !normalizedName && !allowServerDeviceDefault
      ? `请填写${sourceNoun}名称`
      : new TextEncoder().encode(normalizedName).length > 128 ? `${sourceNoun}名称不能超过 128 字节` : ''
    setCreateNameError(nameError)

    const profile = externalSourceConnectorProfile(option.kind, option.direction)
    if (directionFilter === 'pull' && option.direction !== 'pull') {
      setErrorDialog({ title: '无法添加拉取来源', message: '此页面只能添加远程拉取来源。' })
      return
    }
    const roots = normalizeSynologyFileRoots(values.roots ?? [])
    const spacesError = option.kind === 'synology_photos' && profile.credential === 'synology_dsm' && !(values.spaces?.length)
      ? '至少选择一个照片空间'
      : ''
    const rootsError = option.kind === 'synology_files'
      ? synologyFileRootsValidationError(values.roots ?? [])
      : ''
    setCreateSpacesError(spacesError)
    setCreateRootsError(rootsError)
    if (nameError || spacesError || rootsError) return
    if (option.kind === 'synology_photos' && option.direction === 'push') {
      setErrorDialog({ title: '来源已停用', message: 'DSM 相册 Push 已停用；请使用 DSM 文件夹 Push。历史数据保留。' })
      return
    }
    const credentialPayload = profile.credential ? createCredentialPayload() : null
    if (profile.credential && !credentialPayload) {
      setErrorDialog({
        title: `无法添加${sourceNoun}`,
        message: profile.credential === 'cookie'
          ? '请先填写一刻相册 Cookie。'
          : '请完整填写 Synology DSM 地址、用户名和密码。',
      })
      return
    }
    const spaces = normalizeSynologyPhotoSpaces(values.spaces?.length ? values.spaces : ['personal', 'shared'])

    setCreating(true)
    if (profile.credential) {
      const tested = await testCreateCredential()
      if (!tested) {
        setCreating(false)
        return
      }
      if (!createNameEditedRef.current && tested.suggested_name?.trim()) {
        normalizedName = tested.suggested_name.trim()
      }
    }

    let created: ExternalSource
    try {
      created = await adapter.createSource({
        name: normalizedName,
        kind: option.kind,
        direction: option.direction,
        sync_mode: values.sync_mode,
        run_mode: values.run_mode,
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
        target_node_id: 0,
        ignore_rules: values.ignore_rules ?? '',
      })
    } catch (error) {
      showActionError(`添加${sourceNoun}失败`, error, `创建${sourceNoun}失败，请稍后重试。`)
      setCreating(false)
      return
    }

    try {
      if (profile.credential === 'synology_dsm') {
        const config = await adapter.sourceConnectorConfig(created.id)
        const connectorPayload = option.kind === 'synology_files'
          ? { roots }
          : { spaces }
        await adapter.setSourceConnectorConfig(created.id, config.revision, connectorPayload)
      }
      if (profile.credential && credentialPayload) {
        await adapter.setSourceCredential(created.id, credentialPayload)
      }
      if (option.kind === 'synology_files') {
        created = await adapter.updateSource(created.id, created.revision, { status: 'active' })
      }
    } catch (error) {
      const credentialLabel = externalSourceCredentialLabel(profile)
      // S10: Source and empty managed Node have already committed together.
      // DELETE archives the Source and reserves its leaf; do not claim that
      // an automatic rollback removed a still-reserved name.
      setErrorDialog({
        title: `${sourceNoun}设置尚未完成`,
        message: `受管来源「${created.name}」（Source #${created.id}）已创建，目标目录及名称已保留。未自动删除或归档。请在 Source Manager 的设置中完成${credentialLabel}和连接配置。`,
        detail: sourceActionErrorMessage(error, `保存${credentialLabel}失败`),
      })
      setCreateOpen(false)
      await load()
      setCreating(false)
      return
    }

    let localAuthorization: 'bound' | 'cancelled' | 'error' | null = null
    if (option.kind === 'local_folder' && adapter.authorizeLocalFolder) {
      try {
        const result = await adapter.authorizeLocalFolder(created.id)
        localAuthorization = result.cancelled ? 'cancelled' : 'bound'
        if (result.cancelled) {
          // Only the just-created draft is eligible. The Server refuses
          // cleanup if a Root was bound or the Source gained history.
          try {
            await adapter.deleteSource(created.id, created.revision)
            setFeedback('已取消创建；本机未绑定的来源草稿已安全清理')
            setCreateOpen(false)
            setCreateValues(initialCreateSourceValues(defaultCreatePreset))
            setCreateNameError('')
            setCreateSpacesError('')
            setCreateRootsError('')
            await load()
            setCreating(false)
            return
          } catch (cleanupError) {
            setErrorDialog({
              title: '本机文件夹创建已取消，但草稿未清理',
              message: '云端草稿仍保持暂停，不会扫描或上传。请在所属 Desktop 上重新授权，或稍后重试清理。',
              detail: sourceActionErrorMessage(cleanupError, '安全清理未完成'),
            })
          }
        }
      } catch (error) {
        localAuthorization = 'error'
        setErrorDialog({
          title: '本机文件夹授权未完成',
          message: '来源已创建并保持暂停。可从详情重新选择本机目录；当前不会扫描或上传文件。',
          detail: sourceActionErrorMessage(error, '授权失败'),
        })
      }
    }

    setFeedback(option.kind === 'local_folder'
      ? localAuthorization === 'bound'
        ? '本机目录已授权；同步执行器尚未启用，目前不会上传文件'
        : '来源已创建并暂停；请从详情选择本机目录以完成授权'
      : option.kind === 'synology_files'
      ? '群晖 File Station 拉取来源已添加；将同步所选目录中的所有文件和文件夹'
      : `${sourceNoun}已添加`)
    setCreateOpen(false)
    setCreateValues(initialCreateSourceValues(defaultCreatePreset))
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateRootsError('')
    await load()
    setCreating(false)

  }


  const authorizeLocalFolder = async (row: ExternalSourceRow) => {
    if (!adapter.authorizeLocalFolder || row.source.kind !== 'local_folder') return
    try {
      const result = await adapter.authorizeLocalFolder(row.source.id)
      if (result.cancelled) return
      setFeedback('已在绑定设备上授权本机目录；实际 Push 由该设备的 xdrive-agent 执行，不会由 Server 远程扫描')
      await load()
    } catch (error) {
      showActionError('本机目录授权失败', error, '请确认设备在线、目录可读，并检查是否已绑定其他目录。')
    }
  }

  const triggerNow = async (row: ExternalSourceRow) => {
    // Native Photos and local-folder Push never delegate scanning to the
    // Server Source scheduler; the backend rejects such generic Run-Now calls.
    if (isNativePhotoSource(row.source) || row.source.kind === 'local_folder' ||
      isReadOnlySynologySource(row.source)) return
    setTriggeringSourceID(row.source.id)
    try {
      await adapter.triggerSource(row.source.id)
      setFeedback('已请求立即扫描，服务器后台拉取任务已唤醒；定时检查仅作为兜底')
      await load()
    } catch (error) {
      showActionError('立即扫描失败', error, '无法提交立即扫描请求，请稍后重试。')
    } finally {
      setTriggeringSourceID(null)
    }
  }

  const cancelRun = async (row: ExternalSourceRow) => {
    if (isNativePhotoSource(row.source) || isReadOnlySynologySource(row.source)) return
    const run = row.latestRun
    if (!run || run.status !== 'running' || run.cancel_requested_at) return
    setCancellingRunID(run.id)
    try {
      await adapter.cancelSourceRun(row.source.id, run.id)
      setFeedback('已请求停止当前运行')
      await load(true)
    } catch (error) {
      showActionError('停止运行失败', error, '无法停止当前运行，请稍后重试。')
    } finally {
      setCancellingRunID(null)
    }
  }

  const loadSettingsConnectorConfig = (row: ExternalSourceRow) => {
    const requestID = ++settingsSessionRef.current
    setSettingsConnectorLoading(true)
    setSettingsConnectorError('')
    void adapter.sourceConnectorConfig(row.source.id)
      .then((config) => {
        // A dismissed or replaced settings session must not receive an older
        // connector's roots/spaces (or its error and loading state).
        if (requestID !== settingsSessionRef.current) return
        setSettingsConnectorConfig(config)
        if (row.source.kind === 'synology_files') {
          const roots = Array.isArray(config.payload.roots)
            ? config.payload.roots.filter((root): root is string => typeof root === 'string')
            : []
          setSettingsValues((current) => ({ ...current, roots }))
        } else {
          const spaces = Array.isArray(config.payload.spaces)
            ? config.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
            : []
          setSettingsValues((current) => ({ ...current, spaces: spaces.length ? spaces : ['personal', 'shared'] }))
        }
      })
      .catch((error) => {
        if (requestID !== settingsSessionRef.current) return
        setSettingsConnectorError(sourceActionErrorMessage(error, '读取群晖连接配置失败'))
      })
      .finally(() => {
        if (requestID === settingsSessionRef.current) setSettingsConnectorLoading(false)
      })
  }

  const openSettings = (row: ExternalSourceRow) => {
    if (savingSettings || row.source.status === 'archived' || isReadOnlySynologySource(row.source) || isNativePhotoSource(row.source)) return
    ++settingsSessionRef.current
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    setSetting(row)
    setSettingsConnectorConfig(null)
    setSettingsConnectorLoading(false)
    setSettingsConnectorError('')
    setSettingsValues({
      name: externalSourceDisplayName(row.source),
      sync_mode: row.source.kind === 'synology_photos' && row.source.direction === 'push' ? 'backup' : row.source.sync_mode,
      run_mode: row.source.run_mode,
      status: row.source.status === 'active' ? 'active' : 'paused',
      schedule_type: row.source.schedule_type ?? 'interval',
      schedule_expression: row.source.schedule_expression || '6h',
      schedule_timezone: row.source.schedule_timezone || externalSourceDefaults(row.source.kind as SupportedExternalSourceKind, row.source.direction).scheduleTimezone,
      ignore_rules: row.source.ignore_rules ?? '',
      cookie: '',
      base_url: '',
      username: '',
      password: '',
      spaces: ['personal', 'shared'],
      roots: [],
    })
    setSettingsNameError('')
    setSettingsSpacesError('')
    setSettingsRootsError('')
    setSettingsCredentialReveal(null)
    setRevealingSettingsCredential(false)
    setTestingSettingsCredential(false)
    setSettingsCredentialTest(null)
    setSettingsCredentialTestError('')
    if (profile.credential === 'synology_dsm') loadSettingsConnectorConfig(row)
  }

  const closeSettings = () => {
    if (savingSettings) return
    ++settingsSessionRef.current
    setClearCookieConfirmOpen(false)
    setSettingsCredentialReveal(null)
    setRevealingSettingsCredential(false)
    setTestingSettingsCredential(false)
    setSetting(null)
    setSettingsConnectorConfig(null)
    setSettingsConnectorLoading(false)
    setSettingsConnectorError('')
    setSettingsValues(emptySourceSettingsValues())
    setSettingsRootsError('')
    setSettingsNameError('')
    setSettingsSpacesError('')
  }

  const settingsCredentialPayload = () => {
    if (!setting) return null
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    if (profile.credential === 'cookie') {
      const cookie = String(settingsValues.cookie ?? '').trim()
      return cookie ? { cookie } : null
    }
    if (profile.credential === 'synology_dsm') {
      const baseURL = String(settingsValues.base_url ?? '').trim()
      const username = String(settingsValues.username ?? '').trim()
      const password = String(settingsValues.password ?? '')
      const anyPending = Boolean(baseURL || username || password)
      if (!anyPending) return null
      if (!setting.credential?.configured && !(baseURL && username && password)) return undefined
      return {
        ...(baseURL ? { base_url: baseURL } : {}),
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      }
    }
    return null
  }

  const settingsRevealRequestRef = useRef(0)
  const hideSettingsCredential = useCallback(() => {
    ++settingsRevealRequestRef.current
    setSettingsCredentialReveal(null)
  }, [])

  const revealSettingsCredential = async () => {
    if (!setting?.credential?.configured) return
    const session = settingsSessionRef.current
    const request = ++settingsRevealRequestRef.current
    setRevealingSettingsCredential(true)
    try {
      const revealed = await adapter.revealSourceCredential(setting.source.id)
      if (session === settingsSessionRef.current && request === settingsRevealRequestRef.current) setSettingsCredentialReveal(revealed)
    } catch (error) {
      if (session !== settingsSessionRef.current || request !== settingsRevealRequestRef.current) return
      setSettingsCredentialReveal(null)
      setErrorDialog({ title: '显示凭据失败', message: '凭据读取失败或当前权限已失效，请核对后重试。' })
    } finally {
      if (session === settingsSessionRef.current && request === settingsRevealRequestRef.current) setRevealingSettingsCredential(false)
    }
  }

  const testSettingsCredential = async () => {
    if (!setting) return null
    const session = settingsSessionRef.current
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    if (!profile.credential) return null
    const pending = settingsCredentialPayload()
    if (pending === undefined) {
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError('首次配置 DSM 时需要填写完整连接信息')
      return null
    }
    // A partial DSM draft must be tested only after the owning Go Server
    // merges unchanged encrypted fields. Never send a partial credential to
    // the standalone connection-test endpoint or reveal its counterpart.
    if (profile.credential === 'synology_dsm' && pending &&
        (!('base_url' in pending) || !('username' in pending) || !('password' in pending))) {
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError('单项修改将在保存时由服务端验证连接')
      return null
    }
    setTestingSettingsCredential(true)
    setSettingsCredentialTestError('')
    try {
      const result = pending
        ? await adapter.testSourceCredential(setting.source.kind, pending)
        : await adapter.testStoredSourceCredential(setting.source.id)
      if (session !== settingsSessionRef.current) return null
      setSettingsCredentialTest(result)
      return result
    } catch (error) {
      if (session !== settingsSessionRef.current) return null
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError(externalSourceCredentialTestErrorLabel(
        error instanceof Error ? error.message : String(error),
        sourceErrorDetail(error),
      ))
      return null
    } finally {
      if (session === settingsSessionRef.current) setTestingSettingsCredential(false)
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!setting || savingSettings || isNativePhotoSource(setting.source) || isReadOnlySynologySource(setting.source)) return
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    // Never write guessed/default roots or spaces before the persisted connector
    // scope is known; this guard also protects keyboard/native form submission.
    if (profile.credential === 'synology_dsm' &&
        (settingsConnectorLoading || Boolean(settingsConnectorError) || !settingsConnectorConfig)) return
    const values = settingsValues
    const normalizedName = values.name.trim()
    // Old generated names may have a display-only alias (e.g. Photos Pull).
    // Saving schedule/credentials must never silently rename the Source.
    const nameToPersist = normalizedName === externalSourceDisplayName(setting.source)
      ? setting.source.name
      : normalizedName
    const nameError = !normalizedName ? `请填写${sourceNoun}名称` : new TextEncoder().encode(normalizedName).length > 128 ? `${sourceNoun}名称不能超过 128 字节` : ''
    const isSynologyFiles = setting.source.kind === 'synology_files'
    const isLocalFolder = setting.source.kind === 'local_folder'
    const isSynologyPush = setting.source.kind === 'synology_photos' && setting.source.direction === 'push'
    const desiredRoots = normalizeSynologyFileRoots(values.roots ?? [])
    const spacesError = setting.source.kind === 'synology_photos' && profile.credential === 'synology_dsm' && !(values.spaces?.length)
      ? '至少选择一个照片空间'
      : ''
    const rootsError = isSynologyFiles
      ? synologyFileRootsValidationError(values.roots ?? [])
      : ''
    setSettingsNameError(nameError)
    setSettingsSpacesError(spacesError)
    setSettingsRootsError(rootsError)
    if (nameError || spacesError || rootsError) return
    const pendingCredential = settingsCredentialPayload()
    if (pendingCredential === undefined) {
      setSettingsCredentialTestError('更新 DSM 凭据时请完整填写地址、用户名和密码')
      return
    }
    setSavingSettings(true)
    const partialDSM = profile.credential === 'synology_dsm' && pendingCredential &&
      (!('base_url' in pendingCredential) || !('username' in pendingCredential) ||
        !('password' in pendingCredential))
    // Full drafts retain the existing preflight; a partial draft is verified
    // by the real Server before the resulting encrypted bundle is committed.
    if (pendingCredential && !partialDSM) {
      const tested = await testSettingsCredential()
      if (!tested) {
        setSavingSettings(false)
        return
      }
    }
    try {
      let connectorConfig = settingsConnectorConfig
      let connectorConfigChanged = false
      let desiredConnectorPayload: Record<string, unknown> | null = null
      if (profile.credential === 'synology_dsm') {
        connectorConfig = connectorConfig ?? await adapter.sourceConnectorConfig(setting.source.id)
        if (isSynologyFiles) {
          const currentRoots = Array.isArray(connectorConfig.payload.roots)
            ? normalizeSynologyFileRoots(connectorConfig.payload.roots.filter((root): root is string => typeof root === 'string'))
            : []
          connectorConfigChanged = currentRoots.join('\n') !== desiredRoots.join('\n')
          desiredConnectorPayload = { roots: desiredRoots }
        } else {
          const desiredSpaces = normalizeSynologyPhotoSpaces(values.spaces?.length ? values.spaces : ['personal', 'shared'])
          const currentSpaces = Array.isArray(connectorConfig.payload.spaces)
            ? connectorConfig.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
            : []
          connectorConfigChanged = currentSpaces.join(',') !== desiredSpaces.join(',')
          desiredConnectorPayload = { spaces: desiredSpaces }
        }
      }

      const stageFileActivation = isSynologyFiles && values.status === 'active' && (
        setting.source.status !== 'active' ||
        pendingCredential !== null ||
        !setting.credential?.configured ||
        connectorConfigChanged ||
        !connectorConfig?.configured
      )
      let updatedSource = await adapter.updateSource(setting.source.id, setting.source.revision, {
        name: nameToPersist,
        sync_mode: isLocalFolder || isSynologyPush ? 'backup' : values.sync_mode,
        run_mode: isLocalFolder ? 'sync' : values.run_mode,
        status: isLocalFolder
          ? 'paused'
          : stageFileActivation
            ? 'paused'
            : (pendingCredential && !setting.credential?.configured ? 'paused' : values.status),
        schedule_type: isLocalFolder ? 'manual' : values.schedule_type,
        schedule_expression: isLocalFolder || values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: isLocalFolder || values.schedule_type !== 'cron' ? '' : values.schedule_timezone.trim(),
        ignore_rules: values.ignore_rules ?? '',
      })

      if (connectorConfig && connectorConfigChanged && desiredConnectorPayload) {
        const updatedConfig = await adapter.setSourceConnectorConfig(
          setting.source.id,
          connectorConfig.revision,
          desiredConnectorPayload,
        )
        setSettingsConnectorConfig(updatedConfig)
      }

      if (pendingCredential) {
        await adapter.setSourceCredential(setting.source.id, pendingCredential)
      }

      if (stageFileActivation) {
        updatedSource = await adapter.updateSource(setting.source.id, updatedSource.revision, { status: 'active' })
      }

      if (!isSynologyFiles && pendingCredential && values.status === 'paused') {
        const overview = await adapter.sourceOverview()
        const fresh = overview.find((item) => item.source.id === setting.source.id)?.source
        if (fresh && fresh.status !== 'paused') {
          await adapter.updateSource(fresh.id, fresh.revision, { status: 'paused' })
        }
      }

      setFeedback(`${sourceNoun}设置已保存`)
      ++settingsSessionRef.current
      setSettingsCredentialReveal(null)
      setSetting(null)
      setSettingsConnectorConfig(null)
      setSettingsConnectorLoading(false)
      setSettingsConnectorError('')
      setSettingsValues(emptySourceSettingsValues())
      setSettingsNameError('')
      setSettingsSpacesError('')
      setSettingsRootsError('')
      await load()
    } catch (error) {
      showActionError(`保存${sourceNoun}设置失败`, error, `${sourceNoun}设置未保存，请检查后重试。`)
      await load()
    } finally {
      setSavingSettings(false)
    }
  }

  const clearCookie = async () => {
    if (!setting) return
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    const label = externalSourceCredentialLabel(profile)
    setClearingCookie(true)
    try {
      await adapter.deleteSourceCredential(setting.source.id)
      setFeedback(`${label}已清除，该来源已自动暂停`)
      setSettingsCredentialReveal(null)
      setClearCookieConfirmOpen(false)
      setSetting({
        ...setting,
        source: {
          ...setting.source,
          status: 'paused',
          revision: setting.source.revision + 1,
          run_requested_at: undefined,
        },
        credential: { configured: false },
      })
      setSettingsValues((current) => ({ ...current, status: 'paused' }))
      await load()
    } catch (error) {
      setClearCookieConfirmOpen(false)
      showActionError(`清除${label}失败`, error, `已保存的${label}未能清除，请稍后重试。`)
    } finally {
      setClearingCookie(false)
    }
  }

  const deleteSource = async () => {
    if (!deleteTarget || isNativePhotoSource(deleteTarget.source) ||
        isReadOnlySynologySource(deleteTarget.source) ||
        !(adapter.canDeleteSource?.(deleteTarget) ?? deleteTarget.source.kind !== 'local_folder')) return
    const row = deleteTarget
    setDeletingSourceID(row.source.id)
    try {
      await adapter.deleteSource(row.source.id, row.source.revision)
      setFeedback(`${sourceNoun}已移除；已配置或有历史的来源会归档保留，云端文件和同步历史不会删除`)
      if (selected?.source.id === row.source.id) setSelected(null)
      if (setting?.source.id === row.source.id) {
        ++settingsSessionRef.current
        setSettingsCredentialReveal(null)
        setSetting(null)
        setSettingsConnectorConfig(null)
        setSettingsConnectorLoading(false)
        setSettingsConnectorError('')
        setSettingsValues(emptySourceSettingsValues())
        setSettingsNameError('')
        setSettingsSpacesError('')
      }
      setDeleteTarget(null)
      await load()
    } catch (error) {
      showActionError(`删除${sourceNoun}失败`, error, `${sourceNoun}未删除，请稍后重试。`)
      await load()
    } finally {
      setDeletingSourceID(null)
    }
  }

  const restoreSource = async (row: ExternalSourceRow) => {
    const allowed = !isReadOnlySynologySource(row.source) && !isNativePhotoSource(row.source) &&
      (adapter.canRestoreSource?.(row) ?? row.source.kind !== 'local_folder')
    if (!adapter.restoreSource || !allowed) return
    setRestoringSourceID(row.source.id)
    try {
      await adapter.restoreSource(row.source.id, row.source.revision)
      setFeedback(`${externalSourceDisplayName(row.source)}已恢复为暂停状态；请检查凭据后手动恢复运行`)
      await load()
    } catch (error) {
      showActionError(`恢复${sourceNoun}失败`, error, `${sourceNoun}未恢复，请稍后重试。`)
      await load()
    } finally {
      setRestoringSourceID(null)
    }
  }

  const canCleanupSource = (row: ExternalSourceRow) => Boolean(
    adapter.sourceCloudCleanupPreview && adapter.trashSourceCloudCleanup &&
    row.source.status === 'archived' && row.source.direction === 'pull' &&
    row.source.kind === 'yike_photos' && row.source.target_managed &&
    row.source.target_node_id && row.source.target_path
  )

  const openCloudCleanup = async (row: ExternalSourceRow) => {
    if (!canCleanupSource(row) || !adapter.sourceCloudCleanupPreview ||
        cleanupPreparingSourceID !== null || cleanupBusy) return
    setCleanupPreparingSourceID(row.source.id)
    try {
      const preview = await adapter.sourceCloudCleanupPreview(row.source.id)
      if (!preview.reversible || preview.source_id !== row.source.id ||
          preview.source_revision !== row.source.revision ||
          preview.target_node_id !== row.source.target_node_id ||
          preview.source_name !== row.source.name) {
        throw new Error('来源或目标已经变化，请刷新来源列表并重新预览')
      }
      setCleanupPreview(preview)
    } catch (error) {
      showActionError('云端清理预览失败', error, '来源必须已归档，且没有共享、其他来源依赖或未完成操作。')
    } finally {
      setCleanupPreparingSourceID(null)
    }
  }

  const confirmCloudCleanup = async (confirmedName: string) => {
    const preview = cleanupPreview
    if (!preview || !adapter.trashSourceCloudCleanup || cleanupBusy ||
        confirmedName !== preview.source_name) return
    setCleanupBusy(true)
    try {
      await adapter.trashSourceCloudCleanup(preview, confirmedName)
      setCleanupPreview(null)
      setFeedback('云端目标目录已移入回收站，来源和同步历史仍保留；可在回收站手动恢复')
      await load()
    } catch (error) {
      // A stale preview is never automatically retried. The user must
      // explicitly request a new read-only preview and re-confirm.
      setCleanupPreview(null)
      showActionError('云端清理未执行', error, '目标、版本或写入状态已变化；重新预览后才能再次确认。')
    } finally {
      setCleanupBusy(false)
    }
  }

  const loadCollections = useCallback(async (sourceID: number) => {
    const scope = detailScopeRef.current
    setCollectionsLoading(true)
    try {
      const next = await adapter.sourceCollections(sourceID)
      if (detailScopeRef.current !== scope) return
      setCollections(next)
      setCollectionsReadState('ready')
    } catch (error) {
      if (detailScopeRef.current !== scope) return
      setCollectionsReadState((previous) => previous === 'ready' ? previous : 'error')
      showActionError('加载相册/集合失败', error, '无法读取该来源的相册/集合，请稍后重试。')
    } finally {
      if (detailScopeRef.current === scope) setCollectionsLoading(false)
    }
  }, [adapter])

  const loadCollectionItems = useCallback(async (sourceID: number, collectionID: number, page = 1) => {
    const nextPage = Math.max(1, Math.trunc(page))
    const scope = detailScopeRef.current
    const request = (collectionItemRequestRef.current[collectionID] ?? 0) + 1
    collectionItemRequestRef.current[collectionID] = request
    setCollectionItemPages((current) => ({
      ...current,
      [collectionID]: {
        items: current[collectionID]?.items ?? [],
        page: current[collectionID]?.page ?? nextPage,
        hasNext: current[collectionID]?.hasNext ?? false,
        loading: true,
        loaded: current[collectionID]?.loaded ?? false,
      },
    }))
    try {
      const offset = (nextPage - 1) * SOURCE_COLLECTION_ITEM_PAGE_SIZE
      const items = await adapter.sourceCollectionItems(
        sourceID,
        collectionID,
        SOURCE_COLLECTION_ITEM_PAGE_SIZE + 1,
        offset,
      )
      if (detailScopeRef.current !== scope ||
        collectionItemRequestRef.current[collectionID] !== request) return
      setCollectionItemPages((current) => ({
        ...current,
        [collectionID]: {
          items: items.slice(0, SOURCE_COLLECTION_ITEM_PAGE_SIZE),
          page: nextPage,
          hasNext: items.length > SOURCE_COLLECTION_ITEM_PAGE_SIZE,
          loading: false,
          loaded: true,
        },
      }))
    } catch (error) {
      if (detailScopeRef.current !== scope ||
        collectionItemRequestRef.current[collectionID] !== request) return
      setCollectionItemPages((current) => ({
        ...current,
        [collectionID]: {
          items: current[collectionID]?.items ?? [],
          page: current[collectionID]?.page ?? nextPage,
          hasNext: current[collectionID]?.hasNext ?? false,
          loading: false,
          loaded: current[collectionID]?.loaded ?? false,
        },
      }))
      showActionError('加载集合成员失败', error, '无法读取该相册/集合的成员，请稍后重试。')
    }
  }, [adapter])

  const openDetails = async (row: ExternalSourceRow, runID?: string) => {
    const scope = ++detailScopeRef.current
    collectionItemRequestRef.current = {}
    setHistoryReadState('unverified')
    setCollectionsReadState('unverified')
    setSelected(row)
    setFocusedRunID(runID ?? null)
    onSelectedSourceChange?.(row.source.id)
    setFailedItems([])
    setFailedItemsOpen(false)
    setFailedItemsLimitReached(false)
    setHistoryRuns([])
    setHistoryPage(1)
    setHistoryHasNext(false)
    setRunFailurePages({})
    setRunSkipPages({})
    setCollections([])
    setCollectionItemPages({})
    void loadRunHistory(row.source.id, 1)
    if (isNativePhotoSource(row.source)) {
      // PhotoKit and MediaStore IDs and per-asset failures remain device-local. The
      // shared Source Manager reads only the aggregate SyncRun history.
      setCollectionsReadState('ready')
      setCollectionsLoading(false)
      setFailedItemsLoading(false)
      return
    }
    setFailedItemsLoading(true)
    void loadCollections(row.source.id)
    try {
      const items = await adapter.sourceItems(row.source.id, 'error', 1000, 0)
      if (detailScopeRef.current !== scope) return
      setFailedItems(items)
      setFailedItemsLimitReached(items.length >= 1000)
    } catch (error) {
      if (detailScopeRef.current !== scope) return
      showActionError('加载来源详情失败', error, '无法读取当前失败文件列表，请稍后重试。')
    } finally {
      if (detailScopeRef.current === scope) setFailedItemsLoading(false)
    }
  }

  useEffect(() => {
    if (!initialSourceID || initialSourceOpenedRef.current === initialSourceID) return
    const row = rows.find((candidate) => candidate.source.id === initialSourceID)
    if (!row) return
    initialSourceOpenedRef.current = initialSourceID
    void openDetails(row)
  }, [initialSourceID, rows])

  useEffect(() => {
    if (!focusedRun || focusedRequestOpenedRef.current === focusedRun.requestID ||
        !hasLoaded) return
    const row = rows.find((item) => item.source.id === focusedRun.sourceID)
    if (!row) {
      if (!loadError) {
        focusedRequestOpenedRef.current = focusedRun.requestID
        setErrorDialog({
          title: '无法定位同步记录',
          message: '该来源不存在、已删除或当前账号无权读取。',
        })
      }
      return
    }
    focusedRequestOpenedRef.current = focusedRun.requestID
    void openDetails(row, focusedRun.runID)
  }, [focusedRun, hasLoaded, rows, loadError])

  useEffect(() => {
    if (!focusedRun || selected?.source.id !== focusedRun.sourceID ||
        focusedRunID !== focusedRun.runID) return
    const run = historyRuns.find((item) => item.id === focusedRun.runID)
    if (!run) return
    const key = `${focusedRun.requestID}:${run.id}`
    if (focusedRunDetailsFetchedRef.current === key) return
    focusedRunDetailsFetchedRef.current = key
    // Default-expanding an Accordion does not invoke its onChange fetch.
    if (run.failed_items > 0) void loadRunFailures(focusedRun.sourceID, run.id, 1)
    if (run.skipped_items > 0) void loadRunSkips(focusedRun.sourceID, run.id, 1)
  }, [focusedRun, selected?.source.id, focusedRunID, historyRuns,
      loadRunFailures, loadRunSkips])

  const closeDetails = () => {
    ++detailScopeRef.current
    collectionItemRequestRef.current = {}
    setHistoryReadState('unverified')
    setCollectionsReadState('unverified')
    setHistoryLoading(false)
    setFailedItemsLoading(false)
    setSelected(null)
    setFocusedRunID(null)
    onSelectedSourceChange?.()
    setFailedItems([])
    setFailedItemsOpen(false)
    setFailedItemsLimitReached(false)
    setHistoryRuns([])
    setHistoryPage(1)
    setHistoryHasNext(false)
    setRunFailurePages({})
    setRunSkipPages({})
    setCollections([])
    setCollectionsLoading(false)
    setCollectionItemPages({})
  }

  const copyRunID = (runID: string) => {
    void navigator.clipboard.writeText(runID)
      .then(() => setFeedback('运行 ID 已复制'))
      .catch((error) => showActionError('复制运行 ID 失败', error, '无法自动复制运行 ID，请手动复制。'))
  }

  return (
    <>
      <XDriveSourceManagerListPage
        title={directionFilter === 'pull' ? '远程拉取' : '来源管理'}
        subtitle={directionFilter === 'pull' ? '由 xDrive Server 管理远程连接、扫描和下载。' : undefined}
        rows={rows}
        directionFilter={directionFilter}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((current) => !current)}
        restoringSourceID={restoringSourceID}
        canRestoreSource={(row) => !isReadOnlySynologySource(row.source) && !isNativePhotoSource(row.source) &&
          (adapter.canRestoreSource?.(row) ?? Boolean(adapter.restoreSource && row.source.kind !== 'local_folder'))}
        canCleanupSource={canCleanupSource}
        cleanupPreparingSourceID={cleanupPreparingSourceID}
        onCloudCleanup={openCloudCleanup}
        onRestoreSource={(row) => { void restoreSource(row) }}
        loading={loading}
        hasLoaded={hasLoaded}
        loadError={loadError}
        failedItemsLoading={failedItemsLoading}
        triggeringSourceID={triggeringSourceID}
        cancellingRunID={cancellingRunID}
        onRefresh={load}
        onAdd={openCreate}
        onOpenError={(row) => setErrorDialog({
          title: `${externalSourceDisplayName(row.source)} · 最近一次运行错误`,
          message: row.source.last_error || '未提供具体错误信息',
        })}
        onOpenDetails={openDetails}
        onTriggerNow={triggerNow}
        onCancelRun={cancelRun}
        onOpenSettings={openSettings}
      />

      <XDriveSourceDetailsDialog
        row={selected}
        collections={collections}
        collectionsLoading={collectionsLoading}
        collectionsReadState={collectionsReadState}
        onReloadCollections={(sourceID) => { void loadCollections(sourceID) }}
        collectionItemPages={collectionItemPages}
        collectionPageSize={SOURCE_COLLECTION_ITEM_PAGE_SIZE}
        historyRuns={historyRuns}
        focusedRunID={focusedRunID}
        historyPage={historyPage}
        historyHasNext={historyHasNext}
        historyLoading={historyLoading}
        historyReadState={historyReadState}
        historyPageSize={SOURCE_HISTORY_PAGE_SIZE}
        runFailurePages={runFailurePages}
        runSkipPages={runSkipPages}
        runFailurePageSize={SOURCE_RUN_FAILURE_PAGE_SIZE}
        failedItems={failedItems}
        failedItemsLoading={failedItemsLoading}
        triggeringSourceID={triggeringSourceID}
        cancellingRunID={cancellingRunID}
        onClose={closeDetails}
        onLoadCollectionItems={loadCollectionItems}
        onLoadRunHistory={loadRunHistory}
        onLoadRunFailures={loadRunFailures}
        onLoadRunSkips={loadRunSkips}
        onCancelRun={cancelRun}
        onCopyRunID={copyRunID}
        onOpenFailedItems={() => setFailedItemsOpen(true)}
        onTriggerNow={triggerNow}
        onAuthorizeLocalFolder={adapter.authorizeLocalFolder ? authorizeLocalFolder : undefined}
      />

      <XDriveSourceFailedItemsDialog
        open={failedItemsOpen}
        items={failedItems}
        limitReached={failedItemsLimitReached}
        onClose={() => setFailedItemsOpen(false)}
      />

      <XDriveSourceCreateDialog
        directionFilter={directionFilter}
        open={createOpen}
        allowLocalPush={Boolean(adapter.authorizeLocalFolder)}
        creating={creating}
        values={createValues}
        nameError={createNameError}
        spacesError={createSpacesError}
        rootsError={createRootsError}
        cookieHelpVariant={cookieHelpVariant}
        testingCredential={testingCreateCredential}
        credentialTest={createCredentialTest}
        credentialTestError={createCredentialTestError}
        onRequestClose={() => {
          if (creating) return
          setCreateOpen(false)
          setCreateValues(initialCreateSourceValues(defaultCreatePreset))
        }}
        onCancel={() => {
          setCreateOpen(false)
          setCreateValues(initialCreateSourceValues(defaultCreatePreset))
          setCreateNameError('')
          setCreateSpacesError('')
          setCreateRootsError('')
        }}
        onSubmit={(event) => {
          void createSource(event)
        }}
        onPresetChange={changeCreatePreset}
        onNameEdit={() => { createNameEditedRef.current = true }}
        onChange={(patch) => {
          if (Object.prototype.hasOwnProperty.call(patch, 'name')) createNameEditedRef.current = true
          setCreateValues((current) => ({ ...current, ...patch }))
        }}
        onCredentialChange={(patch) => {
          setCreateValues((current) => ({ ...current, ...patch }))
          setCreateCredentialTest(null)
          setCreateCredentialTestError('')
        }}
        onClearNameError={() => setCreateNameError('')}
        onClearSpacesError={() => setCreateSpacesError('')}
        onClearRootsError={() => setCreateRootsError('')}
        onTestCredential={() => {
          void testCreateCredential()
        }}
      />

      <XDriveSourceSettingsDialog
        setting={setting}
        saving={savingSettings}
        values={settingsValues}
        nameError={settingsNameError}
        spacesError={settingsSpacesError}
        rootsError={settingsRootsError}
        cookieHelpVariant={cookieHelpVariant}
        revealingCredential={revealingSettingsCredential}
        testingCredential={testingSettingsCredential}
        credentialReveal={settingsCredentialReveal}
        credentialTest={settingsCredentialTest}
        credentialTestError={settingsCredentialTestError}
        connectorConfigLoaded={Boolean(settingsConnectorConfig)}
        connectorConfigLoading={settingsConnectorLoading}
        connectorConfigError={settingsConnectorError}
        clearingCredential={clearingCookie}
        browseDirectories={settingsBrowseDirectories}
        allowDelete={setting ? !isNativePhotoSource(setting.source) && !isReadOnlySynologySource(setting.source) &&
          (adapter.canDeleteSource?.(setting) ?? setting.source.kind !== 'local_folder') : false}
        onRequestClose={closeSettings}
        onCancel={closeSettings}
        onRetryConnectorConfig={() => {
          if (setting && !savingSettings) loadSettingsConnectorConfig(setting)
        }}
        onSubmit={(event) => {
          void saveSettings(event)
        }}
        onChange={(patch) => {
          setSettingsValues((current) => ({ ...current, ...patch }))
        }}
        onCredentialChange={(patch) => {
          setSettingsValues((current) => ({ ...current, ...patch }))
          setSettingsCredentialTest(null)
          setSettingsCredentialTestError('')
        }}
        onClearNameError={() => setSettingsNameError('')}
        onClearSpacesError={() => setSettingsSpacesError('')}
        onClearRootsError={() => setSettingsRootsError('')}
        onRevealCredential={() => {
          void revealSettingsCredential()
        }}
        onHideCredential={hideSettingsCredential}
        onTestCredential={() => {
          void testSettingsCredential()
        }}
        onRequestClearCredential={() => setClearCookieConfirmOpen(true)}
        onDelete={() => {
          if (setting && !isNativePhotoSource(setting.source) && !isReadOnlySynologySource(setting.source) &&
              (adapter.canDeleteSource?.(setting) ?? setting.source.kind !== 'local_folder')) {
            setDeleteTarget(setting)
          }
        }}
      />

      <XDriveSourceCloudCleanupDialog
        preview={cleanupPreview}
        busy={cleanupBusy}
        onClose={() => { if (!cleanupBusy) setCleanupPreview(null) }}
        onConfirm={(name) => { void confirmCloudCleanup(name) }}
      />

      <XDriveSourceDeleteConfirmDialog
        open={Boolean(deleteTarget)}
        sourceName={deleteTarget ? externalSourceDisplayName(deleteTarget.source) : ''}
        busy={deletingSourceID !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void deleteSource()}
      />

      <XDriveSourceClearCredentialDialog
        open={clearCookieConfirmOpen}
        credentialLabel={setting
          ? externalSourceCredentialLabel(externalSourceConnectorProfile(setting.source.kind, setting.source.direction))
          : '凭据'}
        busy={clearingCookie}
        onClose={() => setClearCookieConfirmOpen(false)}
        onConfirm={() => void clearCookie()}
      />

      <XDriveSourceErrorDialog
        state={errorDialog}
        onClose={() => setErrorDialog(null)}
      />

      <XDriveFeedbackSnackbar
        open={Boolean(feedback)}
        tone="good"
        message={feedback}
        onClose={() => setFeedback('')}
      />

    </>
  )
}
