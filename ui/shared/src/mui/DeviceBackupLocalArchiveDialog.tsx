import { useEffect, useState } from 'react'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Stack, Typography,
} from '@mui/material'
import type { XDriveLocalBoundBackupSettings } from '../device-backups'

export type XDriveLocalBackupArchiveMode = 'archive' | 'restore'

export interface XDriveLocalBackupArchiveActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSettings>
  archive(sourceID: number, revision: number): Promise<XDriveLocalBoundBackupSettings>
  restore(sourceID: number, revision: number): Promise<XDriveLocalBoundBackupSettings>
}

// The caller supplies this port only for the current, verified owning Agent.
// Every operation is independently revalidated against the device credential,
// native Root grant, Source owner and revision by the Agent and Server.
export function XDriveDeviceBackupLocalArchiveDialog({
  sourceID, mode, actions, onClose, onFinished,
}: {
  sourceID: number
  mode: XDriveLocalBackupArchiveMode
  actions: XDriveLocalBackupArchiveActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [settings, setSettings] = useState<XDriveLocalBoundBackupSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setSettings(null)
    setConfirmed(false)
    setError('')
    void actions.load(sourceID).then((data) => {
      if (!active) return
      if (data.source_id !== sourceID || !Number.isSafeInteger(data.revision) || data.revision <= 0) {
        throw new Error('本机同步文件夹身份或配置版本不匹配')
      }
      if (mode === 'archive' && data.status !== 'active' && data.status !== 'paused') {
        throw new Error('来源状态已变化，请刷新设备列表后重试')
      }
      if (mode === 'restore' && data.status !== 'archived') {
        throw new Error('只有已归档的本机备份可以恢复，请刷新设备列表')
      }
      setSettings(data)
      setLoading(false)
    }).catch((failure) => {
      if (!active) return
      setError('验证本机设备与 Root 授权失败：' +
        (failure instanceof Error ? failure.message : String(failure)))
      setLoading(false)
    })
    return () => { active = false }
  }, [sourceID, mode, actions, retry])

  const submit = async () => {
    if (busy || loading || !settings || !confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = mode === 'archive'
        ? await actions.archive(sourceID, settings.revision)
        : await actions.restore(sourceID, settings.revision)
      const expectedStatus = mode === 'archive' ? 'archived' : 'paused'
      if (result.source_id !== sourceID || result.status !== expectedStatus ||
        !Number.isSafeInteger(result.revision) || result.revision <= settings.revision) {
        throw new Error('Server 返回的 Source 身份、版本或状态不匹配；请刷新确认实际状态')
      }
      onFinished(mode === 'archive'
        ? '本机备份已归档；Root 授权、云端文件、版本和同步历史均已保留'
        : '本机备份已恢复为暂停状态；检查设置后可手动恢复运行')
    } catch (failure) {
      setError((mode === 'archive' ? '归档' : '恢复') + '失败或响应不确定：' +
        (failure instanceof Error ? failure.message : String(failure)) +
        '。请先刷新设备列表确认状态，不要重复执行。')
      setBusy(false)
      setConfirmed(false)
    }
  }

  const isArchive = mode === 'archive'
  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="xs">
      <DialogTitle>{isArchive ? '归档本机备份？' : '恢复本机备份？'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity={isArchive ? 'warning' : 'info'}>
            {isArchive
              ? '归档会停止后续调度并保留原 Source、设备与 Root 绑定、云端目标、文件、版本和同步历史。不会删除本机原件或云端数据。正在执行的备份必须先结束或取消。'
              : '恢复会使用原 Source ID 和 Root 绑定，并将状态设为“暂停”。不会自动启动上传或计划任务；请检查授权、设置和计划后再手动恢复运行。'}
          </Alert>
          {loading ? <Typography variant="body2">正在验证本机设备与 Root 授权…</Typography> : null}
          {settings ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{settings.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                云端目标：{settings.target_path || '未设置'} · 当前状态：{settings.status} · 版本 {settings.revision}
              </Typography>
            </Stack>
          ) : null}
          <FormControlLabel
            control={<Checkbox checked={confirmed} disabled={busy || loading || !settings}
              onChange={(_event, checked) => setConfirmed(checked)} />}
            label={isArchive ? '我确认归档此本机备份，但保留所有文件和历史' : '我确认恢复此备份为暂停状态，不立即启动同步'}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetry((n) => n + 1)}>重新验证设备与 Root</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button color={isArchive ? 'warning' : 'primary'} variant="contained"
          disabled={busy || loading || !settings || !confirmed}
          onClick={() => void submit()}>
          {busy ? (isArchive ? '归档中…' : '恢复中…') : (isArchive ? '确认归档' : '确认恢复为暂停')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
