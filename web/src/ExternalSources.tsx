import { useCallback, useEffect, useState } from 'react'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Badge, Button, Card, Descriptions, Divider, Empty, Form, Input, Select, Space, Spin, Tooltip, Typography, message } from 'antd'
import type { BadgeProps } from 'antd'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert as MuiAlert,
  Box as MuiBox,
  Button as MuiButton,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography as MuiTypography,
} from '@mui/material'
import type { XDriveApi } from './api'
import SynologyDsmGuideDialog from './SynologyDsmGuideDialog'
import {
  externalSourceCardView,
  externalSourceConnectorProfile,
  externalSourceCredentialTestErrorLabel,
  externalSourceCredentialTestSuccessLabel,
  externalSourceDefaults,
  externalSourceDetailView,
  externalSourceRunDetailView,
  externalSourceTriggerActionLabel,
  formatExternalSourceTime,
  formatSize,
  yikeConnectorNotice,
  yikeCookieHelp,
  yikeManagedTargetLabel,
} from '../../ui/shared/src'
import type {
  ExternalSource,
  ExternalSourceCredentialTestResult,
  ExternalSourceItem,
  ExternalSourceRow,
  ExternalSourceRun,
  ExternalSourceRunFailure,
  ExternalSourceScheduleType,
  ExternalSourceStateTone,
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
}
const SOURCE_HISTORY_PAGE_SIZE = 20
const SOURCE_RUN_FAILURE_PAGE_SIZE = 20

type SourceRunFailurePage = {
  items: ExternalSourceRunFailure[]
  page: number
  hasNext: boolean
  loading: boolean
  loaded: boolean
}

type CreateSourceValues = {
  kind: SupportedExternalSourceKind
  name: string
  run_mode: 'scan' | 'sync'
  schedule_type: ExternalSourceScheduleType
  schedule_expression: string
  schedule_timezone: string
  ignore_rules?: string
  cookie?: string
}

type SourceErrorDialogState = {
  title: string
  message: string
  detail?: string
}

function sourceActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  const value = String(error ?? '').trim()
  return value && value !== '[object Object]' ? value : fallback
}



function YikeCookieHelpGuide() {
  return (
    <Accordion disableGutters elevation={0} sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
      <AccordionSummary>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
          <MuiTypography variant="body2" sx={{ fontWeight: 600 }}>{yikeCookieHelp.title}</MuiTypography>
          <MuiTypography variant="caption" color="text.secondary">点击展开</MuiTypography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <MuiTypography variant="body2">{yikeCookieHelp.summary}</MuiTypography>
        <ol style={{ margin: '10px 0', paddingLeft: 24 }}>
          {yikeCookieHelp.steps.map((step) => (
            <li key={step}><MuiTypography variant="body2">{step}</MuiTypography></li>
          ))}
        </ol>
        <MuiAlert severity="warning">{yikeCookieHelp.security}</MuiAlert>
      </AccordionDetails>
    </Accordion>
  )
}

