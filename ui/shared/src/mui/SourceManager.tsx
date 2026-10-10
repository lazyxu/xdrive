import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { XDriveFeedbackSnackbar } from './FeedbackSnackbar'
import { XDriveSourceCreateDialog } from './SourceManagerCreateDialog'
import { XDriveSourceManagerListPage } from './SourceManagerListPage'
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
  XDriveSourceRunFailurePage,
} from './SourceManagerDetailsDialog'
import { XDriveSynologyDsmGuideDialog as SynologyDsmGuideDialog } from './SynologyDsmGuideDialog'
import {
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCredentialLabel,
  externalSourceCredentialTestErrorLabel,
  externalSourceDefaults,
  normalizeSynologyFileRoots,
  normalizeSynologyPhotoSpaces,
  synologyFileRootsValidationError,
} from '../external-sources'
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
  SynologyPhotoSpace,
  SupportedExternalSourceKind,
  UpdateExternalSourceInput,
} from '../external-sources'

export interface XDriveSourceManagerAdapter {
  authorizeLocalFolder?(sourceID: number): Promise<{ cancelled: boolean; grant?: { root_id: string; path: string; status: string } }>
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
  directionFilter?: 'pull'
  initialSourceID?: number
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

function initialCreateSourceValues(preset: ExternalSourceCreatePreset = 'synology_push'): XDriveSourceCreateValues {
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
  defaultTargetNodeID,
  defaultTargetLabel,
  defaultTargetPath,
  targetBrowser,
  cookieHelpVariant = 'accordion',
  onSelectedSourceChange,
  onError,
}: XDriveSourceManagerProps) {
  const [rows, setRows] = useState<ExternalSourceRow[]>([])
  const initialSourceOpenedRef = useRef<number | null>(null)
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
  const [runFailurePages, setRunFailurePages] = useState<Record<string, XDriveSourceRunFailurePage>>({})
  const [collections, setCollections] = useState<ExternalSourceCollection[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionItemPages, setCollectionItemPages] = useState<Record<number, XDriveSourceCollectionItemPage>>({})
  const [setting, setSetting] = useState<ExternalSourceRow | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsValues, setSettingsValues] = useState<XDriveSourceSettingsValues>(emptySourceSettingsValues)
  const [settingsNameError, setSettingsNameError] = useState('')
  const [settingsSpacesError, setSettingsSpacesError] = useState('')
  const [settingsRootsError, setSettingsRootsError] = useState('')
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
  const [errorDialog, setErrorDialog] = useState<XDriveSourceErrorDialogState | null>(null)
  const [feedback, setFeedback] = useState('')
  const [clearCookieConfirmOpen, setClearCookieConfirmOpen] = useState(false)
  const [clearingCookie, setClearingCookie] = useState(false)
  const [settingsConnectorConfig, setSettingsConnectorConfig] = useState<ExternalSourceConnectorConfig | null>(null)
  const [settingsConnectorLoading, setSettingsConnectorLoading] = useState(false)
  const [settingsConnectorError, setSettingsConnectorError] = useState('')
  const settingsSessionRef = useRef(0)
  const [createValues, setCreateValues] = useState<XDriveSourceCreateValues>(() => initialCreateSourceValues(directionFilter === 'pull' ? 'synology_pull' : 'synology_push'))
  const [createNameError, setCreateNameError] = useState('')
  const [createSpacesError, setCreateSpacesError] = useState('')
  const [createRootsError, setCreateRootsError] = useState('')
  const createPreset = createValues.preset
  const createOption = externalSourceCreateOption(createPreset)
  const createProfile = externalSourceConnectorProfile(createOption.kind, createOption.direction)
  const createTarget = createTargetCrumbs.at(-1)
  const selectedCreateTargetNodeID = targetBrowser ? createTarget?.id : defaultTargetNodeID

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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const overview = await adapter.sourceOverview()
      const next: ExternalSourceRow[] = overview
        .filter((item) => directionFilter !== 'pull' || item.source.direction === 'pull')
        .map((item) => ({
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
  }, [adapter, directionFilter, onError])

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
    setCreateValues(initialCreateSourceValues(directionFilter === 'pull' ? 'synology_pull' : 'synology_push'))
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
    if (directionFilter === 'pull' && option.direction !== 'pull') return
    const defaults = externalSourceDefaults(option.kind, option.direction)
    setCreateValues((current) => ({
      ...current,
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
    if (directionFilter === 'pull' && option.direction !== 'pull') {
      setErrorDialog({ title: '无法添加同步文件夹', message: '远程拉取只支持 Pull 同步文件夹。' })
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
        sync_mode: values.sync_mode,
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
            setFeedback('已取消创建；本机未绑定的同步文件夹草稿已安全清理')
            setCreateOpen(false)
            setCreateValues(initialCreateSourceValues(directionFilter === 'pull' ? 'synology_pull' : 'synology_push'))
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
          message: '同步文件夹已创建并保持暂停。可从详情重新选择本机目录；当前不会扫描或上传文件。',
          detail: sourceActionErrorMessage(error, '授权失败'),
        })
      }
    }

    setFeedback(option.kind === 'local_folder'
      ? localAuthorization === 'bound'
        ? '本机目录已授权；同步执行器尚未启用，目前不会上传文件'
        : '同步文件夹已创建并暂停；请从详情选择本机目录以完成授权'
      : option.kind === 'synology_files'
      ? '群晖 File Station Pull 同步文件夹已添加；将同步所选目录中的所有文件和文件夹'
      : '同步文件夹已添加')
    setCreateOpen(false)
    setCreateValues(initialCreateSourceValues(directionFilter === 'pull' ? 'synology_pull' : 'synology_push'))
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateRootsError('')
    await load()
    setCreating(false)

    if (profile.manualTriggerExecutor === 'source_agent') {
      openSynologyGuide(created)
    }
  }


  const authorizeLocalFolder = async (row: ExternalSourceRow) => {
    if (!adapter.authorizeLocalFolder || row.source.kind !== 'local_folder') return
    try {
      const result = await adapter.authorizeLocalFolder(row.source.id)
      if (result.cancelled) return
      setFeedback('本机目录已授权；实际同步引擎尚未启用，不会传输文件')
      await load()
    } catch (error) {
      showActionError('本机目录授权失败', error, '请确认设备在线、目录可读，并检查是否已绑定其他目录。')
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
    if (savingSettings) return
    ++settingsSessionRef.current
    const profile = externalSourceConnectorProfile(row.source.kind, row.source.direction)
    setSetting(row)
    setSettingsConnectorConfig(null)
    setSettingsConnectorLoading(false)
    setSettingsConnectorError('')
    setSettingsValues({
      name: row.source.name,
      sync_mode: row.source.sync_mode,
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
    const session = settingsSessionRef.current
    setRevealingSettingsCredential(true)
    try {
      const revealed = await adapter.revealSourceCredential(setting.source.id)
      if (session === settingsSessionRef.current) setSettingsCredentialReveal(revealed)
    } catch (error) {
      if (session !== settingsSessionRef.current) return
      setSettingsCredentialReveal(null)
      showActionError('显示凭据失败', error, '无法读取已保存凭据，请稍后重试。')
    } finally {
      if (session === settingsSessionRef.current) setRevealingSettingsCredential(false)
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
      setSettingsCredentialTestError('更新 DSM 凭据时请完整填写地址、用户名和密码')
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
    if (!setting || savingSettings) return
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    // Never write guessed/default roots or spaces before the persisted connector
    // scope is known; this guard also protects keyboard/native form submission.
    if (profile.credential === 'synology_dsm' &&
        (settingsConnectorLoading || Boolean(settingsConnectorError) || !settingsConnectorConfig)) return
    const values = settingsValues
    const normalizedName = values.name.trim()
    const nameError = !normalizedName ? '请填写同步文件夹名称' : normalizedName.length > 128 ? '同步文件夹名称不能超过 128 个字符' : ''
    const isSynologyFiles = setting.source.kind === 'synology_files'
    const isLocalFolder = setting.source.kind === 'local_folder'
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
        sync_mode: isLocalFolder ? 'backup' : values.sync_mode,
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

      setFeedback('同步文件夹设置已保存')
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
    onSelectedSourceChange?.(row.source.id)
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

  useEffect(() => {
    if (!initialSourceID || initialSourceOpenedRef.current === initialSourceID) return
    const row = rows.find((candidate) => candidate.source.id === initialSourceID)
    if (!row) return
    initialSourceOpenedRef.current = initialSourceID
    void openDetails(row)
  }, [initialSourceID, rows])

  const closeDetails = () => {
    setSelected(null)
    onSelectedSourceChange?.()
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

  const copyRunID = (runID: string) => {
    void navigator.clipboard.writeText(runID)
      .then(() => setFeedback('运行 ID 已复制'))
      .catch((error) => showActionError('复制运行 ID 失败', error, '无法自动复制运行 ID，请手动复制。'))
  }

  return (
    <>
      <XDriveSourceManagerListPage
        title={directionFilter === 'pull' ? '远程拉取' : '同步文件夹'}
        subtitle={directionFilter === 'pull' ? '由 xDrive Server 管理远程连接、扫描和下载。' : undefined}
        rows={rows}
        loading={loading}
        failedItemsLoading={failedItemsLoading}
        triggeringSourceID={triggeringSourceID}
        cancellingRunID={cancellingRunID}
        onRefresh={load}
        onAdd={openCreate}
        onOpenError={(row) => setErrorDialog({
          title: `${row.source.name} · 最近一次运行错误`,
          message: row.source.last_error || '未提供具体错误信息',
        })}
        onOpenDetails={openDetails}
        onOpenSynologyGuide={(row) => openSynologyGuide(row.source)}
        onTriggerNow={triggerNow}
        onCancelRun={cancelRun}
        onOpenSettings={openSettings}
      />

      <XDriveSourceDetailsDialog
        row={selected}
        collections={collections}
        collectionsLoading={collectionsLoading}
        collectionItemPages={collectionItemPages}
        collectionPageSize={SOURCE_COLLECTION_ITEM_PAGE_SIZE}
        historyRuns={historyRuns}
        historyPage={historyPage}
        historyHasNext={historyHasNext}
        historyLoading={historyLoading}
        historyPageSize={SOURCE_HISTORY_PAGE_SIZE}
        runFailurePages={runFailurePages}
        runFailurePageSize={SOURCE_RUN_FAILURE_PAGE_SIZE}
        failedItems={failedItems}
        failedItemsLoading={failedItemsLoading}
        triggeringSourceID={triggeringSourceID}
        cancellingRunID={cancellingRunID}
        onClose={closeDetails}
        onLoadCollectionItems={loadCollectionItems}
        onLoadRunHistory={loadRunHistory}
        onLoadRunFailures={loadRunFailures}
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
        targetBrowsingEnabled={Boolean(targetBrowser)}
        targetCrumbs={createTargetCrumbs}
        targetDirectories={createTargetDirectories}
        targetLoading={createTargetLoading}
        defaultTargetLabel={defaultTargetLabel}
        defaultTargetPath={defaultTargetPath}
        cookieHelpVariant={cookieHelpVariant}
        testingCredential={testingCreateCredential}
        credentialTest={createCredentialTest}
        credentialTestError={createCredentialTestError}
        onRequestClose={() => {
          if (creating) return
          setCreateOpen(false)
          setCreateValues(initialCreateSourceValues(directionFilter === 'pull' ? 'synology_pull' : 'synology_push'))
        }}
        onCancel={() => {
          setCreateOpen(false)
          setCreateValues(initialCreateSourceValues(directionFilter === 'pull' ? 'synology_pull' : 'synology_push'))
          setCreateNameError('')
          setCreateSpacesError('')
          setCreateRootsError('')
        }}
        onSubmit={(event) => {
          void createSource(event)
        }}
        onPresetChange={changeCreatePreset}
        onChange={(patch) => {
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
        onLoadTargetDirectory={(node, crumbs) => {
          void loadCreateTargetDirectory(node, crumbs)
        }}
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
          if (setting) setDeleteTarget(setting)
        }}
      />

      <XDriveSourceDeleteConfirmDialog
        open={Boolean(deleteTarget)}
        sourceName={deleteTarget?.source.name ?? ''}
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
