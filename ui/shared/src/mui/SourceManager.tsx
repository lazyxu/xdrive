import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box as MuiBox,
  Button as MuiButton,
  CircularProgress,
  Dialog,
  DialogContentText,
  IconButton,
  MenuItem,
  Stack,
  Tooltip,
  Typography as MuiTypography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActionSpacer, XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveFeedbackSnackbar } from './FeedbackSnackbar'
import { XDrivePaginationControls } from './PaginationControls'
import { XDriveSectionHeader } from './SectionHeader'
import { XDriveStatePanel } from './StatePanel'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveStatusBadge } from './StatusBadge'
import { XDriveSourceRunProgress } from './SourceRunProgress'
import { XDriveSourceRunSummary } from './SourceRunSummary'
import { XDriveSourceIgnoreRulesField } from './SourceIgnoreRulesField'
import {
  XDriveSourceNameField,
  XDriveSourcePresetField,
  XDriveSourceRunModeField,
  XDriveSourceStatusField,
} from './SourceBasicFields'
import {
  XDriveSourceCookieField,
  XDriveSourceTargetField,
  XDriveStoredCredentialField,
  XDriveSynologyDsmCredentialFields,
} from './SourceCredentialFields'
import {
  XDriveSynologyFileRootsField,
  XDriveSynologyPhotoSpacesField,
} from './SourceConnectorConfigFields'
import { XDriveSourceScheduleFields } from './SourceScheduleFields'
import { XDriveSourceFailureItem } from './SourceFailureItem'
import { XDriveSourceCollectionItem, XDriveSourceCollectionSummary } from './SourceCollection'
import { XDriveSourceKindIcon } from './SourceKindIcon'
import { XDriveSourceSummaryCard } from './SourceSummaryCard'
import { XDriveSynologyDsmGuideDialog as SynologyDsmGuideDialog } from './SynologyDsmGuideDialog'
import { XDriveYikeCookieHelp } from './YikeCookieHelp'
import {
  externalSourceCardView,
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCredentialLabel,
  externalSourceCredentialTestErrorLabel,
  externalSourceCredentialTestSuccessLabel,
  externalSourceDefaults,
  externalSourceDetailView,
  externalSourceRunDetailView,
  externalSourceTriggerActionLabel,
  formatExternalSourceTime,
  normalizeSynologyFileRoots,
  normalizeSynologyPhotoSpaces,
  synologyFileRootsValidationError,
  yikeConnectorNotice,
  yikeRateLimitNotice,
  yikeManagedTargetLabel,
} from '../external-sources'
import { formatSize } from '../format'
import type {
  CreateExternalSourceInput,
  ExternalSource,
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
  ExternalSourceScheduleType,
  SynologyPhotoSpace,
  SupportedExternalSourceKind,
  UpdateExternalSourceInput,
} from '../external-sources'

export interface XDriveSourceManagerAdapter {
  me?(): Promise<{ username: string }>
  sourceOverview(): Promise<ExternalSourceOverview[]>
  createSource(input: CreateExternalSourceInput): Promise<ExternalSource>
  triggerSource(sourceID: number): Promise<ExternalSource>
  sourceRuns(sourceID: number, limit?: number, offset?: number): Promise<ExternalSourceRun[]>
  sourceRunFailures(sourceID: number, runID: string, limit?: number, offset?: number): Promise<ExternalSourceRunFailure[]>
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
  defaultTargetNodeID?: number
  defaultTargetLabel: string
  defaultTargetPath: string
  targetBrowser?: XDriveSourceTargetBrowser
  cookieHelpVariant?: 'accordion' | 'dialog'
  onError: (error: unknown) => void
}

