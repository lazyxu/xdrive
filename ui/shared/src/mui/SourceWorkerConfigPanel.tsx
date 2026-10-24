import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { xDriveCoreDependencyErrorMessage } from '../core-dependency-error'
import type {
  XDriveSourceWorkerConfig,
  XDriveSourceWorkerValues,
  XDriveSourceWorkerRevisionPage,
  XDriveSourceWorkerUpdate,
  XDriveSourceWorkerRollbackInput,
} from '../service-dependencies'

// Shared Web/Desktop administrator control. This does not edit user-level
// Sync Folders, restart containers, or pretend saving means runtime activation.
export type XDriveSourceWorkerPort = {
  loadSourceWorkerConfig?: () => Promise<XDriveSourceWorkerConfig>
  saveSourceWorkerConfig?: (input: XDriveSourceWorkerUpdate) => Promise<XDriveSourceWorkerConfig>
  loadSourceWorkerRevisions?: () => Promise<XDriveSourceWorkerRevisionPage>
  rollbackSourceWorker?: (input: XDriveSourceWorkerRollbackInput) => Promise<XDriveSourceWorkerConfig>
}

type Draft = { scan: string; poll: string; concurrency: string }

function valuesToDraft(v: XDriveSourceWorkerValues): Draft {
  return {
    scan: String(v.scan_interval_seconds),
    poll: String(v.poll_interval_seconds),
    concurrency: String(v.max_concurrency),
  }
}

function parseDraft(draft: Draft): XDriveSourceWorkerValues | null {
  const scan = Number(draft.scan)
  const poll = Number(draft.poll)
  const concurrency = Number(draft.concurrency)
  if (!draft.scan.trim() || !draft.poll.trim() || !draft.concurrency.trim() ||
    !Number.isSafeInteger(scan) || scan < 60 || scan > 604800 ||
    !Number.isSafeInteger(poll) || poll < 10 || poll > 3600 ||
    !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) return null
  return {
    scan_interval_seconds: scan,
    poll_interval_seconds: poll,
    max_concurrency: concurrency,
  }
}

function valuesSummary(v: XDriveSourceWorkerValues): string {
  return `扫描间隔 ${v.scan_interval_seconds} 秒 · 轮询间隔 ${v.poll_interval_seconds} 秒 · 最大并发 ${v.max_concurrency}`
}

const applyLabels: Record<XDriveSourceWorkerConfig['apply_state'], string> = {
  unmanaged: '尚未通过管理员保存；实际部署参数以 Worker 心跳为准',
  unavailable: '已保存期望配置，但没有在线 Pull Worker 可确认生效',
  pending: '有 Worker 尚未完成本次配置生效',
  applied: '全部已观察到的在线 Pull Worker 都确认了期望修订和参数',
}

