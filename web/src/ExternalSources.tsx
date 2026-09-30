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
  Card,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContentText,
  Divider as MuiDivider,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select as MuiSelect,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography as MuiTypography,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { XDriveApi } from './api'
import WorkspaceSurface from './WorkspaceSurface'
import {
  XDriveActionButton,
  XDriveDialogActions,
  XDriveDialogContent,
  XDriveDialogTitle,
  XDrivePaginationControls,
  XDriveStatePanel,
  XDriveStatusAlert,
  XDriveStatusBadge,
  XDriveSourceRunProgress,
  XDriveSourceRunSummary,
  XDriveSourceFailureItem,
  XDriveSynologyDsmGuideDialog as SynologyDsmGuideDialog,
  XDriveYikeCookieHelp,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import {
  externalSourceCardView,
  externalSourceCollectionKindLabel,
  externalSourceCollectionStateLabel,
  externalSourceCollectionStateTone,
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCreateOptions,
  externalSourceCredentialLabel,
  externalSourceCredentialTestErrorLabel,
  externalSourceSavedCredentialMask,
  isExternalSourceSavedCredentialMask,
  externalSourceCredentialTestSuccessLabel,
  externalSourceDefaults,
  externalSourceDetailView,
  externalSourceRunDetailView,
  externalSourceTriggerActionLabel,
  formatExternalSourceTime,
  formatSize,
  normalizeSynologyPhotoSpaces,
  synologyPhotoSpaceOptions,
  yikeConnectorNotice,
  yikeManagedTargetLabel,
} from '../../ui/shared/src'
import type {
  ExternalSource,
  ExternalSourceCollection,
  ExternalSourceCollectionItem,
  ExternalSourceConnectorConfig,
  ExternalSourceCreatePreset,
  ExternalSourceCredentialTestResult,
  ExternalSourceItem,
  ExternalSourceRow,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  ExternalSourceScheduleType,
  SynologyPhotoSpace,
  SupportedExternalSourceKind,
} from '../../ui/shared/src'

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
  return externalSourceCredentialTestErrorLabel(value)
}

function SourceDescriptionGrid({ children }: { children: ReactNode }) {
  return (
    <MuiBox
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
        borderTop: 1,
        borderLeft: 1,
        borderColor: 'divider',
      }}
    >
      {children}
    </MuiBox>
  )
}

