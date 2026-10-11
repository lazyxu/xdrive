import { useEffect, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import type { XDriveLocalBoundBackupSchedule } from '../device-backups'

type ScheduleKind = 'manual' | 'interval' | 'cron'
type SavedSchedule = {
  schedule_type: ScheduleKind
  schedule_expression: string
  schedule_timezone: string
}

export interface XDriveLocalBackupScheduleActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSchedule>
  save(sourceID: number, revision: number, schedule: SavedSchedule): Promise<XDriveLocalBoundBackupSchedule>
}

// A local, paused Source may save a future policy, but cannot activate the
// Server-runner or a native watcher. The parent supplies this only to the
// credential-verified owning Desktop. Remote devices have no action port.
export function XDriveDeviceBackupLocalScheduleDialog({
  sourceID, actions, onClose, onFinished,
}: {
  sourceID: number
  actions: XDriveLocalBackupScheduleActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [loaded, setLoaded] = useState<XDriveLocalBoundBackupSchedule | null>(null)
  const [kind, setKind] = useState<'' | ScheduleKind>('')
  const [expression, setExpression] = useState('')
  const [timezone, setTimezone] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryID, setRetryID] = useState(0)

  useEffect(() => {
    let active = true
    setLoaded(null)
    setKind('')
    setExpression('')
    setTimezone('')
    setLoading(true)
    setError('')
    void actions.load(sourceID).then((value) => {
      if (!active) return
      if (value.source_id !== sourceID || !Number.isSafeInteger(value.revision) ||
        value.revision <= 0 || !['', 'manual', 'interval', 'cron'].includes(value.schedule_type) ||
        typeof value.schedule_expression !== 'string' || typeof value.schedule_timezone !== 'string') {
        throw new Error('本机计划的 Source 身份、版本或格式无效')
      }
      setLoaded(value)
      setKind(value.schedule_type)
      setExpression(value.schedule_expression)
      setTimezone(value.schedule_timezone)
      setLoading(false)
    }).catch((failure) => {
      if (active) {
        setLoading(false)
        setError('读取本机计划失败：' + (failure instanceof Error ? failure.message : String(failure)))
      }
    })
    return () => { active = false }
  }, [sourceID, actions, retryID])

  const propose = (): SavedSchedule | null => {
    if (kind === '') return null
    if (kind === 'manual') return { schedule_type: 'manual', schedule_expression: '', schedule_timezone: '' }
    const rule = expression.trim()
    if (!rule || new TextEncoder().encode(rule).length > 256) return null
    if (kind === 'interval') return { schedule_type: 'interval', schedule_expression: rule, schedule_timezone: '' }
    const zone = timezone.trim() || 'UTC'
    if (rule.split(/\s+/).length !== 5 || new TextEncoder().encode(zone).length > 128) return null
    return { schedule_type: 'cron', schedule_expression: rule, schedule_timezone: zone }
  }
  const proposal = propose()
  const changed = loaded && proposal &&
    (proposal.schedule_type !== loaded.schedule_type ||
      proposal.schedule_expression !== loaded.schedule_expression ||
      proposal.schedule_timezone !== loaded.schedule_timezone)
  const canSave = !loading && !busy && loaded !== null && Boolean(changed) && proposal !== null

  const select = (next: ScheduleKind) => {
    setKind(next)
    setExpression(next === 'interval' ? '6h' : next === 'cron' ? '0 3 * * *' : '')
    setTimezone(next === 'cron' ? 'UTC' : '')
  }

  const save = async () => {
    if (!canSave || !loaded || !proposal) return
    setBusy(true)
    setError('')
    try {
      const result = await actions.save(sourceID, loaded.revision, proposal)
      if (result.source_id !== sourceID || !Number.isSafeInteger(result.revision) ||
        result.revision <= loaded.revision ||
        result.schedule_type !== proposal.schedule_type ||
        result.schedule_expression !== proposal.schedule_expression ||
        result.schedule_timezone !== proposal.schedule_timezone) {
        throw new Error('Server 返回的 Source 版本或计划不匹配，请刷新核对')
      }
      onFinished('已保存本机计划，但尚未启用后台执行器；当前不会自动开始同步')
    } catch (failure) {
      setError('保存本机计划失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="sm">
      <DialogTitle>本机同步文件夹 · 同步计划</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            本阶段只保存未来的执行计划。Source 仍保持暂停；本机 Agent 后台调度和上传尚未启用，
            保存后不会自动运行，也不会修改、删除云端文件。
          </Alert>
          {loading ? <Typography variant="body2">正在验证本机设备与 Root 授权…</Typography> : null}
          {loaded?.schedule_type === '' ? (
            <Typography variant="caption" color="text.secondary">
              当前没有显式保存计划。历史默认值不代表此设备已启用自动同步。
            </Typography>
          ) : null}
          <RadioGroup value={kind} onChange={(event) => {
            if (event.target.value === 'manual' || event.target.value === 'interval' || event.target.value === 'cron') {
              select(event.target.value)
            }
          }}>
            <FormControlLabel value="manual" control={<Radio />}
              disabled={loading || busy || !loaded} label="手动：仅保存手动策略，不创建任何任务" />
            <FormControlLabel value="interval" control={<Radio />}
              disabled={loading || busy || !loaded} label="定时间隔：例如每 6 小时" />
            <FormControlLabel value="cron" control={<Radio />}
              disabled={loading || busy || !loaded} label="Cron：5 字段定时表达式" />
          </RadioGroup>
          {kind === 'interval' ? (
            <TextField fullWidth size="small" label="时间间隔" value={expression}
              onChange={(event) => setExpression(event.target.value)} disabled={loading || busy}
              helperText="Go duration，例如 30m、6h、24h；服务端要求 1 分钟至 365 天" />
          ) : null}
          {kind === 'cron' ? (
            <>
              <TextField fullWidth size="small" label="5 字段 Cron 表达式"
                value={expression} disabled={loading || busy} onChange={(event) => setExpression(event.target.value)}
                helperText="例如 0 3 * * *，每天在所选时区凌晨 03:00" />
              <TextField fullWidth size="small" label="IANA 时区"
                value={timezone} disabled={loading || busy} onChange={(event) => setTimezone(event.target.value)}
                helperText="例如 Asia/Singapore、Asia/Shanghai 或 UTC；空值按 UTC" />
            </>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            计划的语法和时区由 Server 再次校验；计划仅为已保存配置，不代表设备在线或实际生效。
          </Typography>
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetryID((n) => n + 1)}>重新读取计划</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => void save()}>
          {busy ? '保存中…' : '保存计划（暂不执行）'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