export function XDriveSourceWorkerConfigPanel({
  source,
  refreshID, section = 'config', onDirtyChange, onBusyChange, singlePage = false,
}: {
  source: XDriveSourceWorkerPort
  refreshID: number
  section?: 'config' | 'history' | 'verify' | 'all'
  onDirtyChange?: (dirty: boolean) => void
  onBusyChange?: (busy: boolean) => void
  singlePage?: boolean
}) {
  const epochRef = useRef(0)
  const [config, setConfig] = useState<XDriveSourceWorkerConfig | null>(null)
  const [history, setHistory] = useState<XDriveSourceWorkerRevisionPage['items']>([])
  const [draft, setDraft] = useState<Draft>({ scan: '', poll: '', concurrency: '' })
  const [target, setTarget] = useState('')
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    let active = true
    const epoch = ++epochRef.current
    setConfig(null)
    setHistory([])
    setDraft({ scan: '', poll: '', concurrency: '' })
    setTarget('')
    setConfirmRollback(false)
    setError('')
    setNotice('')
    setHistoryError('')
    setHistoryLoading(section === 'history' || section === 'all')
    setLoading(true)
    setBusy(false)
    if (source.loadSourceWorkerConfig) {
      void source.loadSourceWorkerConfig().then((next) => {
        if (!active || epoch !== epochRef.current) return
        setConfig(next)
        setDraft(valuesToDraft(next.desired))
      }).catch(() => {
        if (active && epoch === epochRef.current) {
          setError('无法读取 Pull Worker 配置。请检查 Server 和 Desktop Agent 版本。')
        }
      }).finally(() => {
        if (active && epoch === epochRef.current) setLoading(false)
      })
    } else {
      setLoading(false)
    }
    if ((section === 'history' || section === 'all') && source.loadSourceWorkerRevisions) {
      void source.loadSourceWorkerRevisions().then((next) => {
        if (active && epoch === epochRef.current) setHistory(next.items)
      }).catch(() => {
        if (active && epoch === epochRef.current) setHistoryError('无法读取 Pull Worker 历史修订。')
      }).finally(() => {
        if (active && epoch === epochRef.current) setHistoryLoading(false)
      })
    } else {
      setHistoryLoading(false)
    }
    return () => { active = false; ++epochRef.current }
  }, [source, refreshID, section])

  const reload = async () => {
    if (!source.loadSourceWorkerConfig || busy || (singlePage && isDraftDirty)) return
    const epoch = ++epochRef.current
    setLoading(true)
    // The new read supersedes any older revision-history fetch.
    setHistoryLoading((section === 'history' || section === 'all') &&
      !!source.loadSourceWorkerRevisions)
    setError('')
    try {
      const next = await source.loadSourceWorkerConfig()
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(valuesToDraft(next.desired))
      if ((section === 'history' || section === 'all') && source.loadSourceWorkerRevisions) {
        try {
          const page = await source.loadSourceWorkerRevisions()
          if (epoch === epochRef.current) {
            setHistory(page.items)
            setHistoryError('')
          }
        } catch {
          if (epoch === epochRef.current) setHistoryError('历史修订刷新失败。')
        }
      }
    } catch (err) {
      if (epoch === epochRef.current) {
        setError(xDriveCoreDependencyErrorMessage(err, 'worker', 'refresh'))
      }
    } finally {
      if (epoch === epochRef.current) {
        setLoading(false)
        setHistoryLoading(false)
      }
    }
  }

  const save = async () => {
    if (!config?.editable || !source.saveSourceWorkerConfig || busy) return
    const desired = parseDraft(draft)
    if (!desired) {
      setError('请填写完整整数：扫描 60–604800 秒，轮询 10–3600 秒，最大并发 1–8。')
      return
    }
    const epoch = ++epochRef.current
    setBusy(true)
    // A Save/Rollback invalidates the initial history read's epoch. Clear its
    // loading indicator now; the later authoritative read repopulates history.
    setHistoryLoading(false)
    setError('')
    setNotice('')
    try {
      const next = await source.saveSourceWorkerConfig({ revision: config.revision, desired })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(valuesToDraft(next.desired))
      setTarget('')
      setNotice(next.apply_state === 'applied'
        ? '配置已保存，已观测在线 Worker 确认生效。'
        : '配置已保存，等待 Worker 在安全任务边界生效。')
      if (source.loadSourceWorkerRevisions) {
        try {
          const page = await source.loadSourceWorkerRevisions()
          if (epoch === epochRef.current) { setHistory(page.items); setHistoryError('') }
        } catch {
          if (epoch === epochRef.current) setHistoryError('配置已保存，但历史刷新失败。')
        }
      }
    } catch (err) {
      if (epoch !== epochRef.current) return
      setError(xDriveCoreDependencyErrorMessage(err, 'worker', 'save'))
      const actual = source.loadSourceWorkerConfig
        ? await source.loadSourceWorkerConfig().catch(() => null)
        : null
      if (actual && epoch === epochRef.current) {
        setConfig(actual)
        // A Save with missing ACK must keep the edit until the operator
        // explicitly reconciles or discards it; never overwrite the draft.
      }
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const targetRevision = history.find((item) =>
    String(item.revision) === target && item.revision < (config?.revision ?? 0),
  )
  const rollback = async () => {
    if (!config?.editable || !source.rollbackSourceWorker || !targetRevision || busy) return
    const epoch = ++epochRef.current
    setBusy(true)
    // A Save/Rollback invalidates the initial history read's epoch. Clear its
    // loading indicator now; the later authoritative read repopulates history.
    setHistoryLoading(false)
    setError('')
    setNotice('')
    try {
      const next = await source.rollbackSourceWorker({
        revision: config.revision,
        target_revision: targetRevision.revision,
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(valuesToDraft(next.desired))
      setTarget('')
      setNotice('历史参数已恢复为新修订并审计；等待活跃 Pull Worker 在安全任务边界确认实际生效。')
      if (source.loadSourceWorkerRevisions) {
        try {
          const page = await source.loadSourceWorkerRevisions()
          if (epoch === epochRef.current) { setHistory(page.items); setHistoryError('') }
        } catch {
          if (epoch === epochRef.current) setHistoryError('回滚已保存，但历史刷新失败。')
        }
      }
    } catch (err) {
      if (epoch !== epochRef.current) return
      setError(xDriveCoreDependencyErrorMessage(err, 'worker', 'rollback'))
      const actual = source.loadSourceWorkerConfig
        ? await source.loadSourceWorkerConfig().catch(() => null)
        : null
      if (actual && epoch === epochRef.current) {
        setConfig(actual)
        setDraft(valuesToDraft(actual.desired))
      }
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false)
        setConfirmRollback(false)
      }
    }
  }

  const parsed = parseDraft(draft)
  const changed = config && parsed && (
    parsed.scan_interval_seconds !== config.desired.scan_interval_seconds ||
    parsed.poll_interval_seconds !== config.desired.poll_interval_seconds ||
    parsed.max_concurrency !== config.desired.max_concurrency
  )
  const isDraftDirty = Boolean(config && (!parsed || changed))

  useEffect(() => { onDirtyChange?.(isDraftDirty) }, [onDirtyChange, isDraftDirty])
  useEffect(() => { onBusyChange?.(busy || loading) },
    [onBusyChange, busy, loading])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}
      data-xdrive-admin-source-worker>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>后台 Worker 设置</Typography>
          {!singlePage && <Button variant="outlined" size="small"
            disabled={busy || loading || isDraftDirty || !source.loadSourceWorkerConfig}
            onClick={() => { void reload() }}>验证生效状态</Button>}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          调整 Pull Worker 扫描、轮询和并发；运行中任务不中断，新参数在安全任务边界生效。
        </Typography>
        {config ? (
          <>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" variant="outlined"
                color={config.apply_state === 'applied' ? 'success' :
                  config.apply_state === 'pending' ? 'warning' : 'default'}
                label={config.apply_state === 'applied' ? '全部在线实例已生效' :
                  config.apply_state === 'pending' ? '部分实例待生效' :
                    config.apply_state === 'unavailable' ? '无在线实例' : '未由管理员管理'} />
              <Typography variant="caption" color="text.secondary">
                在线 {config.active_instances} 个 · 已生效 {config.applied_instances} 个
                {!singlePage ? ` · 修订 #${config.revision}` : ''}
              </Typography>
            </Stack>
            <Typography variant="body2" color={config.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
              {applyLabels[config.apply_state]}
              {config.truncated ? ' · 查询结果不完整，不能确认全部生效' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              已保存：{valuesSummary(config.desired)}
            </Typography>
            {config.effective.map((group) => (
              <Typography variant="caption" color="text.secondary"
                key={`${group.revision}-${group.config.scan_interval_seconds}-${group.config.poll_interval_seconds}-${group.config.max_concurrency}`}>
                在线实例：{group.count} 个，{valuesSummary(group.config)}
                {!singlePage ? ` · 修订 #${group.revision}` : ''}
              </Typography>
            ))}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {loading ? '正在读取 Pull Worker 管理配置…' :
              '当前 Server/Agent 不支持 Pull Worker 参数管理，不能提供虚假的启用或保存按钮。'}
          </Typography>
        )}
        {(section === 'config' || section === 'all') && config && (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField size="small" fullWidth type="number" label="扫描间隔（秒）"
                helperText={!parsed && draft.scan ? '允许 60–604800 秒' : undefined} value={draft.scan}
                disabled={!config.editable || busy}
                onChange={(e) => setDraft((old) => ({ ...old, scan: e.target.value }))} />
              <TextField size="small" fullWidth type="number" label="轮询间隔（秒）"
                helperText={!parsed && draft.poll ? '允许 10–3600 秒' : undefined} value={draft.poll}
                disabled={!config.editable || busy}
                onChange={(e) => setDraft((old) => ({ ...old, poll: e.target.value }))} />
              <TextField size="small" fullWidth type="number" label="最大并发"
                helperText={!parsed && draft.concurrency ? '允许 1–8' : undefined} value={draft.concurrency}
                disabled={!config.editable || busy}
                onChange={(e) => setDraft((old) => ({ ...old, concurrency: e.target.value }))} />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button variant="contained" size="small" disabled={!config.editable || !parsed || !changed ||
                busy || !source.saveSourceWorkerConfig}
                onClick={() => { void save() }}>{busy ? '正在保存…' : '保存配置'}</Button>
              {singlePage && isDraftDirty && (
                <Button variant="text" size="small" disabled={busy || loading}
                  onClick={() => setDraft(valuesToDraft(config.desired))}>放弃修改</Button>
              )}
            </Stack>
          </>
        )}
        {(section === 'history' || section === 'all') &&
          !!source.loadSourceWorkerRevisions && !!source.rollbackSourceWorker && !!config && (
          <Box>
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}
                id="dependency-background-worker-history-header" sx={{ scrollMarginTop: 72 }}>
                配置历史与回滚
              </Typography>
              {historyLoading && <Typography variant="caption" color="text.secondary">正在读取历史…</Typography>}
              <TextField select fullWidth size="small" label="回滚到较早的运行配置"
                value={target} disabled={busy || isDraftDirty || historyLoading || !config.editable ||
                  !history.some((x) => x.revision < config.revision)}
                onChange={(e) => setTarget(e.target.value)}
                helperText="回滚会生成新的审计修订；不会立即取消或中断运行中的任务。">
                <MenuItem value="">选择历史修订</MenuItem>
                {history.filter((x) => x.revision < config.revision).map((x) => (
                  <MenuItem key={x.revision} value={String(x.revision)}>
                    <Stack spacing={0}>
                      <Typography variant="body2">
                        #{x.revision} · {x.origin === 'default' ? '代码默认值' :
                          x.origin === 'rollback' ? '历史回滚' : '管理员保存'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {valuesSummary(x.desired)} · {new Date(x.created_at).toLocaleString()}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="outlined" size="small"
                disabled={busy || isDraftDirty || !config.editable || !targetRevision}
                onClick={() => setConfirmRollback(true)}>确认回滚 Worker 参数</Button>
              <XDriveConfirmDialog open={confirmRollback}
                title="确认回滚独立 Pull Worker 运行配置"
                description={targetRevision
                  ? `将恢复修订 #${targetRevision.revision}：${valuesSummary(targetRevision.desired)}。
                  这会生成新的审计修订；当前任务不会中断，在线 Worker 待批次结束后再生效。`
                  : '历史修订已失效，请刷新后重试。'}
                confirmLabel="确认安全回滚" loading={busy}
                onCancel={() => setConfirmRollback(false)}
                onConfirm={() => { void rollback() }} />
            </Stack>
          </Box>
        )}
        {section === 'all' && !source.loadSourceWorkerRevisions && (
          <Typography variant="caption" color="text.secondary">当前版本不支持查看 Worker 历史。</Typography>
        )}
        {historyError && <Typography variant="caption" color="warning.main">{historyError}</Typography>}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