function sourceErrorDetail(error: unknown) {
  if (!error || typeof error !== 'object' || !('detail' in error)) return ''
  const detail = (error as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : ''
}

type SourceSettingsValues = {
  name: string
  run_mode: 'scan' | 'sync'
  status: 'active' | 'paused'
  schedule_type: ExternalSourceScheduleType
  schedule_expression: string
  schedule_timezone: string
  ignore_rules?: string
  cookie?: string
  base_url?: string
  username?: string
  password?: string
  spaces?: SynologyPhotoSpace[]
  roots?: string[]
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

type SourceRunFailurePage = {
  items: ExternalSourceRunFailure[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

type SourceCollectionItemPage = {
  items: ExternalSourceCollectionItem[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

type CreateSourceValues = {
  preset: ExternalSourceCreatePreset
  name: string
  run_mode: 'scan' | 'sync'
  schedule_type: ExternalSourceScheduleType
  schedule_expression: string
  schedule_timezone: string
  ignore_rules?: string
  cookie?: string
  base_url?: string
  username?: string
  password?: string
  spaces?: SynologyPhotoSpace[]
  roots?: string[]
}

type SourceErrorDialogState = {
  title: string
  message: string
  detail?: string
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

function initialCreateSourceValues(preset: ExternalSourceCreatePreset = 'synology_push'): CreateSourceValues {
  const option = externalSourceCreateOption(preset)
  const defaults = externalSourceDefaults(option.kind, option.direction)
  return {
    preset,
    name: defaults.name,
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

function emptySourceSettingsValues(): SourceSettingsValues {
  return {
    name: '',
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
  defaultTargetNodeID,
  defaultTargetLabel,
  defaultTargetPath,
  targetBrowser,
  cookieHelpVariant = 'accordion',
  onError,
}: XDriveSourceManagerProps) {
  const [rows, setRows] = useState<ExternalSourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ExternalSourceRow | null>(null)
  const [failedItems, setFailedItems] = useState<ExternalSourceItem[]>([])
  const [failedItemsLoading, setFailedItemsLoading] = useState(false)
  const [failedItemsOpen, setFailedItemsOpen] = useState(false)
  const [failedItemsLimitReached, setFailedItemsLimitReached] = useState(false)
  const [historyRuns, setHistoryRuns] = useState<ExternalSourceRun[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyHasNext, setHistoryHasNext] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [runFailurePages, setRunFailurePages] = useState<Record<string, SourceRunFailurePage>>({})
  const [collections, setCollections] = useState<ExternalSourceCollection[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionItemPages, setCollectionItemPages] = useState<Record<number, SourceCollectionItemPage>>({})
  const [setting, setSetting] = useState<ExternalSourceRow | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsValues, setSettingsValues] = useState<SourceSettingsValues>(emptySourceSettingsValues)
  const [settingsNameError, setSettingsNameError] = useState('')
  const [settingsSpacesError, setSettingsSpacesError] = useState('')
  const [settingsRootsError, setSettingsRootsError] = useState('')
  const settingsScheduleType = settingsValues.schedule_type
  const settingsScheduleExpression = settingsValues.schedule_expression
  const settingsScheduleTimezone = settingsValues.schedule_timezone
  const [createOpen, setCreateOpen] = useState(false)
  const [createTargetCrumbs, setCreateTargetCrumbs] = useState<XDriveSourceTargetNode[]>([])
  const [createTargetDirectories, setCreateTargetDirectories] = useState<XDriveSourceTargetNode[]>([])
  const [createTargetLoading, setCreateTargetLoading] = useState(false)
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
  const [deleteTarget, setDeleteTarget] = useState<ExternalSourceRow | null>(null)
  const [deletingSourceID, setDeletingSourceID] = useState<number | null>(null)
  const [guideSource, setGuideSource] = useState<ExternalSource | null>(null)
  const [guideUsername, setGuideUsername] = useState<string | undefined>()
  const [errorDialog, setErrorDialog] = useState<SourceErrorDialogState | null>(null)
  const [feedback, setFeedback] = useState('')
  const [clearCookieConfirmOpen, setClearCookieConfirmOpen] = useState(false)
  const [clearingCookie, setClearingCookie] = useState(false)
  const [settingsConnectorConfig, setSettingsConnectorConfig] = useState<ExternalSourceConnectorConfig | null>(null)
  const [createValues, setCreateValues] = useState<CreateSourceValues>(initialCreateSourceValues)
  const [createNameError, setCreateNameError] = useState('')
  const [createSpacesError, setCreateSpacesError] = useState('')
  const [createRootsError, setCreateRootsError] = useState('')
  const createScheduleType = createValues.schedule_type
  const createScheduleExpression = createValues.schedule_expression
  const createScheduleTimezone = createValues.schedule_timezone
  const createPreset = createValues.preset
  const createOption = externalSourceCreateOption(createPreset)
  const createProfile = externalSourceConnectorProfile(createOption.kind, createOption.direction)
  const createTarget = createTargetCrumbs.at(-1)
  const selectedCreateTargetNodeID = targetBrowser ? createTarget?.id : defaultTargetNodeID
  const selectedCreateTargetLabel = targetBrowser
    ? (createTargetCrumbs.map((item) => item.name).join(' / ') || defaultTargetLabel)
    : defaultTargetLabel
  const selectedCreateTargetPath = targetBrowser ? (createTarget?.path ?? '') : defaultTargetPath

  const showActionError = (title: string, error: unknown, fallback: string, detail?: string) => {
    setErrorDialog({
      title,
      message: sourceActionErrorMessage(error, fallback),
      detail,
    })
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const overview = await adapter.sourceOverview()
      const next: ExternalSourceRow[] = overview.map((item) => ({
        source: item.source,
        latestRun: item.latest_run,
        credential: item.credential,
      }))
      setRows(next)
      setSelected((current) => current
        ? next.find((row) => row.source.id === current.source.id) ?? current
        : null)
    } catch (error) {
      onError(error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [adapter, onError])

  const loadRunFailures = useCallback(async (sourceID: number, runID: string, page = 1) => {
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
  }, [adapter, onError])

  useEffect(() => {
    void load()
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
    if (!silent) setHistoryLoading(true)
    try {
      const offset = (nextPage - 1) * SOURCE_HISTORY_PAGE_SIZE
      const runs = await adapter.sourceRuns(sourceID, SOURCE_HISTORY_PAGE_SIZE + 1, offset)
      setHistoryRuns(runs.slice(0, SOURCE_HISTORY_PAGE_SIZE))
      setHistoryHasNext(runs.length > SOURCE_HISTORY_PAGE_SIZE)
      setHistoryPage(nextPage)
    } catch (error) {
      onError(error)
    } finally {
      if (!silent) setHistoryLoading(false)
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

  const openSynologyGuide = (source: ExternalSource) => {
    setGuideSource(source)
    if (!adapter.me) {
      setGuideUsername(undefined)
      return
    }
    void adapter.me()
      .then((me) => setGuideUsername(me.username))
      .catch(() => setGuideUsername(undefined))
  }

  const loadCreateTargetDirectory = async (
    node: XDriveSourceTargetNode,
    crumbs: XDriveSourceTargetNode[],
  ) => {
    if (!targetBrowser) return
    setCreateTargetLoading(true)
    try {
      const children = await targetBrowser.children(node.id)
      setCreateTargetCrumbs(crumbs)
      setCreateTargetDirectories(children)
    } catch (error) {
      onError(error)
    } finally {
      setCreateTargetLoading(false)
    }
  }

  const openCreate = async () => {
    setCreateValues(initialCreateSourceValues())
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateRootsError('')
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    setCreateTargetCrumbs([])
    setCreateTargetDirectories([])
    setCreateOpen(true)
    if (!targetBrowser) return
    setCreateTargetLoading(true)
    try {
      const root = await targetBrowser.root()
      await loadCreateTargetDirectory(root, [root])
    } catch (error) {
      onError(error)
    } finally {
      setCreateTargetLoading(false)
    }
  }

  const changeCreatePreset = (preset: ExternalSourceCreatePreset) => {
    const option = externalSourceCreateOption(preset)
    const defaults = externalSourceDefaults(option.kind, option.direction)
    setCreateValues((current) => ({
      ...current,
      preset,
      name: defaults.name,
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
    const normalizedName = values.name.trim()
    const nameError = !normalizedName ? '请填写同步文件夹名称' : normalizedName.length > 128 ? '同步文件夹名称不能超过 128 个字符' : ''
    setCreateNameError(nameError)
    const option = externalSourceCreateOption(values.preset)
    const profile = externalSourceConnectorProfile(option.kind, option.direction)
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
    if (option.kind !== 'yike_photos' && !selectedCreateTargetNodeID) {
      setErrorDialog({ title: '无法添加同步文件夹', message: '当前目标文件夹尚未加载，请稍后重试。' })
      return
    }
    const credentialPayload = profile.credential ? createCredentialPayload() : null
    if (profile.credential && !credentialPayload) {
      setErrorDialog({
        title: '无法添加同步文件夹',
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
    }

    let created: ExternalSource
    try {
      created = await adapter.createSource({
        name: normalizedName,
        kind: option.kind,
        direction: option.direction,
        sync_mode: 'backup',
        run_mode: values.run_mode,
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
        target_node_id: option.kind === 'yike_photos' ? 0 : (selectedCreateTargetNodeID ?? 0),
        ignore_rules: values.ignore_rules ?? '',
      })
    } catch (error) {
      showActionError('添加同步文件夹失败', error, '创建同步文件夹失败，请稍后重试。')
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
      try {
        await adapter.deleteSource(created.id, created.revision)
        setErrorDialog({
          title: profile.credential === 'synology_dsm' ? '群晖连接配置失败' : 'Cookie 保存失败',
          message: `刚创建的${profile.label}同步文件夹已自动撤销，请检查配置后重试。`,
          detail: sourceActionErrorMessage(error, `保存${credentialLabel}失败`),
        })
        await load()
        setCreating(false)
        return
      } catch (rollbackError) {
        setErrorDialog({
          title: '同步文件夹创建未完成',
          message: `同步文件夹已创建，但${credentialLabel}或连接配置保存失败且自动回滚也失败。请进入“设置”修复或删除该同步文件夹。`,
          detail: `配置：${sourceActionErrorMessage(error, '保存失败')}；回滚：${sourceActionErrorMessage(rollbackError, '回滚失败')}`,
        })
      }
    }

    setFeedback(option.kind === 'synology_files'
      ? '群晖 File Station Pull 同步文件夹已添加；将同步所选目录中的所有文件和文件夹'
      : '同步文件夹已添加')
    setCreateOpen(false)
    setCreateValues(initialCreateSourceValues())
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateRootsError('')
    await load()
    setCreating(false)

    if (profile.manualTriggerExecutor === 'source_agent') {
      openSynologyGuide(created)
    }
  }


  const triggerNow = async (row: ExternalSourceRow) => {
    setTriggeringSourceID(row.source.id)
    try {
      await adapter.triggerSource(row.source.id)
      const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
      setFeedback(profile.manualTriggerExecutor === 'source_agent'
        ? '已请求立即扫描，等待群晖 source-agent 下一次任务检查'
        : '已请求立即扫描，已主动唤醒 Pull worker；定时轮询仅作为兜底')
      await load()
    } catch (error) {
      showActionError('立即扫描失败', error, '无法提交立即扫描请求，请稍后重试。')
    } finally {
      setTriggeringSourceID(null)
    }
  }

  const cancelRun = async (row: ExternalSourceRow) => {
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

  const openSettings = (row: ExternalSourceRow) => {
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    setSetting(row)
    setSettingsConnectorConfig(null)
    setSettingsValues({
      name: row.source.name,
      run_mode: row.source.run_mode,
      status: row.source.status,
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
    setSettingsCredentialTest(null)
    setSettingsCredentialTestError('')
    if (profile.credential === 'synology_dsm') {
      void adapter.sourceConnectorConfig(row.source.id)
        .then((config) => {
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
          setSettingsCredentialTestError(sourceActionErrorMessage(error, '读取群晖连接配置失败'))
        })
    }
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
      return baseURL && username && password
        ? { base_url: baseURL, username, password }
        : undefined
    }
    return null
  }

  const hideSettingsCredential = useCallback(() => {
    setSettingsCredentialReveal(null)
  }, [])

  const revealSettingsCredential = async () => {
    if (!setting?.credential?.configured) return
    setRevealingSettingsCredential(true)
    try {
      const revealed = await adapter.revealSourceCredential(setting.source.id)
      setSettingsCredentialReveal(revealed)
    } catch (error) {
      setSettingsCredentialReveal(null)
      showActionError('显示凭据失败', error, '无法读取已保存凭据，请稍后重试。')
    } finally {
      setRevealingSettingsCredential(false)
    }
  }

  const testSettingsCredential = async () => {
    if (!setting) return null
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    if (!profile.credential) return null
    const pending = settingsCredentialPayload()
    if (pending === undefined) {
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError('更新 DSM 凭据时请完整填写地址、用户名和密码')
      return null
    }
    setTestingSettingsCredential(true)
    setSettingsCredentialTestError('')
    try {
      const result = pending
        ? await adapter.testSourceCredential(setting.source.kind, pending)
        : await adapter.testStoredSourceCredential(setting.source.id)
      setSettingsCredentialTest(result)
      return result
    } catch (error) {
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError(externalSourceCredentialTestErrorLabel(
        error instanceof Error ? error.message : String(error),
        sourceErrorDetail(error),
      ))
      return null
    } finally {
      setTestingSettingsCredential(false)
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!setting) return
    const values = settingsValues
    const normalizedName = values.name.trim()
    const nameError = !normalizedName ? '请填写同步文件夹名称' : normalizedName.length > 128 ? '同步文件夹名称不能超过 128 个字符' : ''
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    const isSynologyFiles = setting.source.kind === 'synology_files'
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
    if (pendingCredential) {
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
        name: normalizedName,
        run_mode: values.run_mode,
        status: stageFileActivation
          ? 'paused'
          : (pendingCredential && !setting.credential?.configured ? 'paused' : values.status),
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
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

      setFeedback('同步文件夹设置已保存')
      setSettingsCredentialReveal(null)
      setSetting(null)
      setSettingsConnectorConfig(null)
      setSettingsValues(emptySourceSettingsValues())
      setSettingsNameError('')
      setSettingsSpacesError('')
      setSettingsRootsError('')
      await load()
    } catch (error) {
      showActionError('保存同步文件夹设置失败', error, '同步文件夹设置未保存，请检查后重试。')
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
      setFeedback(`${label}已清除，同步文件夹已自动暂停`)
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
    if (!deleteTarget) return
    const row = deleteTarget
    setDeletingSourceID(row.source.id)
    try {
      await adapter.deleteSource(row.source.id, row.source.revision)
      setFeedback('同步文件夹已删除；已同步到 xDrive 的文件已保留')
      if (selected?.source.id === row.source.id) setSelected(null)
      if (setting?.source.id === row.source.id) {
        setSettingsCredentialReveal(null)
        setSetting(null)
        setSettingsValues(emptySourceSettingsValues())
        setSettingsNameError('')
        setSettingsSpacesError('')
      }
      setDeleteTarget(null)
      await load()
    } catch (error) {
      showActionError('删除同步文件夹失败', error, '同步文件夹未删除，请稍后重试。')
      await load()
    } finally {
      setDeletingSourceID(null)
    }
  }

  const loadCollections = useCallback(async (sourceID: number) => {
    setCollectionsLoading(true)
    try {
      setCollections(await adapter.sourceCollections(sourceID))
    } catch (error) {
      showActionError('加载相册/集合失败', error, '无法读取该同步文件夹的相册/集合，请稍后重试。')
    } finally {
      setCollectionsLoading(false)
    }
  }, [adapter])

  const loadCollectionItems = useCallback(async (sourceID: number, collectionID: number, page = 1) => {
    const nextPage = Math.max(1, Math.trunc(page))
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

  const openDetails = async (row: ExternalSourceRow) => {
    setSelected(row)
    setFailedItems([])
    setFailedItemsOpen(false)
    setFailedItemsLimitReached(false)
    setHistoryRuns([])
    setHistoryPage(1)
    setHistoryHasNext(false)
    setRunFailurePages({})
    setCollections([])
    setCollectionItemPages({})
    setFailedItemsLoading(true)
    void loadRunHistory(row.source.id, 1)
    void loadCollections(row.source.id)
    try {
      const items = await adapter.sourceItems(row.source.id, 'error', 1000, 0)
      setFailedItems(items)
      setFailedItemsLimitReached(items.length >= 1000)
    } catch (error) {
      showActionError('加载同步文件夹详情失败', error, '无法读取当前失败文件列表，请稍后重试。')
    } finally {
      setFailedItemsLoading(false)
    }
  }

  const closeDetails = () => {
    setSelected(null)
    setFailedItems([])
    setFailedItemsOpen(false)
    setFailedItemsLimitReached(false)
    setHistoryRuns([])
    setHistoryPage(1)
    setHistoryHasNext(false)
    setRunFailurePages({})
    setCollections([])
    setCollectionsLoading(false)
    setCollectionItemPages({})
  }

  const selectedDetail = selected ? externalSourceDetailView(selected) : null
  const selectedCard = selected ? externalSourceCardView(selected) : null

  return (
    <>
      <XDriveWorkspaceSurface
        presentation="page"
        title="同步文件夹"
        subtitle="统一管理同步文件夹、凭据、调度方式与运行状态。"
        pageActions={
          <>
            <XDriveActionButton
              startIcon={<RefreshRoundedIcon />}
              loading={loading}
              loadingLabel="正在刷新…"
              onClick={() => void load()}
            >
              刷新
            </XDriveActionButton>
            <XDriveActionButton intent="primary" startIcon={<AddRoundedIcon />} onClick={() => void openCreate()}>
              添加同步文件夹
            </XDriveActionButton>
          </>
        }
      >
      {loading && rows.length === 0 ? (
        <XDriveStatePanel variant="plain" loading message="正在加载同步文件夹…" />
      ) : rows.length === 0 ? (
          <XDriveStatePanel variant="plain" message="尚未添加同步文件夹" />
        ) : (
          <Stack spacing={1.75}>
            {rows.map((row) => {
              const card = externalSourceCardView(row)
              const stats = card.scannedItems === undefined || card.scannedBytes === undefined
                ? '尚无扫描统计'
                : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatSize(card.scannedBytes)}${card.failedItems ? ` · 失败 ${card.failedItems}` : ''}`

              return (
                <XDriveSourceSummaryCard
                  key={row.source.id}
                  name={row.source.name}
                  icon={<XDriveSourceKindIcon kind={row.source.kind} />}
                  modeLabel={`${card.connector.label} · ${card.modeLabel}`}
                  statusTone={card.state.tone}
                  statusLabel={card.state.label}
                  activity={`${card.lastActivityLabel}：${formatExternalSourceTime(card.lastActivityAt)}`}
                  stats={stats}
                  metaAction={row.source.last_error && !row.source.run_requested_at && row.latestRun?.status !== 'running' ? (
                    <MuiButton
                      size="small"
                      color="error"
                      variant="text"
                      onClick={() => setErrorDialog({
                        title: `${row.source.name} · 最近一次运行错误`,
                        message: row.source.last_error || '未提供具体错误信息',
                      })}
                      sx={{ minWidth: 'auto', px: 0, justifyContent: 'flex-start' }}
                    >
                      查看最近错误
                    </MuiButton>
                  ) : undefined}
                  actions={(
                    <>
                      <XDriveActionButton compact disabled={failedItemsLoading} onClick={() => void openDetails(row)}>
                        查看
                      </XDriveActionButton>
                      {externalSourceConnectorProfile(row.source.kind, row.source.direction).manualTriggerExecutor === 'source_agent' && (
                        <XDriveActionButton compact onClick={() => openSynologyGuide(row.source)}>
                          DSM 配置
                        </XDriveActionButton>
                      )}
                      <Tooltip title={card.trigger.label}>
                        <span>
                          <XDriveActionButton
                            compact
                            disabled={!card.trigger.ready}
                            loading={triggeringSourceID === row.source.id}
                            loadingLabel="正在请求…"
                            onClick={() => void triggerNow(row)}
                          >
                            {externalSourceTriggerActionLabel(row)}
                          </XDriveActionButton>
                        </span>
                      </Tooltip>
                      {row.latestRun?.status === 'running' && (
                        <XDriveActionButton
                          compact
                          intent="warning"
                          disabled={Boolean(row.latestRun.cancel_requested_at)}
                          loading={cancellingRunID === row.latestRun.id || Boolean(row.latestRun.cancel_requested_at)}
                          loadingLabel="正在取消…"
                          onClick={() => void cancelRun(row)}
                        >
                          停止
                        </XDriveActionButton>
                      )}
                      <XDriveActionButton compact onClick={() => openSettings(row)}>设置</XDriveActionButton>
                    </>
                  )}
                />
              )
            })}
          </Stack>
        )}
      </XDriveWorkspaceSurface>

      <Dialog open={!!selected} onClose={closeDetails} maxWidth="md" fullWidth scroll="paper" slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title={selected ? `${selected.source.name} · 同步文件夹详情` : '同步文件夹详情'} onClose={closeDetails} />
        <XDriveDialogContent dividers>
        {selected && selectedDetail && (
          <>
            {selectedDetail.error && (
              <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>最近一次运行异常</MuiTypography>
                <MuiTypography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedDetail.error}</MuiTypography>
              </XDriveStatusAlert>
            )}
            <XDriveDescriptionGrid columns={4} fullColumnsAt="md">
              <XDriveDescriptionItem label="同步文件夹类型">
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <XDriveSourceKindIcon kind={selected.source.kind} size="small" />
                  <span>{selectedDetail.kindLabel}</span>
                </Stack>
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="工作方式">{selectedDetail.modeLabel}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="状态">
                <XDriveStatusBadge tone={selectedDetail.state.tone} label={selectedDetail.state.label} />
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="目标目录">
                {selected.source.target_path || (selectedDetail.targetNodeID ? `节点 #${selectedDetail.targetNodeID}` : '未配置')}
              </XDriveDescriptionItem>
              <XDriveDescriptionItem label="调度">{selectedDetail.scheduleLabel}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="上次运行">{formatExternalSourceTime(selectedDetail.lastRunAt)}</XDriveDescriptionItem>
              <XDriveDescriptionItem label="上次成功">{formatExternalSourceTime(selectedDetail.lastSuccessAt)}</XDriveDescriptionItem>
              {selectedDetail.credential && (
                <XDriveDescriptionItem label={selectedDetail.credential.label}>
                  {selectedDetail.credential.configured ? '已配置' : '未配置'}
                </XDriveDescriptionItem>
              )}
            </XDriveDescriptionGrid>

            <XDriveSectionHeader level="h3" title="相册与集合" sx={{ my: 2 }} />
            {collectionsLoading ? (
              <XDriveStatePanel loading variant="plain" message="正在加载相册/集合" />
            ) : collections.length === 0 ? (
              <XDriveStatePanel variant="plain" message="该同步文件夹暂无相册/集合元数据" />
            ) : (
              <Stack spacing={1}>
                {collections.map((collection) => {
                  const page = collectionItemPages[collection.id]
                  return (
                    <Accordion
                      key={collection.id}
                      disableGutters
                      elevation={0}
                      onChange={(_, expanded) => {
                        if (expanded && !page?.loaded && !page?.loading) {
                          void loadCollectionItems(selected.source.id, collection.id, 1)
                        }
                      }}
                    >
                      <AccordionSummary>
                        <XDriveSourceCollectionSummary collection={collection} wideAt="md" />
                      </AccordionSummary>
                      <AccordionDetails>
                        {page?.loading && !page.loaded ? (
                          <XDriveStatePanel loading variant="plain" message="正在加载集合成员" />
                        ) : page?.loaded && page.items.length > 0 ? (
                          <Stack spacing={0.75}>
                            {page.items.map((item) => (
                              <XDriveSourceCollectionItem
                                key={item.external_id}
                                item={item}
                                sizeLabel={formatSize(item.size)}
                                wideAt="md"
                              />
                            ))}
                            <XDrivePaginationControls
                              page={page.page}
                              pageSize={SOURCE_COLLECTION_ITEM_PAGE_SIZE}
                              hasNext={page.hasNext}
                              loading={page.loading}
                              labelPrefix="成员"
                              onPrevious={() => void loadCollectionItems(selected.source.id, collection.id, page.page - 1)}
                              onNext={() => void loadCollectionItems(selected.source.id, collection.id, page.page + 1)}
                            />
                          </Stack>
                        ) : page?.loaded ? (
                          <XDriveStatePanel variant="plain" message="该集合暂无成员" />
                        ) : (
                          <MuiTypography variant="caption" color="text.secondary">展开后加载成员。</MuiTypography>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Stack>
            )}

            <XDriveSectionHeader level="h3" title="同步历史" sx={{ my: 2 }} />
              {historyRuns.length > 0 ? (
                <Stack spacing={1}>
                  {historyRuns.map((run) => {
                    const runDetail = externalSourceRunDetailView(run)
                    const canCancel = run.status === 'running' && selected.latestRun?.id === run.id
                    const failurePage = runFailurePages[run.id]
                    return (
                      <Accordion
                        key={run.id}
                        disableGutters
                        elevation={0}
                        onChange={(_, expanded) => {
                          if (expanded && run.failed_items > 0 && !failurePage?.loaded && !failurePage?.loading) {
                            void loadRunFailures(selected.source.id, run.id, 1)
                          }
                        }}
                        sx={{ border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}
                      >
                        <AccordionSummary>
                          <XDriveSourceRunSummary runNumber={run.run_number} detail={runDetail} wideAt="md" />
                        </AccordionSummary>
                        <AccordionDetails>
                          {runDetail.progress && (
                            <XDriveSourceRunProgress
                              progress={runDetail.progress}
                              canCancel={canCancel}
                              cancelLoading={cancellingRunID === run.id}
                              onCancel={() => void cancelRun(selected)}
                            />
                          )}
                          <XDriveDescriptionGrid columns={3} fullColumnsAt="md" sx={{ p: 1.25 }}>
                            <XDriveDescriptionItem label="运行编号">#{run.run_number > 0 ? run.run_number : '—'}</XDriveDescriptionItem>
                            <XDriveDescriptionItem label="内部运行 ID">
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                <MuiTypography component="code" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{run.id}</MuiTypography>
                                <Tooltip title="复制运行 ID">
                                  <IconButton
                                    size="small"
                                    aria-label="复制运行 ID"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(run.id)
                                        .then(() => setFeedback('运行 ID 已复制'))
                                        .catch((error) => showActionError('复制运行 ID 失败', error, '无法自动复制运行 ID，请手动复制。'))
                                    }}
                                  >
                                    <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </XDriveDescriptionItem>
                            <XDriveDescriptionItem label="运行状态">
                              <XDriveStatusBadge tone={runDetail.statusTone} label={runDetail.statusLabel} />
                            </XDriveDescriptionItem>
                            <XDriveDescriptionItem label="耗时">{runDetail.durationLabel}</XDriveDescriptionItem>
                            <XDriveDescriptionItem label="开始时间">{formatExternalSourceTime(runDetail.startedAt)}</XDriveDescriptionItem>
                            <XDriveDescriptionItem label="结束时间">{runDetail.finishedAt ? formatExternalSourceTime(runDetail.finishedAt) : '进行中'}</XDriveDescriptionItem>
                            <XDriveDescriptionItem label="成功项">{runDetail.successItems.toLocaleString('zh-CN')} 项</XDriveDescriptionItem>
                            <XDriveDescriptionItem label="失败项">{runDetail.failedItems.toLocaleString('zh-CN')} 项</XDriveDescriptionItem>
                            {runDetail.metrics.map((metric) => (
                              <XDriveDescriptionItem key={metric.key} label={metric.label}>
                                {metric.items.toLocaleString('zh-CN')} 项
                                {metric.bytes === undefined ? '' : ' · ' + formatSize(metric.bytes)}
                              </XDriveDescriptionItem>
                            ))}
                          </XDriveDescriptionGrid>
                          <XDriveStatusAlert tone={runDetail.error ? 'bad' : 'good'} sx={{ mt: 1.5 }}>
                            运行日志：{runDetail.error || '无错误日志'}
                          </XDriveStatusAlert>
                          {runDetail.failedItems > 0 && (
                            <MuiBox sx={{ mt: 1.5 }}>
                              <MuiTypography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                                本次失败文件
                              </MuiTypography>
                              {failurePage?.loading && !failurePage.loaded ? (
                                <CircularProgress size={18} />
                              ) : failurePage?.loaded && failurePage.items.length > 0 ? (
                                <Stack spacing={0.75}>
                                  {failurePage.items.map((failure) => (
                                    <XDriveSourceFailureItem
                                      key={failure.id}
                                      compact
                                      title={failure.path || failure.external_id}
                                      externalID={failure.external_id}
                                      sizeLabel={formatSize(failure.size)}
                                      failedAt={failure.failed_at}
                                      error={failure.error}
                                    />
                                  ))}
                                  <XDrivePaginationControls
                                    page={failurePage.page}
                                    pageSize={SOURCE_RUN_FAILURE_PAGE_SIZE}
                                    hasNext={failurePage.hasNext}
                                    loading={failurePage.loading}
                                    labelPrefix="失败项"
                                    onPrevious={() => void loadRunFailures(selected.source.id, run.id, failurePage.page - 1)}
                                    onNext={() => void loadRunFailures(selected.source.id, run.id, failurePage.page + 1)}
                                  />
                                </Stack>
                              ) : failurePage?.loaded ? (
                                <XDriveStatusAlert tone="warning">
                                  该历史 Run 记录了 {runDetail.failedItems.toLocaleString('zh-CN')} 个失败项，但没有可恢复的逐文件失败快照。
                                </XDriveStatusAlert>
                              ) : (
                                <MuiTypography variant="caption" color="text.secondary">
                                  展开后加载本次失败文件明细。
                                </MuiTypography>
                              )}
                            </MuiBox>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    )
                  })}
                  <XDrivePaginationControls
                    page={historyPage}
                    pageSize={SOURCE_HISTORY_PAGE_SIZE}
                    hasNext={historyHasNext}
                    loading={historyLoading}
                    onPrevious={() => void loadRunHistory(selected.source.id, historyPage - 1)}
                    onNext={() => void loadRunHistory(selected.source.id, historyPage + 1)}
                    sx={{ pt: 0.5 }}
                  />
                </Stack>
              ) : (
                <XDriveStatePanel variant="plain" message={historyLoading ? '正在加载运行历史' : '尚无运行记录'} />
              )}
            

            {failedItemsLoading && (
              <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                正在检查逐文件失败记录…
              </MuiTypography>
            )}
            {!failedItemsLoading && failedItems.length > 0 && (
              <XDriveStatusAlert
                tone="bad"
                sx={{ mt: 2 }}
                action={(
                  <Stack direction="row" spacing={0.5}>
                    <MuiButton color="inherit" size="small" onClick={() => setFailedItemsOpen(true)}>
                      查看失败项（{failedItems.length}）
                    </MuiButton>
                    <MuiButton
                      color="inherit"
                      size="small"
                      disabled={!selectedCard?.trigger.ready || triggeringSourceID === selected.source.id}
                      onClick={() => void triggerNow(selected)}
                    >
                      {triggeringSourceID === selected.source.id ? '正在请求…' : '立即重试'}
                    </MuiButton>
                  </Stack>
                )}
              >
                当前仍有 {failedItems.length} 个文件处于失败状态；下一次扫描会自动重试。
              </XDriveStatusAlert>
            )}
          </>
        )}
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton onClick={closeDetails}>关闭</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog open={failedItemsOpen && failedItems.length > 0} onClose={() => setFailedItemsOpen(false)} maxWidth="md" fullWidth scroll="paper" slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="失败文件" onClose={() => setFailedItemsOpen(false)} />
        <XDriveDialogContent dividers>
          {failedItemsLimitReached && (
            <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
              当前最多显示前 1000 个失败项。
            </XDriveStatusAlert>
          )}
          <Stack spacing={1.5}>
            {failedItems.map((item) => (
              <XDriveSourceFailureItem
                key={item.source_item_id}
                title={item.path || item.external_id}
                externalID={item.external_id}
                sizeLabel={formatSize(item.size)}
                error={item.last_error}
              />
            ))}
          </Stack>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton onClick={() => setFailedItemsOpen(false)}>关闭</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={createOpen}
        onClose={() => {
          if (creating) return
          setCreateOpen(false)
          setCreateValues(initialCreateSourceValues())
        }}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="添加同步文件夹"
          onClose={() => {
            if (creating) return
            setCreateOpen(false)
            setCreateValues(initialCreateSourceValues())
          }}
          closeDisabled={creating}
        />
        <XDriveDialogContent dividers>
        {createOption.kind === 'yike_photos' ? (
          <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
            固定逻辑目录：{yikeManagedTargetLabel}。连接成功后由服务器按百度 UID 和账号名称自动创建；底层文件仍使用 xDrive CAS 存储。
          </XDriveStatusAlert>
        ) : targetBrowser ? (
          <MuiBox sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
              <MuiBox>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>目标文件夹</MuiTypography>
                <MuiTypography variant="body2" color="text.secondary">
                  当前选择：{selectedCreateTargetLabel || '正在加载…'}
                </MuiTypography>
              </MuiBox>
              {createTargetLoading ? <CircularProgress size={18} /> : null}
            </Stack>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              {createTargetCrumbs.map((crumb, index) => (
                <MuiButton
                  key={crumb.id}
                  size="small"
                  variant={index === createTargetCrumbs.length - 1 ? 'contained' : 'text'}
                  disabled={createTargetLoading || index === createTargetCrumbs.length - 1}
                  onClick={() => void loadCreateTargetDirectory(crumb, createTargetCrumbs.slice(0, index + 1))}
                >
                  {crumb.name}
                </MuiButton>
              ))}
            </Stack>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {createTargetDirectories.length === 0 && !createTargetLoading ? (
                <MuiTypography variant="caption" color="text.secondary">
                  当前目录下没有子文件夹，可直接使用当前目录。
                </MuiTypography>
              ) : createTargetDirectories.map((directory) => (
                <MuiButton
                  key={directory.id}
                  variant="outlined"
                  size="small"
                  disabled={createTargetLoading}
                  onClick={() => void loadCreateTargetDirectory(
                    directory,
                    [...createTargetCrumbs, directory],
                  )}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <span>{directory.name}</span>
                  <span>进入文件夹 ›</span>
                </MuiButton>
              ))}
            </Stack>
            {createOption.direction === 'pull' && (
              <MuiTypography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Pull 模式由 xDrive Server 直接连接 DSM；请确保服务器网络可以访问下面填写的 DSM 地址。
              </MuiTypography>
            )}
          </MuiBox>
        ) : (
          <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
            <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>目标目录使用当前文件夹</MuiTypography>
            <MuiTypography variant="body2">
              当前目标：{selectedCreateTargetLabel}{selectedCreateTargetPath ? `（${selectedCreateTargetPath}）` : '（我的文件根目录）'}
            </MuiTypography>
            {createOption.direction === 'pull' && (
              <MuiTypography variant="body2" sx={{ mt: 0.5 }}>
                Pull 模式由 xDrive Server 直接连接 DSM；请确保服务器网络可以访问下面填写的 DSM 地址。
              </MuiTypography>
            )}
          </XDriveStatusAlert>
        )}
        <MuiBox id="external-source-create-form" component="form" onSubmit={(event) => void createSource(event)}>
          <Stack spacing={2}>
            <XDriveSourcePresetField
              value={createValues.preset}
              onChange={changeCreatePreset}
            />
            <XDriveSourceNameField
              value={createValues.name}
              error={Boolean(createNameError)}
              helperText={createNameError || ' '}
              onChange={(value) => {
                setCreateValues((current) => ({ ...current, name: value }))
                if (createNameError) setCreateNameError('')
              }}
            />
            <XDriveSourceRunModeField
              label="初始运行模式"
              value={createValues.run_mode}
              scanLabel="仅扫描（推荐先使用）"
              onChange={(value) => setCreateValues((current) => ({ ...current, run_mode: value }))}
            />
            <XDriveSourceScheduleFields
              wideAt="md"
              scheduleType={createScheduleType}
              expression={createScheduleExpression}
              timezone={createScheduleTimezone}
              onScheduleTypeChange={(value) => setCreateValues((current) => ({ ...current, schedule_type: value }))}
              onExpressionChange={(value) => setCreateValues((current) => ({ ...current, schedule_expression: value }))}
              onTimezoneChange={(value) => setCreateValues((current) => ({ ...current, schedule_timezone: value }))}
            />
            <XDriveSourceIgnoreRulesField
              value={createValues.ignore_rules ?? ''}
              onChange={(value) => setCreateValues((current) => ({ ...current, ignore_rules: value }))}
              monospace
            />
            {createProfile.credential === 'cookie' && (
              <>
                <XDriveSourceCookieField
                  value={createValues.cookie ?? ''}
                  helperText="Cookie 只会加密保存到服务器，之后不会回传到浏览器。"
                  onChange={(value) => {
                    setCreateValues((current) => ({ ...current, cookie: value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
                <MuiBox>
                  <XDriveStatusAlert tone="warning" sx={{ mb: 1 }}>{yikeConnectorNotice}</XDriveStatusAlert>
                  <XDriveStatusAlert tone="neutral" sx={{ mb: 1 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
                  <XDriveYikeCookieHelp variant={cookieHelpVariant} />
                  <MuiBox sx={{ mt: 1 }}>
                    <XDriveActionButton
                      compact
                      disabled={testingCreateCredential}
                      loading={testingCreateCredential}
                      loadingLabel="正在测试…"
                      onClick={() => void testCreateCredential()}
                    >
                      测试连接
                    </XDriveActionButton>
                  </MuiBox>
                  {createCredentialTest && (
                    <XDriveStatusAlert tone="good" sx={{ mt: 1 }}>
                      {externalSourceCredentialTestSuccessLabel(createCredentialTest)}
                    </XDriveStatusAlert>
                  )}
                  {createCredentialTestError && <XDriveStatusAlert tone="bad" sx={{ mt: 1 }}>{createCredentialTestError}</XDriveStatusAlert>}
                </MuiBox>
              </>
            )}
            {createProfile.credential === 'synology_dsm' && (
              <>
                <XDriveSectionHeader level="h3" title="Synology DSM 连接" />
                <XDriveSynologyDsmCredentialFields
                  baseURL={createValues.base_url ?? ''}
                  username={createValues.username ?? ''}
                  password={createValues.password ?? ''}
                  onBaseURLChange={(value) => {
                    setCreateValues((current) => ({ ...current, base_url: value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                  onUsernameChange={(value) => {
                    setCreateValues((current) => ({ ...current, username: value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                  onPasswordChange={(value) => {
                    setCreateValues((current) => ({ ...current, password: value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
                {createOption.kind === 'synology_photos' ? (
                  <XDriveSynologyPhotoSpacesField
                    value={createValues.spaces ?? []}
                    error={Boolean(createSpacesError)}
                    helperText={createSpacesError || '至少选择一个照片空间'}
                    onChange={(value) => {
                      setCreateValues((current) => ({ ...current, spaces: value }))
                      if (createSpacesError) setCreateSpacesError('')
                    }}
                  />
                ) : (
                  <XDriveSynologyFileRootsField
                    value={createValues.roots ?? []}
                    error={Boolean(createRootsError)}
                    helperText={createRootsError || '每行一个 DSM 绝对目录；会同步目录、空目录及其中的任意文件类型。'}
                    onChange={(value) => {
                      setCreateValues((current) => ({ ...current, roots: value }))
                      if (createRootsError) setCreateRootsError('')
                    }}
                  />
                )}
                <XDriveStatusAlert tone="neutral" sx={{ mb: 1 }}>
                  {createOption.kind === 'synology_files'
                    ? 'DSM 凭据只会在服务器端加密保存；Pull worker 通过 File Station API 只读同步所选目录中的所有文件和文件夹，不会修改 NAS 内容。'
                    : 'DSM 凭据只会在服务器端加密保存；Pull worker 使用 Synology Photos API 只读发现和下载媒体，不会删除 NAS 中的照片。'}
                </XDriveStatusAlert>
                <MuiBox>
                  <XDriveActionButton
                    compact
                    disabled={testingCreateCredential}
                    loading={testingCreateCredential}
                    loadingLabel="正在测试…"
                    onClick={() => void testCreateCredential()}
                  >
                    测试连接
                  </XDriveActionButton>
                </MuiBox>
                {createCredentialTest && (
                  <XDriveStatusAlert tone="good">
                    {externalSourceCredentialTestSuccessLabel(createCredentialTest)}
                  </XDriveStatusAlert>
                )}
                {createCredentialTestError && <XDriveStatusAlert tone="bad">{createCredentialTestError}</XDriveStatusAlert>}
              </>
            )}
          </Stack>
        </MuiBox>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton
            onClick={() => {
              setCreateOpen(false)
              setCreateValues(initialCreateSourceValues())
              setCreateNameError('')
              setCreateSpacesError('')
              setCreateRootsError('')
            }}
          >
            取消
          </XDriveActionButton>
          <XDriveActionButton
            intent="primary"
            type="submit"
            form="external-source-create-form"
            loading={creating}
            loadingLabel="正在添加…"
          >
            添加同步文件夹
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={!!setting}
        onClose={() => {
          if (savingSettings) return
          setClearCookieConfirmOpen(false)
          setSettingsCredentialReveal(null)
          setSetting(null)
          setSettingsValues(emptySourceSettingsValues())
          setSettingsRootsError('')
        }}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={setting ? `${setting.source.name} · 设置` : '同步文件夹设置'}
          onClose={() => {
            if (savingSettings) return
            setClearCookieConfirmOpen(false)
            setSettingsCredentialReveal(null)
            setSetting(null)
            setSettingsValues(emptySourceSettingsValues())
            setSettingsRootsError('')
          }}
          closeDisabled={savingSettings}
        />
        <XDriveDialogContent dividers>
        {setting && (
          <MuiBox id="external-source-settings-form" component="form" onSubmit={(event) => void saveSettings(event)}>
            <Stack spacing={2}>
              <XDriveSourceNameField
                autoFocus
                value={settingsValues.name}
                error={Boolean(settingsNameError)}
                helperText={settingsNameError || ' '}
                onChange={(value) => {
                  setSettingsValues((current) => ({ ...current, name: value }))
                  if (settingsNameError) setSettingsNameError('')
                }}
              />
              <XDriveSourceRunModeField
                value={settingsValues.run_mode}
                onChange={(value) => setSettingsValues((current) => ({ ...current, run_mode: value }))}
              />
              <XDriveSourceStatusField
                label="同步状态"
                value={settingsValues.status}
                onChange={(value) => setSettingsValues((current) => ({ ...current, status: value }))}
              />
              <XDriveSourceTargetField
                value={setting.source.target_path}
                managed={setting.source.kind === 'yike_photos'}
              />
              <XDriveSourceScheduleFields
                wideAt="md"
                scheduleType={settingsScheduleType}
                expression={settingsScheduleExpression}
                timezone={settingsScheduleTimezone}
                onScheduleTypeChange={(value) => setSettingsValues((current) => ({ ...current, schedule_type: value }))}
                onExpressionChange={(value) => setSettingsValues((current) => ({ ...current, schedule_expression: value }))}
                onTimezoneChange={(value) => setSettingsValues((current) => ({ ...current, schedule_timezone: value }))}
              />
              <XDriveSourceIgnoreRulesField
                rows={6}
                placeholder={'每行一条规则，例如：\n@eaDir/\n*.tmp\n!important.jpg'}
                value={settingsValues.ignore_rules ?? ''}
                onChange={(value) => setSettingsValues((current) => ({ ...current, ignore_rules: value }))}
                monospace
              />

              {externalSourceConnectorProfile(setting.source.kind, setting.source.direction).credential === 'cookie' && (
                <>
                  <XDriveSectionHeader level="h3" title="一刻相册凭据" />
                  <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 0.5 }}>
                    <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {setting.credential?.configured ? 'Cookie 已配置' : 'Cookie 未配置'}
                    </MuiTypography>
                    <MuiTypography variant="body2">
                      Cookie 默认仅显示遮罩；点击“显示”后临时读取明文，30 秒后自动重新隐藏。
                    </MuiTypography>
                  </XDriveStatusAlert>
                  <XDriveStoredCredentialField
                    label="已保存 Cookie"
                    configured={Boolean(setting.credential?.configured)}
                    revealedValue={settingsCredentialReveal?.field === 'cookie' ? settingsCredentialReveal.value : ''}
                    loading={revealingSettingsCredential}
                    expiresInSeconds={settingsCredentialReveal?.expires_in_seconds ?? 30}
                    updatedAtLabel={setting.credential?.updated_at ? new Date(setting.credential.updated_at).toLocaleString('zh-CN') : undefined}
                    onReveal={() => void revealSettingsCredential()}
                    onHide={hideSettingsCredential}
                  />
                  <XDriveStatusAlert tone="neutral" sx={{ mb: 0.5 }}>{yikeRateLimitNotice}</XDriveStatusAlert>
                  <XDriveSourceCookieField
                    label="替换 Cookie"
                    value={settingsValues.cookie ?? ''}
                    placeholder={setting.credential?.configured ? '留空则保持当前 Cookie 不变' : '粘贴一刻相册 Cookie'}
                    helperText={setting.credential?.configured
                      ? '只在需要更换 Cookie 时填写；已显示的 Cookie 不会自动带入此输入框。'
                      : '当前未配置 Cookie，请粘贴新的 Cookie。'}
                    onChange={(value) => {
                      setSettingsValues((current) => ({ ...current, cookie: value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                  <MuiBox>
                    <XDriveYikeCookieHelp variant={cookieHelpVariant} />
                    <MuiBox sx={{ mt: 1 }}>
                      <XDriveActionButton
                        compact
                        disabled={testingSettingsCredential}
                        loading={testingSettingsCredential}
                        loadingLabel="正在测试…"
                        onClick={() => void testSettingsCredential()}
                      >
                        测试连接
                      </XDriveActionButton>
                    </MuiBox>
                    {settingsCredentialTest && (
                      <XDriveStatusAlert tone="good" sx={{ mt: 1 }}>
                        {externalSourceCredentialTestSuccessLabel(settingsCredentialTest)}
                      </XDriveStatusAlert>
                    )}
                    {settingsCredentialTestError && <XDriveStatusAlert tone="bad" sx={{ mt: 1 }}>{settingsCredentialTestError}</XDriveStatusAlert>}
                  </MuiBox>
                  {setting.credential?.configured && (
                    <MuiBox>
                      <XDriveActionButton
                        intent="danger"
                        disabled={clearingCookie}
                        onClick={() => setClearCookieConfirmOpen(true)}
                      >
                        清除 Cookie
                      </XDriveActionButton>
                    </MuiBox>
                  )}
                </>
              )}

              {externalSourceConnectorProfile(setting.source.kind, setting.source.direction).credential === 'synology_dsm' && (
                <>
                  <XDriveSectionHeader level="h3" title="Synology DSM 凭据" />
                  <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 0.5 }}>
                    <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {setting.credential?.configured ? 'DSM 凭据已配置' : 'DSM 凭据未配置'}
                    </MuiTypography>
                    <MuiTypography variant="body2">
                      DSM 密码默认仅显示遮罩，可按需临时显示 30 秒；如需更新连接，请重新完整填写地址、用户名和密码。
                    </MuiTypography>
                  </XDriveStatusAlert>
                  <XDriveStoredCredentialField
                    label="已保存 DSM 密码"
                    configured={Boolean(setting.credential?.configured)}
                    revealedValue={settingsCredentialReveal?.field === 'password' ? settingsCredentialReveal.value : ''}
                    loading={revealingSettingsCredential}
                    expiresInSeconds={settingsCredentialReveal?.expires_in_seconds ?? 30}
                    updatedAtLabel={setting.credential?.updated_at ? new Date(setting.credential.updated_at).toLocaleString('zh-CN') : undefined}
                    onReveal={() => void revealSettingsCredential()}
                    onHide={hideSettingsCredential}
                  />
                  <XDriveSynologyDsmCredentialFields
                    mode="update"
                    baseURL={settingsValues.base_url ?? ''}
                    username={settingsValues.username ?? ''}
                    password={settingsValues.password ?? ''}
                    onBaseURLChange={(value) => {
                      setSettingsValues((current) => ({ ...current, base_url: value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                    onUsernameChange={(value) => {
                      setSettingsValues((current) => ({ ...current, username: value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                    onPasswordChange={(value) => {
                      setSettingsValues((current) => ({ ...current, password: value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                  {setting.source.kind === 'synology_photos' ? (
                    <>
                      <XDriveSynologyPhotoSpacesField
                        value={settingsValues.spaces ?? []}
                        error={Boolean(settingsSpacesError)}
                        helperText={settingsSpacesError || '至少选择一个照片空间'}
                        onChange={(value) => {
                          setSettingsValues((current) => ({ ...current, spaces: value }))
                          if (settingsSpacesError) setSettingsSpacesError('')
                        }}
                      />
                      {!settingsConnectorConfig && (
                        <MuiTypography variant="caption" color="text.secondary">
                          正在读取当前空间配置；未配置时默认同步个人空间和共享空间。
                        </MuiTypography>
                      )}
                    </>
                  ) : (
                    <XDriveSynologyFileRootsField
                      value={settingsValues.roots ?? []}
                      error={Boolean(settingsRootsError)}
                      helperText={settingsRootsError || '每行一个 DSM 绝对目录；修改根目录不会删除已备份到 xDrive 的文件。'}
                      browse={setting.credential?.configured
                        ? (path, limit, offset) => adapter.sourceBrowseDirectories(setting.source.id, path, limit, offset)
                        : undefined}
                      onChange={(value) => {
                        setSettingsValues((current) => ({ ...current, roots: value }))
                        if (settingsRootsError) setSettingsRootsError('')
                      }}
                    />
                  )}
                  <MuiBox>
                    <XDriveActionButton
                      compact
                      disabled={testingSettingsCredential}
                      loading={testingSettingsCredential}
                      loadingLabel="正在测试…"
                      onClick={() => void testSettingsCredential()}
                    >
                      测试连接
                    </XDriveActionButton>
                  </MuiBox>
                  {settingsCredentialTest && (
                    <XDriveStatusAlert tone="good">
                      {externalSourceCredentialTestSuccessLabel(settingsCredentialTest)}
                    </XDriveStatusAlert>
                  )}
                  {settingsCredentialTestError && <XDriveStatusAlert tone="bad">{settingsCredentialTestError}</XDriveStatusAlert>}
                  {setting.credential?.configured && (
                    <MuiBox>
                      <XDriveActionButton
                        intent="danger"
                        disabled={clearingCookie}
                        onClick={() => setClearCookieConfirmOpen(true)}
                      >
                        清除 DSM 凭据
                      </XDriveActionButton>
                    </MuiBox>
                  )}
                </>
              )}

            </Stack>
          </MuiBox>
        )}
        </XDriveDialogContent>
        {setting && (
          <XDriveDialogActions>
            <XDriveActionButton
              intent="danger"
              disabled={savingSettings || setting.latestRun?.status === 'running'}
              onClick={() => setDeleteTarget(setting)}
            >
              删除同步文件夹
            </XDriveActionButton>
            <XDriveDialogActionSpacer />
            <XDriveActionButton
              onClick={() => {
                setClearCookieConfirmOpen(false)
                setSettingsCredentialReveal(null)
                setSetting(null)
                setSettingsValues(emptySourceSettingsValues())
                setSettingsRootsError('')
                setSettingsNameError('')
                setSettingsSpacesError('')
              }}
            >
              取消
            </XDriveActionButton>
            <XDriveActionButton
              intent="primary"
              type="submit"
              form="external-source-settings-form"
              loading={savingSettings}
              loadingLabel="正在保存…"
            >
              保存设置
            </XDriveActionButton>
          </XDriveDialogActions>
        )}
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => deletingSourceID === null && setDeleteTarget(null)} maxWidth="sm" fullWidth slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="删除同步文件夹？" onClose={() => setDeleteTarget(null)} closeDisabled={deletingSourceID !== null} />
        <XDriveDialogContent>
          <DialogContentText>
            删除“{deleteTarget?.source.name ?? ''}”只会移除同步配置、运行记录、同步文件夹映射和已保存凭据。
            已经同步到 xDrive 的文件会保留，不会删除。
          </DialogContentText>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={deletingSourceID !== null} onClick={() => setDeleteTarget(null)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent="danger"
            disabled={deletingSourceID !== null}
            loading={deletingSourceID !== null}
            loadingLabel="正在删除…"
            onClick={() => void deleteSource()}
          >
            删除同步文件夹
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog
        open={clearCookieConfirmOpen}
        onClose={() => !clearingCookie && setClearCookieConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={`清除已保存的${setting ? externalSourceCredentialLabel(externalSourceConnectorProfile(setting.source.kind, setting.source.direction)) : '凭据'}？`}
          onClose={() => setClearCookieConfirmOpen(false)}
          closeDisabled={clearingCookie}
        />
        <XDriveDialogContent>
          <DialogContentText>
            清除后，该 Pull 同步文件夹会自动暂停，无法继续扫描或同步，直到重新配置有效凭据。
          </DialogContentText>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={clearingCookie} onClick={() => setClearCookieConfirmOpen(false)}>取消</XDriveActionButton>
          <XDriveActionButton
            intent="danger"
            disabled={clearingCookie}
            loading={clearingCookie}
            loadingLabel="正在清除…"
            onClick={() => void clearCookie()}
          >
            清除凭据
          </XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <Dialog open={!!errorDialog} onClose={() => setErrorDialog(null)} maxWidth="sm" fullWidth scroll="paper" slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title={errorDialog?.title ?? '操作失败'} onClose={() => setErrorDialog(null)} />
        <XDriveDialogContent dividers>
          {errorDialog && (
            <Stack spacing={1.5}>
              <XDriveStatusAlert tone="bad">{errorDialog.message}</XDriveStatusAlert>
              {errorDialog.detail && (
                <MuiBox>
                  <MuiTypography variant="caption" color="text.secondary">详细信息</MuiTypography>
                  <MuiTypography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {errorDialog.detail}
                  </MuiTypography>
                </MuiBox>
              )}
            </Stack>
          )}
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton intent="primary" onClick={() => setErrorDialog(null)}>知道了</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <XDriveFeedbackSnackbar
        open={Boolean(feedback)}
        tone="good"
        message={feedback}
        onClose={() => setFeedback('')}
      />

      <SynologyDsmGuideDialog
        open={!!guideSource}
        source={guideSource}
        serverURL={window.location.origin}
        username={guideUsername}
        onClose={() => setGuideSource(null)}
      />
    </>
  )
}
