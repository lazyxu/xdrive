import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import type {
  XDrivePostgresPoolConfig,
  XDrivePostgresPoolValues,
  XDrivePostgresPoolUpdate,
  XDrivePostgresPoolRevisionPage,
  XDrivePostgresPoolRollbackInput,
} from '../service-dependencies'

export type XDrivePostgresPoolPort = {
  loadPostgresPoolConfig?: () => Promise<XDrivePostgresPoolConfig>
  savePostgresPoolConfig?: (input: XDrivePostgresPoolUpdate) => Promise<XDrivePostgresPoolConfig>
  loadPostgresPoolRevisions?: () => Promise<XDrivePostgresPoolRevisionPage>
  rollbackPostgresPool?: (input: XDrivePostgresPoolRollbackInput) => Promise<XDrivePostgresPoolConfig>
}

type PoolDraft = { open: string; idle: string }

function asDraft(values: XDrivePostgresPoolValues): PoolDraft {
  return { open: String(values.max_open_connections), idle: String(values.max_idle_connections) }
}

function parseDraft(draft: PoolDraft): XDrivePostgresPoolValues | null {
  const open = Number(draft.open)
  const idle = Number(draft.idle)
  if (!draft.open.trim() || !draft.idle.trim() ||
    !Number.isSafeInteger(open) || !Number.isSafeInteger(idle) ||
    !(open === 0 || (open >= 8 && open <= 256)) ||
    idle < 0 || idle > 32 || (open !== 0 && idle > open)) return null
  return { max_open_connections: open, max_idle_connections: idle }
}

function summary(values: XDrivePostgresPoolValues): string {
  return `最大打开连接 ${values.max_open_connections === 0 ? 'Go 默认不限额' : values.max_open_connections} · 最大空闲连接 ${values.max_idle_connections}`
}

