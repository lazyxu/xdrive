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

// Common personal-backup choices. Keep the existing custom interval and Cron
// protocol untouched for advanced users and previously saved schedules.
const INTERVAL_PRESETS = [
  { label: '每小时', value: '1h' },
  { label: '每 6 小时', value: '6h' },
  { label: '每天', value: '24h' },
] as const

export interface XDriveLocalBackupScheduleActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSchedule>
  save(sourceID: number, revision: number, schedule: SavedSchedule): Promise<XDriveLocalBoundBackupSchedule>
}

// Local interval/cron schedules execute only on the owning device's
// Agent after a verified first manual batch under the CURRENT Source revision.
// Saving configuration never activates the Server runner or gives remote devices write access.
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
      onFinished(proposal.schedule_type === 'manual'
        ? '已保存手动模式，本机不会自动安排增量备份'
        : '已保存计划。请先在所属设备本机完成一次当前版本的手动增量备份，后续才会自动按计划检查')
    } catch (failure) {
      setError('保存本机计划失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="sm">
      <DialogTitle>本机同步文件夹 · 自动备份</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            只有当前设备所属的本机 Agent 会执行已明确开启的间隔或 Cron 计划。保存或修改计划后，
            请先手动完成一次当前 Source 版本的增量备份以建立私有可信检查点。此后 Agent 在线时才会定期检查，
            并复用同一持久任务队列。暂停、取消、不确定任务及撤权不会自动重启；仅 Backup，不删除文件。
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
              disabled={loading || busy || !loaded} label="仅手动备份" />
            <FormControlLabel value="interval" control={<Radio />}
              disabled={loading || busy || !loaded} label="自动增量备份（推荐）" />
            <FormControlLabel value="cron" control={<Radio />}
              disabled={loading || busy || !loaded} label="高级：自定义 Cron 计划" />
          </RadioGroup>
          {kind === 'interval' ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                选择常用备份间隔
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {INTERVAL_PRESETS.map((preset) => (
                  <Button key={preset.value} size="small"
                    disabled={loading || busy || !loaded}
                    variant={expression === preset.value ? 'contained' : 'outlined'}
                    onClick={() => setExpression(preset.value)}>
                    {preset.label}
                  </Button>
                ))}
              </Stack>
              <TextField fullWidth size="small" label="其他间隔（可选）" value={expression}
                onChange={(event) => setExpression(event.target.value)} disabled={loading || busy}
                helperText="例如 30m、12h；范围 1 分钟至 365 天，保持兼容原有设置" />
            </Stack>
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
            Server 校验计划语法和时区。Agent 约每分钟检查一次；设备离线、休眠、Source 版本变化或
            缺少当前 Owner 会话的可信手动运行记录时，不会执行。计划触发不代表整轮备份已经成功。
          </Typography>
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetryID((n) => n + 1)}>重新读取计划</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => void save()}>
          {busy ? '保存中…' : '保存计划'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
