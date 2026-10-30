import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { XDriveServerBackupPage, XDriveServerBackupPort } from '../server-backup-admin'
import { XDriveConfirmDialog } from './ConfirmDialog'

type Preset = 'daily' | 'weekly' | 'disabled'
type Selection = Preset | 'custom'
const labels: Record<Preset, string> = {
  daily: '每天 03:17（宿主机本地时间）',
  weekly: '每周日 03:17（宿主机本地时间）',
  disabled: '停用安装器定时备份',
}
const expressionFor: Record<Preset, string> = {
  daily: '17 3 * * *', weekly: '17 3 * * 0', disabled: '',
}
function selectedFromHost(expression: string): Selection {
  if (expression === expressionFor.daily) return 'daily'
  if (expression === expressionFor.weekly) return 'weekly'
  if (expression === '') return 'disabled'
  return 'custom'
}
function trustedSchedule(page: XDriveServerBackupPage | null): boolean {
  const schedule = page?.inventory.schedule
  const policy = page?.inventory.policy
  return Boolean(page?.supported && schedule &&
    schedule.protocol === 'xdrive-host-backup-schedule-v1' &&
    schedule.source === 'installer_crontab' &&
    ['registered', 'not_detected', 'not_configured'].includes(schedule.state) &&
    typeof policy?.revision === 'string' && /^[a-f0-9]{64}$/.test(policy.revision))
}

/** Fixed schedule presets only. Host Control, not React or Electron, owns the
 * cron command, installer locks, revision check, and rollback. */
export function XDriveBackupScheduleControl({ port }: { port: XDriveServerBackupPort }) {
  const generation = useRef(0)
  const requestSequence = useRef(0)
  const selectedByOperator = useRef(false)
  const [snapshot, setSnapshot] = useState<{ port: XDriveServerBackupPort; page: XDriveServerBackupPage } | null>(null)
  const [selection, setSelection] = useState<Selection>('custom')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const page = snapshot && snapshot.port === port ? snapshot.page : null

  const refresh = useCallback(async () => {
    const ownerGeneration = generation.current
    const request = ++requestSequence.current
    try {
      const result = await port.read()
      if (ownerGeneration !== generation.current || request !== requestSequence.current) return
      if (!result.supported) throw new Error('host unavailable')
      setSnapshot({ port, page: result })
      setError('')
      if (!selectedByOperator.current) {
        const source = result.inventory.schedule?.expression
        setSelection(typeof source === 'string' ? selectedFromHost(source) : 'custom')
      }
    } catch {
      if (ownerGeneration !== generation.current || request !== requestSequence.current) return
      setSnapshot(null)
      setConfirming(false)
      setError('无法读取当前可信的宿主机计划状态，已禁用定时计划修改。')
    }
  }, [port])

  useEffect(() => {
    generation.current += 1
    requestSequence.current += 1
    selectedByOperator.current = false
    setSnapshot(null)
    setSelection('custom')
    setNotice('')
    setError('')
    setSaving(false)
    setConfirming(false)
    void refresh()
    const poll = window.setInterval(() => { void refresh() }, 30000)
    return () => { generation.current += 1; requestSequence.current += 1; window.clearInterval(poll) }
  }, [refresh])

  const schedule = page?.inventory.schedule
  const active = page?.operation.state === 'running' || page?.operation.state === 'queued'
  const valid = trustedSchedule(page)
  const current = typeof schedule?.expression === 'string' ? selectedFromHost(schedule.expression) : 'custom'
  const canSubmit = valid && !saving && !active && selection !== 'custom' &&
    (selection !== current || schedule?.state === 'not_detected')

  const submit = async () => {
    if (!canSubmit || !page) return
    const expected = page.inventory.policy.revision
    const selected = selection
    const ownerGeneration = generation.current
    setConfirming(false)
    setSaving(true)
    setError('')
    try {
      // Recheck the Host before queuing any privileged action, not merely
      // the cached panel revision. Server and Host recheck it independently.
      const latest = await port.read()
      if (ownerGeneration !== generation.current) return
      if (!trustedSchedule(latest) || latest.inventory.policy.revision !== expected ||
          latest.operation.state === 'running' || latest.operation.state === 'queued') {
        setSnapshot({ port, page: latest })
        throw new Error('stale')
      }
      const accepted = await port.submit({
        action: 'schedule', preset: selected, revision: expected,
        confirmation: 'SCHEDULE ' + selected,
      })
      if (ownerGeneration !== generation.current) return
      selectedByOperator.current = false
      setNotice('计划修改已提交宿主机队列' +
        (accepted.request_id ? '（请求 ' + accepted.request_id + '）' : '') +
        '；提交不代表已安装或执行成功，请核对操作结果和最新注册状态。')
      await refresh()
    } catch {
      if (ownerGeneration === generation.current) {
        setError('计划操作未确认，可能是宿主机不可用或配置版本已变化。请刷新，不会自动重试。')
      }
    } finally {
      if (ownerGeneration === generation.current) setSaving(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}
      data-xdrive-admin-backup-schedule-control>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={600}>定时备份 · 安全启停与计划</Typography>
        <Typography variant="body2" color="text.secondary">
          仅操作 xDrive 安装器托管的固定 cron 记录，不能填写命令、路径或任意 cron 表达式。
          每日与每周的 03:17 均按宿主机本地时区运行，停用不会删除已有备份。
        </Typography>
        <Typography variant="body2">
          真实注册状态：{schedule?.state ?? '未提供'}；当前配置：
          {schedule?.expression || '未配置／停用'}
        </Typography>
        {(!valid || schedule?.state === 'mismatch') ? (
          <Alert severity="warning">
            缺少可信宿主机状态、存在重复或不匹配的托管任务时，不能通过网页覆盖 cron。
            请先在宿主机检查安装器管理的计划。
          </Alert>
        ) : null}
        <Stack direction="row" flexWrap="wrap" gap={1.5} alignItems="center">
          <TextField
            select size="small" label="计划预设" sx={{ minWidth: 280 }}
            value={selection} disabled={!valid || saving || active}
            onChange={e => {
              selectedByOperator.current = true
              setSelection(e.target.value as Selection)
              setNotice('')
            }}
          >
            <MenuItem value="custom" disabled>宿主机自定义计划（不可在此编辑）</MenuItem>
            <MenuItem value="daily">{labels.daily}</MenuItem>
            <MenuItem value="weekly">{labels.weekly}</MenuItem>
            <MenuItem value="disabled">{labels.disabled}</MenuItem>
          </TextField>
          <Button variant="outlined" disabled={saving}
            onClick={() => { void refresh() }}>刷新当前状态</Button>
          <Button variant="contained" disabled={!canSubmit}
            onClick={() => setConfirming(true)}>确认计划变更</Button>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity="info">{notice}</Alert> : null}
        <Typography variant="caption" color="text.secondary">
          仅管理安装器的 cron；systemd、DSM 和其他外部调度器不在此控制范围内。
          正在执行的备份不会因停用计划而被中断。
        </Typography>
      </Stack>
      <XDriveConfirmDialog
        open={confirming} title="确认修改自动备份计划？"
        description={selection === 'disabled'
          ? '停用安装器托管的后续自动备份。已有快照与外部计划不变。'
          : '请求调整为' + (selection === 'custom' ? '未知计划' : labels[selection]) +
            '。这不会立即启动备份，需宿主机执行并核对状态。'}
        confirmLabel="提交给宿主机" confirmIntent="warning" loading={saving}
        onCancel={() => setConfirming(false)}
        onConfirm={() => { void submit() }}
      />
    </Paper>
  )
}