export function XDrivePostgresPoolConfigPanel({
  source,
  refreshID,
}: {
  source: XDrivePostgresPoolPort
  refreshID: number
}) {
  const epochRef = useRef(0)
  const [config, setConfig] = useState<XDrivePostgresPoolConfig | null>(null)
  const [history, setHistory] = useState<XDrivePostgresPoolRevisionPage['items']>([])
  const [draft, setDraft] = useState<PoolDraft>({ open: '', idle: '' })
  const [target, setTarget] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyError, setHistoryError] = useState('')

  useEffect(() => {
    let active = true
    const epoch = ++epochRef.current
    setConfig(null)
    setHistory([])
    setDraft({ open: '', idle: '' })
    setTarget('')
    setConfirmSave(false)
    setConfirmRollback(false)
    setError('')
    setNotice('')
    setHistoryError('')
    setLoading(true)
    setBusy(false)
    if (source.loadPostgresPoolConfig) {
      void source.loadPostgresPoolConfig().then((next) => {
        if (!active || epoch !== epochRef.current) return
        setConfig(next)
        setDraft(asDraft(next.desired))
      }).catch(() => {
        if (active && epoch === epochRef.current) setError('无法读取 PostgreSQL 连接池管理配置。请检查 Server 和 Desktop Agent。')
      }).finally(() => {
        if (active && epoch === epochRef.current) setLoading(false)
      })
    } else {
      setLoading(false)
    }
    if (source.loadPostgresPoolRevisions) {
      void source.loadPostgresPoolRevisions().then((page) => {
        if (active && epoch === epochRef.current) setHistory(page.items)
      }).catch(() => {
        if (active && epoch === epochRef.current) setHistoryError('无法读取 PostgreSQL 连接池历史修订。')
      })
    }
    return () => { active = false; ++epochRef.current }
  }, [source, refreshID])

  const reload = async () => {
    if (!source.loadPostgresPoolConfig || busy) return
    const epoch = ++epochRef.current
    setLoading(true)
    setError('')
    try {
      const next = await source.loadPostgresPoolConfig()
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(asDraft(next.desired))
      if (source.loadPostgresPoolRevisions) {
        const page = await source.loadPostgresPoolRevisions().catch(() => null)
        if (epoch === epochRef.current && page) {
          setHistory(page.items)
          setHistoryError('')
        }
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(err instanceof Error ? err.message : '刷新 PostgreSQL 连接池状态失败。')
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  const save = async () => {
    const desired = parseDraft(draft)
    if (!config?.editable || !source.savePostgresPoolConfig || busy || !desired) {
      setConfirmSave(false)
      if (!desired) setError('最大打开连接数须为 0 或 8–256；空闲连接数须为 0–32 且不超过打开连接上限。')
      return
    }
    const epoch = ++epochRef.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await source.savePostgresPoolConfig({ revision: config.revision, desired })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(asDraft(next.desired))
      setTarget('')
      setNotice(next.apply_state === 'applied'
        ? '已持久化、审计并确认当前 Server 的真实数据库连接池上限热生效；其他 Server 独立协调。'
        : '配置已持久化，但当前 Server 尚未确认实际生效；请刷新状态。')
      if (source.loadPostgresPoolRevisions) {
        const page = await source.loadPostgresPoolRevisions().catch(() => null)
        if (epoch === epochRef.current && page) { setHistory(page.items); setHistoryError('') }
      }
    } catch (err) {
      if (epoch !== epochRef.current) return
      setError(err instanceof Error ? err.message : 'PostgreSQL 连接池配置未确认保存。')
      const current = await source.loadPostgresPoolConfig?.().catch(() => null)
      if (current && epoch === epochRef.current) { setConfig(current); setDraft(asDraft(current.desired)) }
    } finally {
      if (epoch === epochRef.current) {
        setBusy(false)
        setConfirmSave(false)
      }
    }
  }

  const historic = history.find((item) =>
    String(item.revision) === target && item.revision < (config?.revision ?? 0),
  )
  const rollback = async () => {
    if (!config?.editable || !source.rollbackPostgresPool || !historic || busy) return
    const epoch = ++epochRef.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await source.rollbackPostgresPool({ revision: config.revision, target_revision: historic.revision })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setDraft(asDraft(next.desired))
      setTarget('')
      setNotice(next.apply_state === 'applied'
        ? '已创建新的审计修订，并确认当前 Server 连接池热回滚完成。'
        : '已保存历史配置为新修订，当前 Server 仍待生效确认。')
      if (source.loadPostgresPoolRevisions) {
        const page = await source.loadPostgresPoolRevisions().catch(() => null)
        if (page && epoch === epochRef.current) { setHistory(page.items); setHistoryError('') }
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(err instanceof Error ? err.message : 'PostgreSQL 连接池回滚失败。')
    } finally {
      if (epoch === epochRef.current) { setBusy(false); setConfirmRollback(false) }
    }
  }

  const parsed = parseDraft(draft)
  const changed = config && parsed && (
    parsed.max_open_connections !== config.desired.max_open_connections ||
    parsed.max_idle_connections !== config.desired.max_idle_connections
  )

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}
      data-xdrive-admin-postgres-pool>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2" fontWeight={700}>PostgreSQL · xDrive Server 连接池</Typography>
          <Button variant="outlined" size="small" disabled={!source.loadPostgresPoolConfig || busy || loading}
            onClick={() => { void reload() }}>验证当前实例</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          仅调节本 Server 使用的 database/sql 连接池，不修改 PostgreSQL 数据库服务端配置、连接地址、凭据、
          数据卷或容器。保存后当前实例立即应用，其他 Server 每 30 秒独立读取并应用，不代表集群已完成。
        </Typography>
        {config ? (
          <>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip size="small" variant="outlined" color={config.apply_state === 'applied' ? 'success' : 'default'}
                label={config.apply_state === 'applied' ? '当前实例已生效' :
                  config.apply_state === 'pending' ? '当前实例待生效' : '未由管理员管理'} />
              <Typography variant="caption" color="text.secondary">
                期望修订 #{config.revision} · 当前实例修订 #{config.effective_revision}
                {' · '}{config.source === 'saved' ? '管理员持久设置' : 'Go 默认值，未声明部署状态'}
              </Typography>
            </Stack>
            <Typography variant="body2" color={config.apply_state === 'pending' ? 'warning.main' : 'text.secondary'}>
              期望：{summary(config.desired)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              实际：{config.effective ? summary(config.effective) : '尚无经本 Server 确认的管理员应用修订'}
              {' · '}打开中 {config.open_connections} · 使用中 {config.in_use_connections}
              {' · '}空闲 {config.idle_connections} · 实际打开上限 {config.current_max_open_connections || '不限额'}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField size="small" fullWidth type="number" label="最大打开连接数" value={draft.open}
                helperText="0（Go 默认不限额）或 8–256"
                disabled={busy || !config.editable}
                onChange={(event) => setDraft((old) => ({ ...old, open: event.target.value }))} />
              <TextField size="small" fullWidth type="number" label="最大空闲连接数" value={draft.idle}
                helperText="0–32，不能超过非零打开连接上限"
                disabled={busy || !config.editable}
                onChange={(event) => setDraft((old) => ({ ...old, idle: event.target.value }))} />
            </Stack>
            <Button variant="contained" size="small" disabled={busy || !config.editable || !parsed || !changed ||
              !source.savePostgresPoolConfig} onClick={() => setConfirmSave(true)}>
              {busy ? '正在保存…' : '保存并热应用到当前 Server'}
            </Button>
            <XDriveConfirmDialog open={confirmSave} loading={busy}
              title="确认变更 PostgreSQL 连接池上限"
              description={parsed ? `应用新的连接池配置：${summary(parsed)}。仅作用于本应用进程，可能改变请求等待时间，不会修改数据库服务端、容器或数据目录；其他 Server 需独立确认。` : '配置无效'}
              confirmLabel="校验并保存" onCancel={() => setConfirmSave(false)}
              onConfirm={() => { void save() }} />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {loading ? '正在读取数据库连接池状态…' :
              '此 Server/Agent 版本不支持连接池在线配置；不会提供无效的编辑按钮。'}
          </Typography>
        )}
        {config && source.loadPostgresPoolRevisions && source.rollbackPostgresPool && (
          <Box>
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>版本历史与安全回滚</Typography>
              <TextField select size="small" fullWidth label="选择历史连接池配置" value={target}
                disabled={busy || !config.editable || !history.some((item) => item.revision < config.revision)}
                onChange={(event) => setTarget(event.target.value)}
                helperText="回滚会新建审计修订，仅热调整本 Server 的连接池上限。">
                <MenuItem value="">选择更早修订</MenuItem>
                {history.filter((item) => item.revision < config.revision).map((item) => (
                  <MenuItem key={item.revision} value={String(item.revision)}>
                    #{item.revision} · {item.origin === 'default' ? '原始默认值' :
                      item.origin === 'rollback' ? '历史回滚' : '管理员保存'} · {summary(item.desired)}
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="outlined" size="small" disabled={busy || !config.editable || !historic}
                onClick={() => setConfirmRollback(true)}>确认回滚历史配置</Button>
              <XDriveConfirmDialog open={confirmRollback} loading={busy}
                title="确认回滚 PostgreSQL 连接池"
                description={historic ? `将修订 #${historic.revision} 的参数恢复为新修订：${summary(historic.desired)}。不修改数据库服务端。` :
                  '历史目标失效，请刷新。'}
                confirmLabel="确认审计回滚" onCancel={() => setConfirmRollback(false)}
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
