import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
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
  refreshID,
}: {
  source: XDriveSourceWorkerPort
  refreshID: number
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
    if (source.loadSourceWorkerRevisions) {
      void source.loadSourceWorkerRevisions().then((next) => {
        if (active && epoch === epochRef.current) setHistory(next.items)
      }).catch(() => {
        if (active && epoch === epochRef.current) {
          setHistoryError('无法读取 Pull Worker 历史修订。')
        }
      })
    }
    return () => { active = false; ++epochRef.current }
  }, [source, refreshID])

  const reload = async () => {
    if (!source.loadSourceWorkerConfig || busy) return
    const epoch = ++epochRef.current
    setLoading(true)
    setError('')
    try {
      const next = await source.loadSourceWorkerConfig()
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(valuesToDraft(next.desired))
      if (source.loadSourceWorkerRevisions) {
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
        setError(err instanceof Error ? err.message : '刷新 Pull Worker 状态失败。')
      }
    } finally {
      if (epoch === epochRef.current) setLoading(false)
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
    setError('')
    setNotice('')
    try {
      const next = await source.saveSourceWorkerConfig({ revision: config.revision, desired })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(valuesToDraft(next.desired))
      setTarget('')
      setNotice(next.apply_state === 'applied'
        ? '配置已保存、审计，并由全部已观察在线 Worker 确认生效。'
        : '配置已保存并审计，实际生效仍需 Worker 完成当前批次、更新心跳后才能确认。')
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
      setError(err instanceof Error ? err.message : 'Pull Worker 配置保存失败。')
      const actual = source.loadSourceWorkerConfig
        ? await source.loadSourceWorkerConfig().catch(() => null)
        : null
      if (actual && epoch === epochRef.current) {
        setConfig(actual)
        setDraft(valuesToDraft(actual.desired))
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
      setError(err instanceof Error ? err.message : '历史配置回滚失败。')
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

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}
      data-xdrive-admin-source-worker>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>独立 Pull Worker · 运行配置</Typography>
          <Button variant="outlined" size="small" disabled={busy || loading || !source.loadSourceWorkerConfig}
            onClick={() => { void reload() }}>验证生效状态</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          仅配置系统级扫描周期、轮询周期和网络并发。已运行的远程拉取批次正常完成；
          下一个安全任务边界更新配置，不会重启容器，也不会中断上传、下载、同步或设备备份。
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
                期望修订 #{config.revision} · {config.source === 'saved' ? '持久化策略' : '代码默认值（不代表部署参数）'}
                {' · '}在线 {config.active_instances} 个 · 确认生效 {config.applied_instances} 个
              </Typography>
            </Stack>
            <Typography variant="body2" color={config.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
              {applyLabels[config.apply_state]}
              {config.truncated ? ' · 在线实例超过查询上限，不判定为全部已生效' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              期望参数：{valuesSummary(config.desired)}
            </Typography>
            {config.effective.map((group) => (
              <Typography variant="caption" color="text.secondary"
                key={`${group.revision}-${group.config.scan_interval_seconds}-${group.config.poll_interval_seconds}-${group.config.max_concurrency}`}>
                实际心跳：{group.count} 个 Worker，修订 #{group.revision}，{valuesSummary(group.config)}
              </Typography>
            ))}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {loading ? '正在读取 Pull Worker 管理配置…' :
              '当前 Server/Agent 不支持 Pull Worker 参数管理，不能提供虚假的启用或保存按钮。'}
          </Typography>
        )}
        {config && (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField size="small" fullWidth type="number" label="扫描间隔（秒）"
                helperText="60–604800" value={draft.scan}
                disabled={!config.editable || busy}
                onChange={(e) => setDraft((old) => ({ ...old, scan: e.target.value }))} />
              <TextField size="small" fullWidth type="number" label="轮询间隔（秒）"
                helperText="10–3600" value={draft.poll}
                disabled={!config.editable || busy}
                onChange={(e) => setDraft((old) => ({ ...old, poll: e.target.value }))} />
              <TextField size="small" fullWidth type="number" label="最大并发"
                helperText="1–8" value={draft.concurrency}
                disabled={!config.editable || busy}
                onChange={(e) => setDraft((old) => ({ ...old, concurrency: e.target.value }))} />
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button variant="contained" size="small" disabled={!config.editable || !parsed || !changed ||
                busy || !source.saveSourceWorkerConfig}
                onClick={() => { void save() }}> {busy ? '正在提交…' : '保存期望配置'} </Button>
              <Typography variant="caption" color="text.secondary">
                保存后先显示待生效；以 Worker 心跳上报的修订号与实际参数验证，不凭表单判断。
              </Typography>
            </Stack>
          </>
        )}
        {!!source.loadSourceWorkerRevisions && !!source.rollbackSourceWorker && !!config && (
          <Box>
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>版本历史与审计回滚</Typography>
              <TextField select fullWidth size="small" label="回滚到较早的运行配置"
                value={target} disabled={busy || !config.editable ||
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
              <Button variant="outlined" size="small" disabled={busy || !config.editable || !targetRevision}
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
        {historyError && <Typography variant="caption" color="warning.main">{historyError}</Typography>}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