function SourceDescriptionItem({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <MuiBox
      sx={{
        minWidth: 0,
        p: 1.25,
        borderRight: 1,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
        {label}
      </MuiTypography>
      <MuiBox sx={{ fontSize: 14, overflowWrap: 'anywhere' }}>{children}</MuiBox>
    </MuiBox>
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
  }
}

function selectedPhotoSpaces(value: string | SynologyPhotoSpace[]): SynologyPhotoSpace[] {
  const spaces = (typeof value === 'string' ? value.split(',') : value)
    .filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
  return normalizeSynologyPhotoSpaces(spaces)
}

function photoSpaceLabel(value: SynologyPhotoSpace) {
  return synologyPhotoSpaceOptions.find((option) => option.value === value)?.label ?? value
}

export default function ExternalSourcesPanel({
  open,
  presentation = 'dialog',
  api,
  defaultTargetNodeID,
  defaultTargetLabel,
  defaultTargetPath,
  onClose,
  onError,
}: {
  open: boolean
  presentation?: 'dialog' | 'page'
  api: XDriveApi
  defaultTargetNodeID?: number
  defaultTargetLabel: string
  defaultTargetPath: string
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const surfaceOpen = presentation === 'page' || open
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
  const settingsScheduleType = settingsValues.schedule_type
  const settingsScheduleExpression = settingsValues.schedule_expression
  const settingsScheduleTimezone = settingsValues.schedule_timezone
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [triggeringSourceID, setTriggeringSourceID] = useState<number | null>(null)
  const [cancellingRunID, setCancellingRunID] = useState<string | null>(null)
  const [testingCreateCredential, setTestingCreateCredential] = useState(false)
  const [createCredentialTest, setCreateCredentialTest] = useState<ExternalSourceCredentialTestResult | null>(null)
  const [createCredentialTestError, setCreateCredentialTestError] = useState('')
  const [testingSettingsCredential, setTestingSettingsCredential] = useState(false)
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
  const createScheduleType = createValues.schedule_type
  const createScheduleExpression = createValues.schedule_expression
  const createScheduleTimezone = createValues.schedule_timezone
  const createPreset = createValues.preset
  const createOption = externalSourceCreateOption(createPreset)
  const createProfile = externalSourceConnectorProfile(createOption.kind, createOption.direction)

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
      const overview = await api.sourceOverview()
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
  }, [api, onError])

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
      const failures = await api.sourceRunFailures(sourceID, runID, SOURCE_RUN_FAILURE_PAGE_SIZE + 1, offset)
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
  }, [api, onError])

  useEffect(() => {
    if (surfaceOpen) void load()
  }, [surfaceOpen, load])

  useEffect(() => {
    const delay = sourceActivityPollDelay(rows)
    if (!surfaceOpen || delay === null) return

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
  }, [surfaceOpen, rows, load])
  const loadRunHistory = useCallback(async (sourceID: number, page: number, silent = false) => {
    const nextPage = Math.max(1, Math.trunc(page))
    if (!silent) setHistoryLoading(true)
    try {
      const offset = (nextPage - 1) * SOURCE_HISTORY_PAGE_SIZE
      const runs = await api.sourceRuns(sourceID, SOURCE_HISTORY_PAGE_SIZE + 1, offset)
      setHistoryRuns(runs.slice(0, SOURCE_HISTORY_PAGE_SIZE))
      setHistoryHasNext(runs.length > SOURCE_HISTORY_PAGE_SIZE)
      setHistoryPage(nextPage)
    } catch (error) {
      onError(error)
    } finally {
      if (!silent) setHistoryLoading(false)
    }
  }, [api, onError])

  useEffect(() => {
    const delay = selectedSourcePollDelay(selected)
    if (!surfaceOpen || !selected || historyPage !== 1 || delay === null) return

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
  }, [surfaceOpen, selected, historyPage, loadRunHistory])

  const openSynologyGuide = (source: ExternalSource) => {
    setGuideSource(source)
    void api.me()
      .then((me) => setGuideUsername(me.username))
      .catch(() => setGuideUsername(undefined))
  }

  const openCreate = () => {
    setCreateValues(initialCreateSourceValues())
    setCreateNameError('')
    setCreateSpacesError('')
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    setCreateOpen(true)
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
    }))
    setCreateNameError('')
    setCreateSpacesError('')
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
      const result = await api.testSourceCredential(createOption.kind, payload)
      setCreateCredentialTest(result)
      return result
    } catch (error) {
      setCreateCredentialTest(null)
      setCreateCredentialTestError(externalSourceCredentialTestErrorLabel(error instanceof Error ? error.message : String(error)))
      return null
    } finally {
      setTestingCreateCredential(false)
    }
  }

  const createSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = createValues
    const normalizedName = values.name.trim()
    const nameError = !normalizedName ? '请填写来源名称' : normalizedName.length > 128 ? '来源名称不能超过 128 个字符' : ''
    setCreateNameError(nameError)
    const option = externalSourceCreateOption(values.preset)
    const profile = externalSourceConnectorProfile(option.kind, option.direction)
    const spacesError = profile.credential === 'synology_dsm' && !(values.spaces?.length) ? '至少选择一个照片空间' : ''
    setCreateSpacesError(spacesError)
    if (nameError || spacesError) return
    if (option.kind !== 'yike_photos' && !defaultTargetNodeID) {
      setErrorDialog({ title: '无法添加来源', message: '当前目标文件夹尚未加载，请稍后重试。' })
      return
    }
    const credentialPayload = profile.credential ? createCredentialPayload() : null
    if (profile.credential && !credentialPayload) {
      setErrorDialog({
        title: '无法添加来源',
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
      created = await api.createSource({
        name: normalizedName,
        kind: option.kind,
        direction: option.direction,
        sync_mode: 'backup',
        run_mode: values.run_mode,
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
        target_node_id: option.kind === 'yike_photos' ? 0 : (defaultTargetNodeID ?? 0),
        ignore_rules: values.ignore_rules ?? '',
      })
    } catch (error) {
      showActionError('添加来源失败', error, '创建外部来源失败，请稍后重试。')
      setCreating(false)
      return
    }

    try {
      if (profile.credential === 'synology_dsm') {
        const config = await api.sourceConnectorConfig(created.id)
        await api.setSourceConnectorConfig(created.id, config.revision, { spaces })
      }
      if (profile.credential && credentialPayload) {
        await api.setSourceCredential(created.id, credentialPayload)
      }
    } catch (error) {
      const credentialLabel = externalSourceCredentialLabel(profile)
      try {
        await api.deleteSource(created.id, created.revision)
        setErrorDialog({
          title: profile.credential === 'synology_dsm' ? '群晖连接配置失败' : 'Cookie 保存失败',
          message: `刚创建的${profile.label}来源已自动撤销，请检查配置后重试。`,
          detail: sourceActionErrorMessage(error, `保存${credentialLabel}失败`),
        })
        await load()
        setCreating(false)
        return
      } catch (rollbackError) {
        setErrorDialog({
          title: '来源创建未完成',
          message: `来源已创建，但${credentialLabel}或连接配置保存失败且自动回滚也失败。请进入“设置”修复或删除该来源。`,
          detail: `配置：${sourceActionErrorMessage(error, '保存失败')}；回滚：${sourceActionErrorMessage(rollbackError, '回滚失败')}`,
        })
      }
    }

    setFeedback('外部来源已添加')
    setCreateOpen(false)
    setCreateValues(initialCreateSourceValues())
    setCreateNameError('')
    setCreateSpacesError('')
    await load()
    setCreating(false)

    if (profile.manualTriggerExecutor === 'source_agent') {
      openSynologyGuide(created)
    }
  }


  const triggerNow = async (row: ExternalSourceRow) => {
    setTriggeringSourceID(row.source.id)
    try {
      await api.triggerSource(row.source.id)
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
      await api.cancelSourceRun(row.source.id, run.id)
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
      cookie: profile.credential === 'cookie' && row.credential?.configured ? externalSourceSavedCredentialMask : '',
      base_url: '',
      username: '',
      password: '',
      spaces: ['personal', 'shared'],
    })
    setSettingsNameError('')
    setSettingsSpacesError('')
    setSettingsCredentialTest(null)
    setSettingsCredentialTestError('')
    if (profile.credential === 'synology_dsm') {
      void api.sourceConnectorConfig(row.source.id)
        .then((config) => {
          setSettingsConnectorConfig(config)
          const spaces = Array.isArray(config.payload.spaces)
            ? config.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
            : []
          setSettingsValues((current) => ({ ...current, spaces: spaces.length ? spaces : ['personal', 'shared'] }))
        })
        .catch((error) => {
          setSettingsCredentialTestError(sourceActionErrorMessage(error, '读取群晖空间配置失败'))
        })
    }
  }

  const settingsCredentialPayload = () => {
    if (!setting) return null
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    if (profile.credential === 'cookie') {
      const rawCookie = String(settingsValues.cookie ?? '')
      if (isExternalSourceSavedCredentialMask(rawCookie)) return null
      const cookie = rawCookie.trim()
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
        ? await api.testSourceCredential(setting.source.kind, pending)
        : await api.testStoredSourceCredential(setting.source.id)
      setSettingsCredentialTest(result)
      return result
    } catch (error) {
      setSettingsCredentialTest(null)
      setSettingsCredentialTestError(externalSourceCredentialTestErrorLabel(error instanceof Error ? error.message : String(error)))
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
    const nameError = !normalizedName ? '请填写来源名称' : normalizedName.length > 128 ? '来源名称不能超过 128 个字符' : ''
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
    const spacesError = profile.credential === 'synology_dsm' && !(values.spaces?.length) ? '至少选择一个照片空间' : ''
    setSettingsNameError(nameError)
    setSettingsSpacesError(spacesError)
    if (nameError || spacesError) return
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
      await api.updateSource(setting.source.id, setting.source.revision, {
        name: normalizedName,
        run_mode: values.run_mode,
        status: pendingCredential && !setting.credential?.configured ? 'paused' : values.status,
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
        ignore_rules: values.ignore_rules ?? '',
      })

      if (profile.credential === 'synology_dsm') {
        const desiredSpaces = normalizeSynologyPhotoSpaces(values.spaces?.length ? values.spaces : ['personal', 'shared'])
        const config = settingsConnectorConfig ?? await api.sourceConnectorConfig(setting.source.id)
        const currentSpaces = Array.isArray(config.payload.spaces)
          ? config.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
          : []
        if (currentSpaces.join(',') !== desiredSpaces.join(',')) {
          const updatedConfig = await api.setSourceConnectorConfig(setting.source.id, config.revision, { spaces: desiredSpaces })
          setSettingsConnectorConfig(updatedConfig)
        }
      }

      if (pendingCredential) {
        await api.setSourceCredential(setting.source.id, pendingCredential)
      }

      if (pendingCredential && values.status === 'paused') {
        const overview = await api.sourceOverview()
        const fresh = overview.find((item) => item.source.id === setting.source.id)?.source
        if (fresh && fresh.status !== 'paused') {
          await api.updateSource(fresh.id, fresh.revision, { status: 'paused' })
        }
      }

      setFeedback('来源设置已保存')
      setSetting(null)
      setSettingsConnectorConfig(null)
      setSettingsValues(emptySourceSettingsValues())
      setSettingsNameError('')
      setSettingsSpacesError('')
      await load()
    } catch (error) {
      showActionError('保存来源设置失败', error, '来源设置未保存，请检查后重试。')
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
      await api.deleteSourceCredential(setting.source.id)
      setFeedback(`${label}已清除，来源已自动暂停`)
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
      await api.deleteSource(row.source.id, row.source.revision)
      setFeedback('来源已删除；已同步到 xDrive 的文件已保留')
      if (selected?.source.id === row.source.id) setSelected(null)
      if (setting?.source.id === row.source.id) {
        setSetting(null)
        setSettingsValues(emptySourceSettingsValues())
        setSettingsNameError('')
        setSettingsSpacesError('')
      }
      setDeleteTarget(null)
      await load()
    } catch (error) {
      showActionError('删除来源失败', error, '外部来源未删除，请稍后重试。')
      await load()
    } finally {
      setDeletingSourceID(null)
    }
  }

  const loadCollections = useCallback(async (sourceID: number) => {
    setCollectionsLoading(true)
    try {
      setCollections(await api.sourceCollections(sourceID))
    } catch (error) {
      showActionError('加载相册/集合失败', error, '无法读取该来源的相册/集合，请稍后重试。')
    } finally {
      setCollectionsLoading(false)
    }
  }, [api])

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
      const items = await api.sourceCollectionItems(
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
  }, [api])

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
      const items = await api.sourceItems(row.source.id, 'error', 1000, 0)
      setFailedItems(items)
      setFailedItemsLimitReached(items.length >= 1000)
    } catch (error) {
      showActionError('加载来源详情失败', error, '无法读取当前失败文件列表，请稍后重试。')
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
      <WorkspaceSurface
        presentation={presentation}
        open={open}
        onClose={onClose}
        title="外部来源"
        maxWidth="md"
        dialogActions={<XDriveActionButton onClick={onClose}>关闭</XDriveActionButton>}
      >
      <div className="external-sources-toolbar">
        <Stack direction="row" spacing={1}>
          <XDriveActionButton
            startIcon={<RefreshRoundedIcon />}
            loading={loading}
            loadingLabel="正在刷新…"
            onClick={() => void load()}
          >
            刷新
          </XDriveActionButton>
          <XDriveActionButton intent="primary" startIcon={<AddRoundedIcon />} onClick={openCreate}>
            添加来源
          </XDriveActionButton>
        </Stack>
      </div>
      {loading && rows.length === 0 ? (
        <XDriveStatePanel variant="plain" loading message="正在加载外部来源…" />
      ) : rows.length === 0 ? (
          <XDriveStatePanel variant="plain" message="尚未添加外部来源" />
        ) : (
          <div className="external-source-list">
            {rows.map((row) => {
              const card = externalSourceCardView(row)
              const stats = card.scannedItems === undefined || card.scannedBytes === undefined
                ? '尚无扫描统计'
                : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatSize(card.scannedBytes)}${card.failedItems ? ` · 失败 ${card.failedItems}` : ''}`

              return (
                <Card key={row.source.id} variant="outlined" className="external-source-card" sx={{ p: '18px 20px', borderRadius: 2 }}>
                  <div className="external-source-card-header">
                    <div>
                      <MuiTypography component="h3" variant="h6" fontWeight={700}>{row.source.name}</MuiTypography>
                      <div className="external-source-subtitle">{card.modeLabel}</div>
                    </div>
                    <XDriveStatusBadge tone={card.state.tone} label={card.state.label} />
                  </div>
                  <div className="external-source-time">{card.lastActivityLabel}：{formatExternalSourceTime(card.lastActivityAt)}</div>
                  <div className="external-source-card-meta">
                    <div className="external-source-stats">{stats}</div>
                    {row.source.last_error && !row.source.run_requested_at && row.latestRun?.status !== 'running' && (
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
                    )}
                  </div>
                  <div className="external-source-actions">
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" justifyContent="flex-end">
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
                    </Stack>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </WorkspaceSurface>

      <Dialog open={!!selected} onClose={closeDetails} maxWidth="md" fullWidth scroll="paper" slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title={selected ? `${selected.source.name} · 来源详情` : '来源详情'} onClose={closeDetails} />
        <XDriveDialogContent dividers>
        {selected && selectedDetail && (
          <>
            {selectedDetail.error && (
              <XDriveStatusAlert tone="bad" sx={{ mb: 2 }}>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>最近一次运行异常</MuiTypography>
                <MuiTypography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedDetail.error}</MuiTypography>
              </XDriveStatusAlert>
            )}
            <SourceDescriptionGrid>
              <SourceDescriptionItem label="来源类型">{selectedDetail.kindLabel}</SourceDescriptionItem>
              <SourceDescriptionItem label="工作方式">{selectedDetail.modeLabel}</SourceDescriptionItem>
              <SourceDescriptionItem label="状态">
                <XDriveStatusBadge tone={selectedDetail.state.tone} label={selectedDetail.state.label} />
              </SourceDescriptionItem>
              <SourceDescriptionItem label="目标目录">
                {selected.source.kind === 'yike_photos'
                  ? yikeManagedTargetLabel
                  : selectedDetail.targetNodeID ? `节点 #${selectedDetail.targetNodeID}` : '未配置'}
              </SourceDescriptionItem>
              <SourceDescriptionItem label="调度">{selectedDetail.scheduleLabel}</SourceDescriptionItem>
              <SourceDescriptionItem label="上次运行">{formatExternalSourceTime(selectedDetail.lastRunAt)}</SourceDescriptionItem>
              <SourceDescriptionItem label="上次成功">{formatExternalSourceTime(selectedDetail.lastSuccessAt)}</SourceDescriptionItem>
              {selectedDetail.credential && (
                <SourceDescriptionItem label={selectedDetail.credential.label}>
                  {selectedDetail.credential.configured ? '已配置' : '未配置'}
                </SourceDescriptionItem>
              )}
            </SourceDescriptionGrid>

            <MuiDivider textAlign="left" sx={{ my: 2 }}>相册与集合</MuiDivider>
            {collectionsLoading ? (
              <XDriveStatePanel loading variant="plain" message="正在加载相册/集合" />
            ) : collections.length === 0 ? (
              <XDriveStatePanel variant="plain" message="该来源暂无相册/集合元数据" />
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
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ width: '100%', pr: 1 }}>
                          <MuiBox>
                            <MuiTypography variant="body2" sx={{ fontWeight: 700 }}>{collection.name}</MuiTypography>
                            <MuiTypography variant="caption" color="text.secondary">
                              {externalSourceCollectionKindLabel(collection.kind)} · {collection.item_count.toLocaleString('zh-CN')} 项 · 上次发现 {formatExternalSourceTime(collection.last_seen_at)}
                            </MuiTypography>
                          </MuiBox>
                          <XDriveStatusBadge
                            tone={externalSourceCollectionStateTone(collection.state)}
                            label={externalSourceCollectionStateLabel(collection.state)}
                          />
                        </Stack>
                      </AccordionSummary>
                      <AccordionDetails>
                        {page?.loading && !page.loaded ? (
                          <XDriveStatePanel loading variant="plain" message="正在加载集合成员" />
                        ) : page?.loaded && page.items.length > 0 ? (
                          <Stack spacing={0.75}>
                            {page.items.map((item) => (
                              <MuiBox key={item.external_id} sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                                  <MuiBox sx={{ minWidth: 0 }}>
                                    <MuiTypography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                                      {item.path || item.external_id}
                                    </MuiTypography>
                                    <MuiTypography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                                      {item.metadata?.captured_at ? '拍摄 ' + formatExternalSourceTime(item.metadata.captured_at) + ' · ' : ''}
                                      {formatSize(item.size)}
                                      {item.metadata?.original_path ? ' · 原始路径 ' + item.metadata.original_path : ''}
                                    </MuiTypography>
                                  </MuiBox>
                                  <XDriveStatusBadge
                                    tone={item.state === 'synced' ? 'good' : item.state === 'error' ? 'bad' : item.state === 'missing' ? 'warning' : 'neutral'}
                                    label={item.state === 'synced' ? '已同步' : item.state === 'missing' ? '远端缺失' : item.state === 'error' ? '失败' : item.state}
                                  />
                                </Stack>
                              </MuiBox>
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

            <MuiDivider textAlign="left" sx={{ my: 2 }}>同步历史</MuiDivider>
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
                          <XDriveSourceRunSummary runNumber={run.run_number} detail={runDetail} />
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
                          <SourceDescriptionGrid>
                            <SourceDescriptionItem label="运行编号">#{run.run_number > 0 ? run.run_number : '—'}</SourceDescriptionItem>
                            <SourceDescriptionItem label="内部运行 ID">
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
                            </SourceDescriptionItem>
                            <SourceDescriptionItem label="运行状态">
                              <XDriveStatusBadge tone={runDetail.statusTone} label={runDetail.statusLabel} />
                            </SourceDescriptionItem>
                            <SourceDescriptionItem label="耗时">{runDetail.durationLabel}</SourceDescriptionItem>
                            <SourceDescriptionItem label="开始时间">{formatExternalSourceTime(runDetail.startedAt)}</SourceDescriptionItem>
                            <SourceDescriptionItem label="结束时间">{runDetail.finishedAt ? formatExternalSourceTime(runDetail.finishedAt) : '进行中'}</SourceDescriptionItem>
                            <SourceDescriptionItem label="成功项">{runDetail.successItems.toLocaleString('zh-CN')} 项</SourceDescriptionItem>
                            <SourceDescriptionItem label="失败项">{runDetail.failedItems.toLocaleString('zh-CN')} 项</SourceDescriptionItem>
                            {runDetail.metrics.map((metric) => (
                              <SourceDescriptionItem key={metric.key} label={metric.label}>
                                {metric.items.toLocaleString('zh-CN')} 项
                                {metric.bytes === undefined ? '' : ' · ' + formatSize(metric.bytes)}
                              </SourceDescriptionItem>
                            ))}
                          </SourceDescriptionGrid>
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
          title="添加外部来源"
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
        ) : (
          <XDriveStatusAlert tone="neutral" sx={{ mb: 2 }}>
            <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>目标目录使用当前文件夹</MuiTypography>
            <MuiTypography variant="body2">
              当前目标：{defaultTargetLabel}{defaultTargetPath ? `（${defaultTargetPath}）` : '（我的文件根目录）'}
            </MuiTypography>
            {createOption.direction === 'pull' && (
              <MuiTypography variant="body2" sx={{ mt: 0.5 }}>
                Pull 模式由 xDrive Server 直接连接 DSM；请确保服务器网络可以访问下面填写的 DSM 地址。
              </MuiTypography>
            )}
          </XDriveStatusAlert>
        )}
        <MuiBox component="form" onSubmit={(event) => void createSource(event)}>
          <Stack spacing={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="来源类型"
              value={createValues.preset}
              onChange={(event) => changeCreatePreset(event.target.value as ExternalSourceCreatePreset)}
              helperText={createOption.description}
            >
              {externalSourceCreateOptions.map((item) => (
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              size="small"
              label="来源名称"
              value={createValues.name}
              error={Boolean(createNameError)}
              helperText={createNameError || ' '}
              onChange={(event) => {
                setCreateValues((current) => ({ ...current, name: event.target.value }))
                if (createNameError) setCreateNameError('')
              }}
            />
            <TextField
              select
              fullWidth
              size="small"
              label="初始运行模式"
              value={createValues.run_mode}
              onChange={(event) => setCreateValues((current) => ({ ...current, run_mode: event.target.value as 'scan' | 'sync' }))}
            >
              <MenuItem value="scan">仅扫描（推荐先使用）</MenuItem>
              <MenuItem value="sync">同步</MenuItem>
            </TextField>
            <MuiBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, gap: 1.5 }}>
              <TextField
                select
                size="small"
                label="调度方式"
                value={createScheduleType}
                onChange={(event) => setCreateValues((current) => ({ ...current, schedule_type: event.target.value as ExternalSourceScheduleType }))}
              >
                <MenuItem value="interval">固定间隔</MenuItem>
                <MenuItem value="cron">Cron</MenuItem>
                <MenuItem value="manual">仅手动</MenuItem>
              </TextField>
              {createScheduleType !== 'manual' && (
                <TextField
                  size="small"
                  label={createScheduleType === 'cron' ? 'Cron 表达式' : '运行间隔'}
                  value={createScheduleExpression}
                  onChange={(event) => setCreateValues((current) => ({ ...current, schedule_expression: event.target.value }))}
                  helperText={createScheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'}
                />
              )}
              {createScheduleType === 'cron' && (
                <TextField
                  size="small"
                  label="时区"
                  value={createScheduleTimezone}
                  onChange={(event) => setCreateValues((current) => ({ ...current, schedule_timezone: event.target.value }))}
                  helperText="IANA 时区，例如 Asia/Shanghai"
                  sx={{ gridColumn: { sm: '2 / 3' } }}
                />
              )}
            </MuiBox>
            <TextField
              fullWidth
              multiline
              rows={5}
              label="忽略规则"
              placeholder="每行一条 gitignore 风格规则"
              value={createValues.ignore_rules ?? ''}
              onChange={(event) => setCreateValues((current) => ({ ...current, ignore_rules: event.target.value }))}
            />
            {createProfile.credential === 'cookie' && (
              <>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label="一刻相册 Cookie"
                  autoComplete="off"
                  value={createValues.cookie ?? ''}
                  helperText="Cookie 只会加密保存到服务器，之后不会回传到浏览器。"
                  onChange={(event) => {
                    setCreateValues((current) => ({ ...current, cookie: event.target.value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
                <MuiBox>
                  <XDriveStatusAlert tone="warning" sx={{ mb: 1 }}>{yikeConnectorNotice}</XDriveStatusAlert>
                  <XDriveYikeCookieHelp variant="accordion" />
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
                <MuiDivider textAlign="left">Synology DSM 连接</MuiDivider>
                <TextField
                  fullWidth
                  size="small"
                  label="DSM 地址"
                  placeholder="https://nas.example.com:5001"
                  autoComplete="off"
                  value={createValues.base_url ?? ''}
                  helperText="填写 xDrive Server 实际能够访问的 DSM Origin，例如 https://nas.example.com:5001。"
                  onChange={(event) => {
                    setCreateValues((current) => ({ ...current, base_url: event.target.value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  label="DSM 用户名"
                  autoComplete="username"
                  value={createValues.username ?? ''}
                  onChange={(event) => {
                    setCreateValues((current) => ({ ...current, username: event.target.value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  label="DSM 密码"
                  autoComplete="new-password"
                  value={createValues.password ?? ''}
                  onChange={(event) => {
                    setCreateValues((current) => ({ ...current, password: event.target.value }))
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
                <FormControl fullWidth size="small" error={Boolean(createSpacesError)}>
                  <InputLabel id="create-source-spaces-label">同步空间</InputLabel>
                  <MuiSelect<SynologyPhotoSpace[]>
                    labelId="create-source-spaces-label"
                    multiple
                    value={createValues.spaces ?? []}
                    input={<OutlinedInput label="同步空间" />}
                    renderValue={(selected) => selected.map(photoSpaceLabel).join('、')}
                    onChange={(event: SelectChangeEvent<SynologyPhotoSpace[]>) => {
                      setCreateValues((current) => ({ ...current, spaces: selectedPhotoSpaces(event.target.value) }))
                      if (createSpacesError) setCreateSpacesError('')
                    }}
                  >
                    {synologyPhotoSpaceOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        <Checkbox checked={(createValues.spaces ?? []).includes(option.value)} />
                        <ListItemText primary={option.label} />
                      </MenuItem>
                    ))}
                  </MuiSelect>
                  <FormHelperText>{createSpacesError || '至少选择一个照片空间'}</FormHelperText>
                </FormControl>
                <XDriveStatusAlert tone="neutral" sx={{ mb: 1 }}>
                  DSM 凭据只会在服务器端加密保存；Pull worker 使用 Synology Photos API 只读发现和下载媒体，不会删除 NAS 中的照片。
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
            <MuiBox sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <XDriveActionButton
                onClick={() => {
                  setCreateOpen(false)
                  setCreateValues(initialCreateSourceValues())
                  setCreateNameError('')
                  setCreateSpacesError('')
                }}
              >
                取消
              </XDriveActionButton>
              <XDriveActionButton
                intent="primary"
                type="submit"
                loading={creating}
                loadingLabel="正在添加…"
              >
                添加来源
              </XDriveActionButton>
            </MuiBox>
          </Stack>
        </MuiBox>
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!setting}
        onClose={() => {
          if (savingSettings) return
          setClearCookieConfirmOpen(false)
          setSetting(null)
          setSettingsValues(emptySourceSettingsValues())
        }}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={setting ? `${setting.source.name} · 设置` : '来源设置'}
          onClose={() => {
            if (savingSettings) return
            setClearCookieConfirmOpen(false)
            setSetting(null)
            setSettingsValues(emptySourceSettingsValues())
          }}
          closeDisabled={savingSettings}
        />
        <XDriveDialogContent dividers>
        {setting && (
          <MuiBox component="form" onSubmit={(event) => void saveSettings(event)}>
            <Stack spacing={2}>
              <TextField
                autoFocus
                fullWidth
                size="small"
                label="来源名称"
                value={settingsValues.name}
                error={Boolean(settingsNameError)}
                helperText={settingsNameError || ' '}
                onChange={(event) => {
                  setSettingsValues((current) => ({ ...current, name: event.target.value }))
                  if (settingsNameError) setSettingsNameError('')
                }}
              />
              <TextField
                select
                fullWidth
                size="small"
                label="运行模式"
                value={settingsValues.run_mode}
                onChange={(event) => setSettingsValues((current) => ({ ...current, run_mode: event.target.value as 'scan' | 'sync' }))}
              >
                <MenuItem value="sync">同步</MenuItem>
                <MenuItem value="scan">仅扫描</MenuItem>
              </TextField>
              <TextField
                select
                fullWidth
                size="small"
                label="来源状态"
                value={settingsValues.status}
                onChange={(event) => setSettingsValues((current) => ({ ...current, status: event.target.value as 'active' | 'paused' }))}
              >
                <MenuItem value="active">启用</MenuItem>
                <MenuItem value="paused">暂停</MenuItem>
              </TextField>
              <MuiBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, gap: 1.5 }}>
                <TextField
                  select
                  size="small"
                  label="调度方式"
                  value={settingsScheduleType}
                  onChange={(event) => setSettingsValues((current) => ({ ...current, schedule_type: event.target.value as ExternalSourceScheduleType }))}
                >
                  <MenuItem value="interval">固定间隔</MenuItem>
                  <MenuItem value="cron">Cron</MenuItem>
                  <MenuItem value="manual">仅手动</MenuItem>
                </TextField>
                {settingsScheduleType !== 'manual' && (
                  <TextField
                    size="small"
                    label={settingsScheduleType === 'cron' ? 'Cron 表达式' : '运行间隔'}
                    value={settingsScheduleExpression}
                    onChange={(event) => setSettingsValues((current) => ({ ...current, schedule_expression: event.target.value }))}
                    helperText={settingsScheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'}
                  />
                )}
                {settingsScheduleType === 'cron' && (
                  <TextField
                    size="small"
                    label="时区"
                    value={settingsScheduleTimezone}
                    onChange={(event) => setSettingsValues((current) => ({ ...current, schedule_timezone: event.target.value }))}
                    helperText="IANA 时区，例如 Asia/Shanghai"
                    sx={{ gridColumn: { sm: '2 / 3' } }}
                  />
                )}
              </MuiBox>
              <TextField
                fullWidth
                multiline
                rows={6}
                label="忽略规则"
                placeholder={'每行一条规则，例如：\n@eaDir/\n*.tmp\n!important.jpg'}
                value={settingsValues.ignore_rules ?? ''}
                onChange={(event) => setSettingsValues((current) => ({ ...current, ignore_rules: event.target.value }))}
              />

              {externalSourceConnectorProfile(setting.source.kind, setting.source.direction).credential === 'cookie' && (
                <>
                  <MuiDivider textAlign="left">一刻相册凭据</MuiDivider>
                  <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 0.5 }}>
                    <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {setting.credential?.configured ? 'Cookie 已配置' : 'Cookie 未配置'}
                    </MuiTypography>
                    <MuiTypography variant="body2">
                      出于安全原因，已保存的 Cookie 不会从服务器读取回浏览器。
                    </MuiTypography>
                  </XDriveStatusAlert>
                  <TextField
                    fullWidth
                    size="small"
                    type="password"
                    label="一刻相册 Cookie"
                    autoComplete="off"
                    value={settingsValues.cookie ?? ''}
                    placeholder={setting.credential?.configured ? externalSourceSavedCredentialMask : '粘贴一刻相册 Cookie'}
                    helperText={setting.credential?.configured
                      ? '当前已保存的 Cookie 以遮罩显示；点击输入框即可替换。不修改直接保存会保留原值。'
                      : '当前未配置 Cookie，请粘贴新的 Cookie。'}
                    onFocus={() => {
                      if (isExternalSourceSavedCredentialMask(settingsValues.cookie)) {
                        setSettingsValues((current) => ({ ...current, cookie: '' }))
                      }
                    }}
                    onChange={(event) => {
                      setSettingsValues((current) => ({ ...current, cookie: event.target.value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                  <MuiBox>
                    <XDriveYikeCookieHelp variant="accordion" />
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
                  <MuiDivider textAlign="left">Synology DSM 凭据</MuiDivider>
                  <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 0.5 }}>
                    <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {setting.credential?.configured ? 'DSM 凭据已配置' : 'DSM 凭据未配置'}
                    </MuiTypography>
                    <MuiTypography variant="body2">
                      已保存的 DSM 地址、用户名和密码不会从服务器读取回浏览器；如需更新，请重新完整填写三项。
                    </MuiTypography>
                  </XDriveStatusAlert>
                  <TextField
                    fullWidth
                    size="small"
                    label="更新 DSM 地址"
                    placeholder="留空则保持当前配置不变"
                    autoComplete="off"
                    value={settingsValues.base_url ?? ''}
                    onChange={(event) => {
                      setSettingsValues((current) => ({ ...current, base_url: event.target.value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label="更新 DSM 用户名"
                    placeholder="留空则保持当前配置不变"
                    autoComplete="username"
                    value={settingsValues.username ?? ''}
                    onChange={(event) => {
                      setSettingsValues((current) => ({ ...current, username: event.target.value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    type="password"
                    label="更新 DSM 密码"
                    placeholder="留空则保持当前配置不变"
                    autoComplete="new-password"
                    value={settingsValues.password ?? ''}
                    onChange={(event) => {
                      setSettingsValues((current) => ({ ...current, password: event.target.value }))
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                  <FormControl fullWidth size="small" error={Boolean(settingsSpacesError)}>
                    <InputLabel id="settings-source-spaces-label">同步空间</InputLabel>
                    <MuiSelect<SynologyPhotoSpace[]>
                      labelId="settings-source-spaces-label"
                      multiple
                      value={settingsValues.spaces ?? []}
                      input={<OutlinedInput label="同步空间" />}
                      renderValue={(selected) => selected.map(photoSpaceLabel).join('、')}
                      onChange={(event: SelectChangeEvent<SynologyPhotoSpace[]>) => {
                        setSettingsValues((current) => ({ ...current, spaces: selectedPhotoSpaces(event.target.value) }))
                        if (settingsSpacesError) setSettingsSpacesError('')
                      }}
                    >
                      {synologyPhotoSpaceOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          <Checkbox checked={(settingsValues.spaces ?? []).includes(option.value)} />
                          <ListItemText primary={option.label} />
                        </MenuItem>
                      ))}
                    </MuiSelect>
                    <FormHelperText>{settingsSpacesError || '至少选择一个照片空间'}</FormHelperText>
                  </FormControl>
                  {!settingsConnectorConfig && (
                    <MuiTypography variant="caption" color="text.secondary">
                      正在读取当前空间配置；未配置时默认同步个人空间和共享空间。
                    </MuiTypography>
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

              <MuiBox sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <XDriveActionButton
                  intent="danger"
                  disabled={savingSettings || setting.latestRun?.status === 'running'}
                  onClick={() => setDeleteTarget(setting)}
                >
                  删除来源
                </XDriveActionButton>
                <MuiBox sx={{ display: 'flex', gap: 1 }}>
                  <XDriveActionButton
                    onClick={() => {
                      setClearCookieConfirmOpen(false)
                      setSetting(null)
                      setSettingsValues(emptySourceSettingsValues())
                      setSettingsNameError('')
                      setSettingsSpacesError('')
                    }}
                  >
                    取消
                  </XDriveActionButton>
                  <XDriveActionButton
                    intent="primary"
                    type="submit"
                    loading={savingSettings}
                    loadingLabel="正在保存…"
                  >
                    保存设置
                  </XDriveActionButton>
                </MuiBox>
              </MuiBox>
            </Stack>
          </MuiBox>
        )}
        </XDriveDialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => deletingSourceID === null && setDeleteTarget(null)} maxWidth="sm" fullWidth slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="删除外部来源？" onClose={() => setDeleteTarget(null)} closeDisabled={deletingSourceID !== null} />
        <XDriveDialogContent>
          <DialogContentText>
            删除“{deleteTarget?.source.name ?? ''}”只会移除同步配置、运行记录、来源映射和已保存凭据。
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
            删除来源
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
            清除后，该 Pull 来源会自动暂停，无法继续扫描或同步，直到重新配置有效凭据。
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

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={3500}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setFeedback('')
        }}
      >
        <div>
          {feedback ? <XDriveStatusAlert tone="good">{feedback}</XDriveStatusAlert> : null}
        </div>
      </Snackbar>

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