function sourceBadgeStatus(tone: ExternalSourceStateTone): BadgeProps['status'] {
  if (tone === 'good') return 'success'
  if (tone === 'warning') return 'warning'
  if (tone === 'bad') return 'error'
  if (tone === 'busy') return 'processing'
  return 'default'
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
  const [createForm] = Form.useForm<CreateSourceValues>()
  const createScheduleType = Form.useWatch('schedule_type', createForm) ?? 'interval'
  const createScheduleExpression = Form.useWatch('schedule_expression', createForm) ?? '6h'
  const createScheduleTimezone = Form.useWatch('schedule_timezone', createForm) ?? 'UTC'
  const createKind = Form.useWatch('kind', createForm)

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
    if (!open || !rows.some((row) => row.latestRun?.status === 'running' || row.source.run_requested_at)) return
    const timer = window.setInterval(() => {
      void load(true)
    }, 1500)
    return () => window.clearInterval(timer)
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
    if (
      !open || !selected || historyPage !== 1 ||
      (selected.latestRun?.status !== 'running' && !selected.source.run_requested_at)
    ) return
    const timer = window.setInterval(() => {
      void loadRunHistory(selected.source.id, 1, true)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [open, selected, historyPage, loadRunHistory])

  const openSynologyGuide = (source: ExternalSource) => {
    setGuideSource(source)
    void api.me()
      .then((me) => setGuideUsername(me.username))
      .catch(() => setGuideUsername(undefined))
  }

  const openCreate = () => {
    const defaults = externalSourceDefaults('synology_photos')
    createForm.setFieldsValue({
      kind: defaults.kind,
      name: defaults.name,
      run_mode: 'scan',
      schedule_type: defaults.scheduleType,
      schedule_expression: defaults.scheduleExpression,
      schedule_timezone: defaults.scheduleTimezone,
      ignore_rules: defaults.ignoreRules,
      cookie: '',
    })
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
    setCreateOpen(true)
  }

  const changeCreateKind = (kind: CreateSourceValues['kind']) => {
    const defaults = externalSourceDefaults(kind)
    createForm.setFieldsValue({
      name: defaults.name,
      schedule_type: defaults.scheduleType,
      schedule_expression: defaults.scheduleExpression,
      schedule_timezone: defaults.scheduleTimezone,
      ignore_rules: defaults.ignoreRules,
      cookie: '',
    })
    setCreateCredentialTest(null)
    setCreateCredentialTestError('')
  }

  const testCreateCookie = async () => {
    const cookie = String(createForm.getFieldValue('cookie') ?? '').trim()
    if (!cookie) {
      setCreateCredentialTest(null)
      setCreateCredentialTestError('请先填写一刻相册 Cookie')
      return null
    }
    setTestingCreateCredential(true)
    setCreateCredentialTestError('')
    try {
      const result = await api.testSourceCredential('yike_photos', { cookie })
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
    if (values.kind !== 'yike_photos' && !defaultTargetNodeID) {
      setErrorDialog({ title: '无法添加来源', message: '当前目标文件夹尚未加载，请稍后重试。' })
      return
    }
    const cookie = values.cookie?.trim() ?? ''
    if (values.kind === 'yike_photos' && !cookie) {
      setErrorDialog({ title: '无法添加来源', message: '请先填写一刻相册 Cookie。' })
      return
    }

    setCreating(true)
    if (values.kind === 'yike_photos') {
      const tested = await testCreateCookie()
      if (!tested) {
        setCreating(false)
        return
      }
    }
    let created: ExternalSource
    try {
      created = await api.createSource({
        name: values.name.trim(),
        kind: values.kind,
        direction: externalSourceDefaults(values.kind).direction,
        sync_mode: 'backup',
        run_mode: values.run_mode,
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
        target_node_id: values.kind === 'yike_photos' ? 0 : (defaultTargetNodeID ?? 0),
        ignore_rules: values.ignore_rules ?? '',
      })
    } catch (error) {
      showActionError('添加来源失败', error, '创建外部来源失败，请稍后重试。')
      setCreating(false)
      return
    }

    let credentialSaved = true
    if (values.kind === 'yike_photos') {
      try {
        await api.setSourceCredential(created.id, { cookie })
      } catch (error) {
        credentialSaved = false
        try {
          await api.deleteSource(created.id, created.revision)
          setErrorDialog({
            title: 'Cookie 保存失败',
            message: '刚创建的一刻相册来源已自动撤销，请检查 Cookie 后重试。',
            detail: sourceActionErrorMessage(error, '保存 Cookie 失败'),
          })
          await load()
          setCreating(false)
          return
        } catch (rollbackError) {
          setErrorDialog({
            title: '来源创建未完成',
            message: '来源已创建，但 Cookie 保存失败且自动回滚也失败。请进入“设置”重新配置 Cookie，或删除该来源后重试。',
            detail: `Cookie：${sourceActionErrorMessage(error, '保存失败')}；回滚：${sourceActionErrorMessage(rollbackError, '回滚失败')}`,
          })
        }
      }
    }

    if (credentialSaved) message.success('外部来源已添加')
    setCreateOpen(false)
    createForm.resetFields()
    await load()
    setCreating(false)

    if (values.kind === 'synology_photos') {
      openSynologyGuide(created)
    }
  }


  const triggerNow = async (row: ExternalSourceRow) => {
    setTriggeringSourceID(row.source.id)
    try {
      await api.triggerSource(row.source.id)
      message.success(row.source.kind === 'synology_photos'
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
    setSetting(row)
    settingsForm.setFieldsValue({
      name: row.source.name,
      run_mode: row.source.run_mode,
      status: row.source.status,
      schedule_type: row.source.schedule_type ?? 'interval',
      schedule_expression: row.source.schedule_expression || '6h',
      schedule_timezone: row.source.schedule_timezone || externalSourceDefaults(row.source.kind as SupportedExternalSourceKind).scheduleTimezone,
      ignore_rules: row.source.ignore_rules ?? '',
      cookie: '',
    })
    setSettingsCredentialTest(null)
    setSettingsCredentialTestError('')
  }

  const testSettingsCookie = async () => {
    if (!setting) return null
    const cookie = String(settingsForm.getFieldValue('cookie') ?? '').trim()
    setTestingSettingsCredential(true)
    setSettingsCredentialTestError('')
    try {
      const result = cookie
        ? await api.testSourceCredential('yike_photos', { cookie })
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
    setSavingSettings(true)
    const pendingCookie = values.cookie?.trim() ?? ''
    if (externalSourceConnectorProfile(setting.source.kind).credential === 'cookie' && pendingCookie) {
      const tested = await testSettingsCookie()
      if (!tested) {
        setSavingSettings(false)
        return
      }
    }
    try {
      await api.updateSource(setting.source.id, setting.source.revision, {
        name: values.name.trim(),
        run_mode: values.run_mode,
        status: values.status,
        schedule_type: values.schedule_type,
        schedule_expression: values.schedule_type === 'manual' ? '' : values.schedule_expression.trim(),
        schedule_timezone: values.schedule_type === 'cron' ? values.schedule_timezone.trim() : '',
        ignore_rules: values.ignore_rules ?? '',
      })
      if (externalSourceConnectorProfile(setting.source.kind).credential === 'cookie' && pendingCookie) {
        await api.setSourceCredential(setting.source.id, { cookie: pendingCookie })
      }
      message.success('来源设置已保存')
      setSetting(null)
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
    setClearingCookie(true)
    try {
      await api.deleteSourceCredential(setting.source.id)
      message.success('Cookie 已清除，来源已自动暂停')
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
      showActionError('清除 Cookie 失败', error, '已保存的 Cookie 未能清除，请稍后重试。')
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
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>外部来源</DialogTitle>
        <DialogContent dividers>
      <div className="external-sources-toolbar">
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加来源</Button>
        </Space>
      </div>
      <Spin spinning={loading && rows.length === 0}>
        {rows.length === 0 && !loading ? (
          <Empty className="external-source-empty" description="尚未添加外部来源" />
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
                    <Badge status={sourceBadgeStatus(card.state.tone)} text={card.state.label} />
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
                      {row.source.kind === 'synology_photos' && (
                        <MuiButton
                          size="small"
                          variant="outlined"
                          onClick={() => openSynologyGuide(row.source)}
                          sx={{ minWidth: 'auto', px: 1.25, py: 0.25, fontSize: 12 }}
                        >
                          DSM 配置
                        </MuiButton>
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
                        <MuiButton
                          size="small"
                          color="warning"
                          variant="outlined"
                          disabled={Boolean(row.latestRun.cancel_requested_at) || cancellingRunID === row.latestRun.id}
                          onClick={() => void cancelRun(row)}
                          sx={{ minWidth: 'auto', px: 1.25, py: 0.25, fontSize: 12 }}
                        >
                          {row.latestRun.cancel_requested_at || cancellingRunID === row.latestRun.id ? '正在取消…' : '停止'}
                        </MuiButton>
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
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={onClose}>关闭</MuiButton>
        </DialogActions>
      </Dialog>

      <Dialog open={!!selected} onClose={closeDetails} maxWidth="md" fullWidth>
        <DialogTitle>{selected ? `${selected.source.name} · 来源详情` : '来源详情'}</DialogTitle>
        <DialogContent dividers>
        {selected && selectedDetail && (
          <>
            {selectedDetail.error && (
              <MuiAlert severity="error" sx={{ mb: 2 }}>
                <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>最近一次运行异常</MuiTypography>
                <MuiTypography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedDetail.error}</MuiTypography>
              </MuiAlert>
            )}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="来源类型">{selectedDetail.kindLabel}</Descriptions.Item>
              <Descriptions.Item label="工作方式">{selectedDetail.modeLabel}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge status={sourceBadgeStatus(selectedDetail.state.tone)} text={selectedDetail.state.label} />
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
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
                            <MuiBox>
                              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                                <MuiTypography variant="body2" sx={{ fontWeight: 700 }}>
                                  #{run.run_number > 0 ? run.run_number : '—'} · {runDetail.statusLabel}
                                </MuiTypography>
                                <Chip size="small" label={runDetail.modeLabel} />
                                <Chip size="small" label={runDetail.triggerLabel} />
                              </Stack>
                              <MuiTypography variant="caption" color="text.secondary">
                                {formatExternalSourceTime(runDetail.startedAt)}
                                {runDetail.finishedAt ? ' → ' + formatExternalSourceTime(runDetail.finishedAt) : ' → 进行中'}
                                {' · ' + runDetail.durationLabel}
                              </MuiTypography>
                            </MuiBox>
                            <Stack direction="row" spacing={1}>
                              <MuiTypography variant="caption">成功 {runDetail.successItems.toLocaleString('zh-CN')}</MuiTypography>
                              <MuiTypography variant="caption" color={runDetail.failedItems > 0 ? 'error' : 'text.secondary'}>
                                失败 {runDetail.failedItems.toLocaleString('zh-CN')}
                              </MuiTypography>
                            </Stack>
                          </Stack>
                        </AccordionSummary>
                        <AccordionDetails>
                          {runDetail.progress && (
                            <MuiBox sx={{ mb: 1.5 }}>
                              <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                                <MuiTypography variant="body2">{runDetail.progress.label}</MuiTypography>
                                {canCancel && (
                                  <MuiButton
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                    disabled={runDetail.progress.cancelling || cancellingRunID === run.id}
                                    onClick={() => void cancelRun(selected)}
                                  >
                                    {runDetail.progress.cancelling || cancellingRunID === run.id ? '正在取消…' : '停止'}
                                  </MuiButton>
                                )}
                              </Stack>
                              <LinearProgress
                                variant={runDetail.progress.percent === undefined ? 'indeterminate' : 'determinate'}
                                value={runDetail.progress.percent ?? 0}
                              />
                              {runDetail.progress.activePath && (
                                <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                                  当前文件：{runDetail.progress.activePath}
                                </MuiTypography>
                              )}
                            </MuiBox>
                          )}
                          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                            <Descriptions.Item label="运行编号">#{run.run_number > 0 ? run.run_number : '—'}</Descriptions.Item>
                            <Descriptions.Item label="内部运行 ID"><Typography.Text copyable>{run.id}</Typography.Text></Descriptions.Item>
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
                          <MuiAlert severity={runDetail.error ? 'error' : 'success'} sx={{ mt: 1.5 }}>
                            运行日志：{runDetail.error || '无错误日志'}
                          </MuiAlert>
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
                                    <MuiBox key={failure.id} sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                                        <MuiTypography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                                          {failure.path || failure.external_id}
                                        </MuiTypography>
                                        <Chip size="small" label={formatSize(failure.size)} />
                                      </Stack>
                                      <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                                        {failure.external_id} · {formatExternalSourceTime(failure.failed_at)}
                                      </MuiTypography>
                                      <MuiAlert severity="error" sx={{ mt: 0.75 }}>{failure.error}</MuiAlert>
                                    </MuiBox>
                                  ))}
                                  <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
                                    <Button
                                      size="small"
                                      disabled={failurePage.loading || failurePage.page <= 1}
                                      onClick={() => void loadRunFailures(selected.source.id, run.id, failurePage.page - 1)}
                                    >
                                      上一页
                                    </Button>
                                    <Typography.Text type="secondary">
                                      失败项第 {failurePage.page} 页 · 每页 {SOURCE_RUN_FAILURE_PAGE_SIZE} 条
                                    </Typography.Text>
                                    <Button
                                      size="small"
                                      disabled={failurePage.loading || !failurePage.hasNext}
                                      onClick={() => void loadRunFailures(selected.source.id, run.id, failurePage.page + 1)}
                                    >
                                      下一页
                                    </Button>
                                  </Stack>
                                </Stack>
                              ) : failurePage?.loaded ? (
                                <MuiAlert severity="warning">
                                  该历史 Run 记录了 {runDetail.failedItems.toLocaleString('zh-CN')} 个失败项，但没有可恢复的逐文件失败快照。
                                </MuiAlert>
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
                  <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" sx={{ pt: 0.5 }}>
                    <Button
                      size="small"
                      disabled={historyLoading || historyPage <= 1}
                      onClick={() => void loadRunHistory(selected.source.id, historyPage - 1)}
                    >
                      上一页
                    </Button>
                    <Typography.Text type="secondary">第 {historyPage} 页 · 每页 {SOURCE_HISTORY_PAGE_SIZE} 条</Typography.Text>
                    <Button
                      size="small"
                      disabled={historyLoading || !historyHasNext}
                      onClick={() => void loadRunHistory(selected.source.id, historyPage + 1)}
                    >
                      下一页
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={historyLoading ? '正在加载运行历史' : '尚无运行记录'} />
              )}
            </Spin>

            {failedItemsLoading && (
              <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                正在检查逐文件失败记录…
              </MuiTypography>
            )}
            {!failedItemsLoading && failedItems.length > 0 && (
              <MuiAlert
                severity="error"
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
              </MuiAlert>
            )}
          </>
        )}
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={closeDetails}>关闭</MuiButton>
        </DialogActions>
      </Dialog>

      <Dialog open={failedItemsOpen && failedItems.length > 0} onClose={() => setFailedItemsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>失败文件</DialogTitle>
        <DialogContent dividers>
          {failedItemsLimitReached && (
            <MuiAlert severity="info" sx={{ mb: 2 }}>
              当前最多显示前 1000 个失败项。
            </MuiAlert>
          )}
          <Stack spacing={1.5}>
            {failedItems.map((item) => (
              <MuiBox key={item.source_item_id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <MuiTypography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    {item.path || item.external_id}
                  </MuiTypography>
                  <Chip size="small" label={formatSize(item.size)} />
                </Stack>
                <MuiTypography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
                  外部 ID：{item.external_id}
                </MuiTypography>
                <MuiAlert severity="error" sx={{ mt: 1 }}>
                  {item.last_error || '未提供具体错误原因'}
                </MuiAlert>
              </MuiBox>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setFailedItemsOpen(false)}>关闭</MuiButton>
        </DialogActions>
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
      >
        <DialogTitle>添加外部来源</DialogTitle>
        <DialogContent dividers>
        {createKind === 'yike_photos' ? (
          <MuiAlert severity="info" sx={{ mb: 2 }}>
            固定逻辑目录：{yikeManagedTargetLabel}。连接成功后由服务器按百度 UID 和账号名称自动创建；底层文件仍使用 xDrive CAS 存储。
          </MuiAlert>
        ) : (
          <MuiAlert severity="info" sx={{ mb: 2 }}>
            <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>目标目录使用当前文件夹</MuiTypography>
            <MuiTypography variant="body2">
              当前目标：{defaultTargetLabel}{defaultTargetPath ? `（${defaultTargetPath}）` : '（我的文件根目录）'}
            </MuiTypography>
          </MuiAlert>
        )}
        <Form form={createForm} layout="vertical" onFinish={createSource} requiredMark={false}>
          <Form.Item name="kind" label="来源类型" rules={[{ required: true }]}>
            <Select
              onChange={changeCreateKind}
              options={[
                { value: 'synology_photos', label: '群晖 Photos' },
                { value: 'yike_photos', label: '一刻相册' },
              ]}
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
          {createKind === 'yike_photos' && (
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
          )}
          {createKind === 'yike_photos' && (
            <div style={{ marginTop: -12, marginBottom: 16 }}>
              <MuiAlert severity="warning" sx={{ mb: 1 }}>{yikeConnectorNotice}</MuiAlert>
              <YikeCookieHelpGuide />
              <MuiButton size="small" variant="outlined" disabled={testingCreateCredential} onClick={() => void testCreateCookie()} sx={{ mt: 1 }}>
                {testingCreateCredential ? '正在测试…' : '测试连接'}
              </MuiButton>
              {createCredentialTest && (
                <MuiAlert severity="success" sx={{ mt: 1 }}>
                  {externalSourceCredentialTestSuccessLabel(createCredentialTest)}
                </MuiAlert>
              )}
              {createCredentialTestError && <MuiAlert severity="error" sx={{ mt: 1 }}>{createCredentialTestError}</MuiAlert>}
            </div>
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
        </DialogContent>
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
      >
        <DialogTitle>{setting ? `${setting.source.name} · 设置` : '来源设置'}</DialogTitle>
        <DialogContent dividers>
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

            {externalSourceConnectorProfile(setting.source.kind).credential === 'cookie' && (
              <>
                <Divider orientation="left">一刻相册凭据</Divider>
                <MuiAlert severity={setting.credential?.configured ? 'success' : 'warning'} sx={{ mb: 2 }}>
                  <MuiTypography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {setting.credential?.configured ? 'Cookie 已配置' : 'Cookie 未配置'}
                  </MuiTypography>
                  <MuiTypography variant="body2">
                    出于安全原因，已保存的 Cookie 不会从服务器读取回浏览器。
                  </MuiTypography>
                </MuiAlert>
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
                  <YikeCookieHelpGuide />
                  <MuiButton
                    size="small"
                    sx={{ mt: 1 }}
                    variant="outlined"
                    disabled={testingSettingsCredential}
                    onClick={() => void testSettingsCookie()}
                  >
                    {testingSettingsCredential ? '正在测试…' : '测试连接'}
                  </MuiButton>
                  {settingsCredentialTest && (
                    <MuiAlert severity="success" sx={{ mt: 1 }}>
                      {externalSourceCredentialTestSuccessLabel(settingsCredentialTest)}
                    </MuiAlert>
                  )}
                  {settingsCredentialTestError && <MuiAlert severity="error" sx={{ mt: 1 }}>{settingsCredentialTestError}</MuiAlert>}
                </div>
                {setting.credential?.configured && (
                  <MuiButton
                    color="error"
                    variant="outlined"
                    disabled={clearingCookie}
                    onClick={() => setClearCookieConfirmOpen(true)}
                    sx={{ mb: 2 }}
                  >
                    清除 Cookie
                  </MuiButton>
                )}
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <MuiButton
                type="button"
                color="error"
                variant="outlined"
                disabled={savingSettings || setting.latestRun?.status === 'running'}
                onClick={() => setDeleteTarget(setting)}
              >
                删除来源
              </MuiButton>
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
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => deletingSourceID === null && setDeleteTarget(null)}>
        <DialogTitle>删除外部来源？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            删除“{deleteTarget?.source.name ?? ''}”只会移除同步配置、运行记录、来源映射和已保存凭据。
            已经同步到 xDrive 的文件会保留，不会删除。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton disabled={deletingSourceID !== null} onClick={() => setDeleteTarget(null)}>取消</MuiButton>
          <MuiButton color="error" variant="contained" disabled={deletingSourceID !== null} onClick={() => void deleteSource()}>
            {deletingSourceID === null ? '删除来源' : '正在删除…'}
          </MuiButton>
        </DialogActions>
      </Dialog>

      <Dialog
        open={clearCookieConfirmOpen}
        onClose={() => !clearingCookie && setClearCookieConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>清除已保存的 Cookie？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            清除后，一刻相册来源会自动暂停，无法继续扫描或同步，直到重新配置有效 Cookie。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <MuiButton disabled={clearingCookie} onClick={() => setClearCookieConfirmOpen(false)}>取消</MuiButton>
          <MuiButton color="error" variant="contained" disabled={clearingCookie} onClick={() => void clearCookie()}>
            {clearingCookie ? '正在清除…' : '清除 Cookie'}
          </MuiButton>
        </DialogActions>
      </Dialog>

      <Dialog open={!!errorDialog} onClose={() => setErrorDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{errorDialog?.title ?? '操作失败'}</DialogTitle>
        <DialogContent dividers>
          {errorDialog && (
            <Stack spacing={1.5}>
              <MuiAlert severity="error">{errorDialog.message}</MuiAlert>
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
        </DialogContent>
        <DialogActions>
          <MuiButton variant="contained" onClick={() => setErrorDialog(null)}>知道了</MuiButton>
        </DialogActions>
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
