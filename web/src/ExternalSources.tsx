import { useCallback, useEffect, useState } from 'react'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Divider, Form, Input, Select, Space, Spin, Tooltip, Typography, message } from 'antd'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box as MuiBox,
  Button as MuiButton,
  Dialog,
  DialogContentText,
  MenuItem,
  Stack,
  TextField,
  Typography as MuiTypography,
} from '@mui/material'
import type { XDriveApi } from './api'
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
  XDriveSourceFailureItem,
  XDriveSourceRunSummary,
  XDriveSynologyDsmGuideDialog as SynologyDsmGuideDialog,
  XDriveYikeCookieHelp,
  xDriveDialogPaperProps,
} from '@xdrive/ui/mui'
import {
  externalSourceCardView,
  externalSourceConnectorProfile,
  externalSourceCreateOption,
  externalSourceCreateOptions,
  externalSourceCredentialLabel,
  externalSourceCredentialTestErrorLabel,
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



export default function ExternalSourcesPanel({
  open,
  api,
  defaultTargetNodeID,
  defaultTargetLabel,
  defaultTargetPath,
  onClose,
  onError,
}: {
  open: boolean
  api: XDriveApi
  defaultTargetNodeID?: number
  defaultTargetLabel: string
  defaultTargetPath: string
  onClose: () => void
  onError: (error: unknown) => void
}) {
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
  const [setting, setSetting] = useState<ExternalSourceRow | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm] = Form.useForm<SourceSettingsValues>()
  const settingsScheduleType = Form.useWatch('schedule_type', settingsForm) ?? 'interval'
  const settingsScheduleExpression = Form.useWatch('schedule_expression', settingsForm) ?? '6h'
  const settingsScheduleTimezone = Form.useWatch('schedule_timezone', settingsForm) ?? 'UTC'
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
  const [clearCookieConfirmOpen, setClearCookieConfirmOpen] = useState(false)
  const [clearingCookie, setClearingCookie] = useState(false)
  const [settingsConnectorConfig, setSettingsConnectorConfig] = useState<ExternalSourceConnectorConfig | null>(null)
  const [createForm] = Form.useForm<CreateSourceValues>()
  const createScheduleType = Form.useWatch('schedule_type', createForm) ?? 'interval'
  const createScheduleExpression = Form.useWatch('schedule_expression', createForm) ?? '6h'
  const createScheduleTimezone = Form.useWatch('schedule_timezone', createForm) ?? 'UTC'
  const createPreset = (Form.useWatch('preset', createForm) ?? 'synology_push') as ExternalSourceCreatePreset
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
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    const delay = sourceActivityPollDelay(rows)
    if (!open || delay === null) return

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
  }, [open, rows, load])
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
    if (!open || !selected || historyPage !== 1 || delay === null) return

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
  }, [open, selected, historyPage, loadRunHistory])

  const openSynologyGuide = (source: ExternalSource) => {
    setGuideSource(source)
    void api.me()
      .then((me) => setGuideUsername(me.username))
      .catch(() => setGuideUsername(undefined))
  }

  const openCreate = () => {
    const option = externalSourceCreateOption('synology_push')
    const defaults = externalSourceDefaults(option.kind, option.direction)
    createForm.setFieldsValue({
      preset: option.value,
      name: defaults.name,
      run_mode: 'scan',
      schedule_type: defaults.scheduleType,
      schedule_expression: defaults.scheduleExpression,
      schedule_timezone: defaults.scheduleTimezone,
      ignore_rules: defaults.ignoreRules,
      cookie: '',
      base_url: '',
      username: '',
      password: '',
      spaces: ['personal', 'shared'],
    })
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    setCreateOpen(true)
  }

  const changeCreatePreset = (preset: ExternalSourceCreatePreset) => {
    const option = externalSourceCreateOption(preset)
    const defaults = externalSourceDefaults(option.kind, option.direction)
    createForm.setFieldsValue({
      name: defaults.name,
      schedule_type: defaults.scheduleType,
      schedule_expression: defaults.scheduleExpression,
      schedule_timezone: defaults.scheduleTimezone,
      ignore_rules: defaults.ignoreRules,
      cookie: '',
      base_url: '',
      username: '',
      password: '',
      spaces: ['personal', 'shared'],
    })
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
  }

  const createCredentialPayload = () => {
    if (createProfile.credential === 'cookie') {
      const cookie = String(createForm.getFieldValue('cookie') ?? '').trim()
      return cookie ? { cookie } : null
    }
    if (createProfile.credential === 'synology_dsm') {
      const baseURL = String(createForm.getFieldValue('base_url') ?? '').trim()
      const username = String(createForm.getFieldValue('username') ?? '').trim()
      const password = String(createForm.getFieldValue('password') ?? '')
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

  const createSource = async (values: CreateSourceValues) => {
    const option = externalSourceCreateOption(values.preset)
    const profile = externalSourceConnectorProfile(option.kind, option.direction)
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
        name: values.name.trim(),
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

    message.success('外部来源已添加')
    setCreateOpen(false)
    createForm.resetFields()
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
      message.success(profile.manualTriggerExecutor === 'source_agent'
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
      message.success('已请求停止当前运行')
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
    settingsForm.setFieldsValue({
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
    })
    setSettingsCredentialTest(null)
    setSettingsCredentialTestError('')
    if (profile.credential === 'synology_dsm') {
      void api.sourceConnectorConfig(row.source.id)
        .then((config) => {
          setSettingsConnectorConfig(config)
          const spaces = Array.isArray(config.payload.spaces)
            ? config.payload.spaces.filter((space): space is SynologyPhotoSpace => space === 'personal' || space === 'shared')
            : []
          settingsForm.setFieldValue('spaces', spaces.length ? spaces : ['personal', 'shared'])
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
      const cookie = String(settingsForm.getFieldValue('cookie') ?? '').trim()
      return cookie ? { cookie } : null
    }
    if (profile.credential === 'synology_dsm') {
      const baseURL = String(settingsForm.getFieldValue('base_url') ?? '').trim()
      const username = String(settingsForm.getFieldValue('username') ?? '').trim()
      const password = String(settingsForm.getFieldValue('password') ?? '')
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

  const saveSettings = async (values: SourceSettingsValues) => {
    if (!setting) return
    const profile = externalSourceConnectorProfile(setting.source.kind, setting.source.direction)
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
        name: values.name.trim(),
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

      message.success('来源设置已保存')
      setSetting(null)
      setSettingsConnectorConfig(null)
      settingsForm.resetFields()
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
      message.success(`${label}已清除，来源已自动暂停`)
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
      settingsForm.setFieldValue('status', 'paused')
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
      message.success('来源已删除；已同步到 xDrive 的文件已保留')
      if (selected?.source.id === row.source.id) setSelected(null)
      if (setting?.source.id === row.source.id) {
        setSetting(null)
        settingsForm.resetFields()
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

  const openDetails = async (row: ExternalSourceRow) => {
    setSelected(row)
    setFailedItems([])
    setFailedItemsOpen(false)
    setFailedItemsLimitReached(false)
    setHistoryRuns([])
    setHistoryPage(1)
    setHistoryHasNext(false)
    setRunFailurePages({})
    setFailedItemsLoading(true)
    void loadRunHistory(row.source.id, 1)
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
  }

  const selectedDetail = selected ? externalSourceDetailView(selected) : null
  const selectedCard = selected ? externalSourceCardView(selected) : null

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper" slotProps={{ paper: xDriveDialogPaperProps }}>
        <XDriveDialogTitle title="外部来源" onClose={onClose} />
        <XDriveDialogContent dividers>
      <div className="external-sources-toolbar">
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加来源</Button>
        </Space>
      </div>
      <Spin spinning={loading && rows.length === 0}>
        {rows.length === 0 && !loading ? (
          <XDriveStatePanel variant="plain" message="尚未添加外部来源" />
        ) : (
          <div className="external-source-list">
            {rows.map((row) => {
              const card = externalSourceCardView(row)
              const stats = card.scannedItems === undefined || card.scannedBytes === undefined
                ? '尚无扫描统计'
                : `${card.scannedItems.toLocaleString('zh-CN')} 项 · ${formatSize(card.scannedBytes)}${card.failedItems ? ` · 失败 ${card.failedItems}` : ''}`

              return (
                <Card key={row.source.id} size="small" className="external-source-card">
                  <div className="external-source-card-header">
                    <div>
                      <Typography.Title level={4} style={{ margin: 0 }}>{row.source.name}</Typography.Title>
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
                    <Space size="small">
                      <Button size="small" disabled={failedItemsLoading} onClick={() => void openDetails(row)}>查看</Button>
                      {externalSourceConnectorProfile(row.source.kind, row.source.direction).manualTriggerExecutor === 'source_agent' && (
                        <XDriveActionButton compact onClick={() => openSynologyGuide(row.source)}>
                          DSM 配置
                        </XDriveActionButton>
                      )}
                      <Tooltip title={card.trigger.label}>
                        <Button
                          size="small"
                          disabled={!card.trigger.ready}
                          loading={triggeringSourceID === row.source.id}
                          onClick={() => void triggerNow(row)}
                        >
                          {externalSourceTriggerActionLabel(row)}
                        </Button>
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
                      <Button size="small" onClick={() => openSettings(row)}>设置</Button>
                    </Space>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Spin>
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton onClick={onClose}>关闭</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

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
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="来源类型">{selectedDetail.kindLabel}</Descriptions.Item>
              <Descriptions.Item label="工作方式">{selectedDetail.modeLabel}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <XDriveStatusBadge tone={selectedDetail.state.tone} label={selectedDetail.state.label} />
              </Descriptions.Item>
              <Descriptions.Item label="目标目录">
                {selected.source.kind === 'yike_photos'
                  ? yikeManagedTargetLabel
                  : selectedDetail.targetNodeID ? `节点 #${selectedDetail.targetNodeID}` : '未配置'}
              </Descriptions.Item>
              <Descriptions.Item label="调度">{selectedDetail.scheduleLabel}</Descriptions.Item>
              <Descriptions.Item label="上次运行">{formatExternalSourceTime(selectedDetail.lastRunAt)}</Descriptions.Item>
              <Descriptions.Item label="上次成功">{formatExternalSourceTime(selectedDetail.lastSuccessAt)}</Descriptions.Item>
              {selectedDetail.credential && (
                <Descriptions.Item label={selectedDetail.credential.label}>
                  {selectedDetail.credential.configured ? '已配置' : '未配置'}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider orientation="left">同步历史</Divider>
            <Spin spinning={historyLoading}>
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
                          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                            <Descriptions.Item label="运行编号">#{run.run_number > 0 ? run.run_number : '—'}</Descriptions.Item>
                            <Descriptions.Item label="内部运行 ID"><Typography.Text copyable>{run.id}</Typography.Text></Descriptions.Item>
                            <Descriptions.Item label="运行状态">
                              <XDriveStatusBadge tone={runDetail.statusTone} label={runDetail.statusLabel} />
                            </Descriptions.Item>
                            <Descriptions.Item label="耗时">{runDetail.durationLabel}</Descriptions.Item>
                            <Descriptions.Item label="开始时间">{formatExternalSourceTime(runDetail.startedAt)}</Descriptions.Item>
                            <Descriptions.Item label="结束时间">{runDetail.finishedAt ? formatExternalSourceTime(runDetail.finishedAt) : '进行中'}</Descriptions.Item>
                            <Descriptions.Item label="成功项">{runDetail.successItems.toLocaleString('zh-CN')} 项</Descriptions.Item>
                            <Descriptions.Item label="失败项">{runDetail.failedItems.toLocaleString('zh-CN')} 项</Descriptions.Item>
                            {runDetail.metrics.map((metric) => (
                              <Descriptions.Item key={metric.key} label={metric.label}>
                                {metric.items.toLocaleString('zh-CN')} 项
                                {metric.bytes === undefined ? '' : ' · ' + formatSize(metric.bytes)}
                              </Descriptions.Item>
                            ))}
                          </Descriptions>
                          <XDriveStatusAlert tone={runDetail.error ? 'bad' : 'good'} sx={{ mt: 1.5 }}>
                            运行日志：{runDetail.error || '无错误日志'}
                          </XDriveStatusAlert>
                          {runDetail.failedItems > 0 && (
                            <MuiBox sx={{ mt: 1.5 }}>
                              <MuiTypography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
                                本次失败文件
                              </MuiTypography>
                              {failurePage?.loading && !failurePage.loaded ? (
                                <Spin size="small" />
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
            </Spin>

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
          createForm.resetFields()
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
            createForm.resetFields()
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
        <Form form={createForm} layout="vertical" onFinish={createSource} requiredMark={false}>
          <Form.Item name="preset" label="来源类型" rules={[{ required: true }]} extra={createOption.description}>
            <Select
              onChange={(value) => changeCreatePreset(value as ExternalSourceCreatePreset)}
              options={externalSourceCreateOptions.map((item) => ({ value: item.value, label: item.label }))}
            />
          </Form.Item>
          <Form.Item name="name" label="来源名称" rules={[{ required: true, whitespace: true, max: 128 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="run_mode" label="初始运行模式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'scan', label: '仅扫描（推荐先使用）' },
                { value: 'sync', label: '同步' },
              ]}
            />
          </Form.Item>
          <Form.Item name="schedule_type" hidden><Input /></Form.Item>
          <Form.Item name="schedule_expression" hidden><Input /></Form.Item>
          <Form.Item name="schedule_timezone" hidden><Input /></Form.Item>
          <MuiBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, gap: 1.5, mb: 2 }}>
            <TextField
              select
              size="small"
              label="调度方式"
              value={createScheduleType}
              onChange={(event) => createForm.setFieldValue('schedule_type', event.target.value as ExternalSourceScheduleType)}
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
                onChange={(event) => createForm.setFieldValue('schedule_expression', event.target.value)}
                helperText={createScheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'}
              />
            )}
            {createScheduleType === 'cron' && (
              <TextField
                size="small"
                label="时区"
                value={createScheduleTimezone}
                onChange={(event) => createForm.setFieldValue('schedule_timezone', event.target.value)}
                helperText="IANA 时区，例如 Asia/Shanghai"
                sx={{ gridColumn: { sm: '2 / 3' } }}
              />
            )}
          </MuiBox>
          <Form.Item name="ignore_rules" label="忽略规则">
            <Input.TextArea rows={5} placeholder="每行一条 gitignore 风格规则" />
          </Form.Item>
          {createProfile.credential === 'cookie' && (
            <>
              <Form.Item
                name="cookie"
                label="一刻相册 Cookie"
                rules={[{ required: true, whitespace: true, message: '请填写一刻相册 Cookie' }]}
                extra="Cookie 只会加密保存到服务器，之后不会回传到浏览器。"
              >
                <Input.Password
                  autoComplete="off"
                  onChange={() => {
                    setCreateCredentialTest(null)
                    setCreateCredentialTestError('')
                  }}
                />
              </Form.Item>
              <div style={{ marginTop: -12, marginBottom: 16 }}>
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
              </div>
            </>
          )}
          {createProfile.credential === 'synology_dsm' && (
            <>
              <Divider orientation="left">Synology DSM 连接</Divider>
              <Form.Item
                name="base_url"
                label="DSM 地址"
                rules={[{ required: true, whitespace: true, message: '请填写 DSM 地址' }]}
                extra="填写 xDrive Server 实际能够访问的 DSM Origin，例如 https://nas.example.com:5001。"
              >
                <Input placeholder="https://nas.example.com:5001" autoComplete="off" onChange={() => {
                  setCreateCredentialTest(null)
                  setCreateCredentialTestError('')
                }} />
              </Form.Item>
              <Form.Item name="username" label="DSM 用户名" rules={[{ required: true, whitespace: true, message: '请填写 DSM 用户名' }]}>
                <Input autoComplete="username" onChange={() => {
                  setCreateCredentialTest(null)
                  setCreateCredentialTestError('')
                }} />
              </Form.Item>
              <Form.Item name="password" label="DSM 密码" rules={[{ required: true, message: '请填写 DSM 密码' }]}>
                <Input.Password autoComplete="new-password" onChange={() => {
                  setCreateCredentialTest(null)
                  setCreateCredentialTestError('')
                }} />
              </Form.Item>
              <Form.Item name="spaces" label="同步空间" rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个照片空间' }]}>
                <Select mode="multiple" options={synologyPhotoSpaceOptions} />
              </Form.Item>
              <XDriveStatusAlert tone="neutral" sx={{ mb: 1 }}>
                DSM 凭据只会在服务器端加密保存；Pull worker 使用 Synology Photos API 只读发现和下载媒体，不会删除 NAS 中的照片。
              </XDriveStatusAlert>
              <MuiBox sx={{ mb: 1 }}>
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
                <XDriveStatusAlert tone="good" sx={{ mb: 1 }}>
                  {externalSourceCredentialTestSuccessLabel(createCredentialTest)}
                </XDriveStatusAlert>
              )}
              {createCredentialTestError && <XDriveStatusAlert tone="bad" sx={{ mb: 1 }}>{createCredentialTestError}</XDriveStatusAlert>}
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setCreateOpen(false); createForm.resetFields() }}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={creating}
            >
              添加来源
            </Button>
          </div>
        </Form>
        </XDriveDialogContent>
      </Dialog>

      <Dialog
        open={!!setting}
        onClose={() => {
          if (savingSettings) return
          setClearCookieConfirmOpen(false)
          setSetting(null)
          settingsForm.resetFields()
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
            settingsForm.resetFields()
          }}
          closeDisabled={savingSettings}
        />
        <XDriveDialogContent dividers>
        {setting && (
          <Form form={settingsForm} layout="vertical" onFinish={saveSettings} requiredMark={false}>
            <Form.Item
              name="name"
              label="来源名称"
              rules={[{ required: true, whitespace: true, max: 128 }]}
            >
              <Input autoFocus />
            </Form.Item>
            <Form.Item name="run_mode" label="运行模式" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'sync', label: '同步' },
                  { value: 'scan', label: '仅扫描' },
                ]}
              />
            </Form.Item>
            <Form.Item name="status" label="来源状态" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'active', label: '启用' },
                  { value: 'paused', label: '暂停' },
                ]}
              />
            </Form.Item>
            <Form.Item name="schedule_type" hidden><Input /></Form.Item>
            <Form.Item name="schedule_expression" hidden><Input /></Form.Item>
            <Form.Item name="schedule_timezone" hidden><Input /></Form.Item>
            <MuiBox sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, gap: 1.5, mb: 2 }}>
              <TextField
                select
                size="small"
                label="调度方式"
                value={settingsScheduleType}
                onChange={(event) => settingsForm.setFieldValue('schedule_type', event.target.value as ExternalSourceScheduleType)}
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
                  onChange={(event) => settingsForm.setFieldValue('schedule_expression', event.target.value)}
                  helperText={settingsScheduleType === 'cron' ? '标准 5 段，例如：0 3 * * *' : '例如：30m、6h、24h'}
                />
              )}
              {settingsScheduleType === 'cron' && (
                <TextField
                  size="small"
                  label="时区"
                  value={settingsScheduleTimezone}
                  onChange={(event) => settingsForm.setFieldValue('schedule_timezone', event.target.value)}
                  helperText="IANA 时区，例如 Asia/Shanghai"
                  sx={{ gridColumn: { sm: '2 / 3' } }}
                />
              )}
            </MuiBox>
            <Form.Item name="ignore_rules" label="忽略规则">
              <Input.TextArea
                rows={6}
                placeholder={'每行一条规则，例如：\n@eaDir/\n*.tmp\n!important.jpg'}
              />
            </Form.Item>

            {externalSourceConnectorProfile(setting.source.kind, setting.source.direction).credential === 'cookie' && (
              <>
                <Divider orientation="left">一刻相册凭据</Divider>
                <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 2 }}>
                  <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {setting.credential?.configured ? 'Cookie 已配置' : 'Cookie 未配置'}
                  </MuiTypography>
                  <MuiTypography variant="body2">
                    出于安全原因，已保存的 Cookie 不会从服务器读取回浏览器。
                  </MuiTypography>
                </XDriveStatusAlert>
                <Form.Item name="cookie" label="更新 Cookie">
                  <Input.Password
                    autoComplete="off"
                    placeholder="留空则保持当前 Cookie 不变"
                    onChange={() => {
                      setSettingsCredentialTest(null)
                      setSettingsCredentialTestError('')
                    }}
                  />
                </Form.Item>
                <div style={{ marginTop: -12, marginBottom: 16 }}>
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
                </div>
                {setting.credential?.configured && (
                  <MuiBox sx={{ mb: 2 }}>
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
                <Divider orientation="left">Synology DSM 凭据</Divider>
                <XDriveStatusAlert tone={setting.credential?.configured ? 'good' : 'warning'} sx={{ mb: 2 }}>
                  <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {setting.credential?.configured ? 'DSM 凭据已配置' : 'DSM 凭据未配置'}
                  </MuiTypography>
                  <MuiTypography variant="body2">
                    已保存的 DSM 地址、用户名和密码不会从服务器读取回浏览器；如需更新，请重新完整填写三项。
                  </MuiTypography>
                </XDriveStatusAlert>
                <Form.Item name="base_url" label="更新 DSM 地址">
                  <Input placeholder="留空则保持当前配置不变" autoComplete="off" onChange={() => {
                    setSettingsCredentialTest(null)
                    setSettingsCredentialTestError('')
                  }} />
                </Form.Item>
                <Form.Item name="username" label="更新 DSM 用户名">
                  <Input placeholder="留空则保持当前配置不变" autoComplete="username" onChange={() => {
                    setSettingsCredentialTest(null)
                    setSettingsCredentialTestError('')
                  }} />
                </Form.Item>
                <Form.Item name="password" label="更新 DSM 密码">
                  <Input.Password placeholder="留空则保持当前配置不变" autoComplete="new-password" onChange={() => {
                    setSettingsCredentialTest(null)
                    setSettingsCredentialTestError('')
                  }} />
                </Form.Item>
                <Form.Item name="spaces" label="同步空间" rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个照片空间' }]}>
                  <Select mode="multiple" options={synologyPhotoSpaceOptions} />
                </Form.Item>
                {!settingsConnectorConfig && (
                  <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1, mb: 1 }}>
                    正在读取当前空间配置；未配置时默认同步个人空间和共享空间。
                  </MuiTypography>
                )}
                <MuiBox sx={{ mb: 1 }}>
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
                  <XDriveStatusAlert tone="good" sx={{ mb: 1 }}>
                    {externalSourceCredentialTestSuccessLabel(settingsCredentialTest)}
                  </XDriveStatusAlert>
                )}
                {settingsCredentialTestError && <XDriveStatusAlert tone="bad" sx={{ mb: 1 }}>{settingsCredentialTestError}</XDriveStatusAlert>}
                {setting.credential?.configured && (
                  <MuiBox sx={{ mb: 2 }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <XDriveActionButton
                intent="danger"
                disabled={savingSettings || setting.latestRun?.status === 'running'}
                onClick={() => setDeleteTarget(setting)}
              >
                删除来源
              </XDriveActionButton>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  onClick={() => {
                    setClearCookieConfirmOpen(false)
                    setSetting(null)
                    settingsForm.resetFields()
                  }}
                >
                  取消
                </Button>
                <Button type="primary" htmlType="submit" loading={savingSettings}>保存设置</Button>
              </div>
            </div>
          </Form>
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
