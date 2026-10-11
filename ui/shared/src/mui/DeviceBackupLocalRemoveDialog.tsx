import { useEffect, useState } from 'react'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Stack, Typography,
} from '@mui/material'
import type { XDriveLocalBoundBackupRemoval, XDriveLocalBoundBackupSettings } from '../device-backups'

export interface XDriveLocalBackupRemoveActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSettings>
  remove(sourceID: number, revision: number): Promise<XDriveLocalBoundBackupRemoval>
}

// The caller supplies this port only for the credential-verified owning Desktop.
// Server-side device/Root/revision permission remains authoritative.
export function XDriveDeviceBackupLocalRemoveDialog({
  sourceID, actions, onClose, onFinished,
}: {
  sourceID: number
  actions: XDriveLocalBackupRemoveActions
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
      setSettings(data)
      setLoading(false)
    }).catch((failure) => {
      if (!active) return
      setError('验证本机配置失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setLoading(false)
    })
    return () => { active = false }
  }, [sourceID, actions, retry])

  const submit = async () => {
    if (busy || loading || !settings || !confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await actions.remove(sourceID, settings.revision)
      if (result.source_id !== sourceID) throw new Error('Agent 响应的 Source ID 不匹配')
      onFinished(result.local_grant_removed
        ? '已移除本机空白备份配置；本地原始文件及云端数据均保留'
        : 'Server 配置已移除，但本机授权记录未清理，请检查 Agent 日志')
    } catch (failure) {
      setError('移除失败或响应不确定：' +
        (failure instanceof Error ? failure.message : String(failure)) +
        '。请先刷新设备列表确认配置状态，避免重复操作。')
      setBusy(false)
      setConfirmed(false)
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="xs">
      <DialogTitle>移除本机备份配置</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            仅允许移除没有同步记录、文件条目或相册数据的已暂停配置。
            不会删除本地原始文件、云端文件或 CAS 内容；有历史记录的配置将被 Server 拒绝。
          </Alert>
          {loading ? <Typography variant="body2">正在验证本机 Root 授权…</Typography> : null}
          {settings ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">{settings.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                云端目标：{settings.target_path || '未设置'} · 版本 {settings.revision}
              </Typography>
            </Stack>
          ) : null}
          <FormControlLabel
            control={<Checkbox checked={confirmed} disabled={busy || loading || !settings}
              onChange={(_event, checked) => setConfirmed(checked)} />}
            label="我确认移除此配置，但保留本地和云端文件"
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetry((n) => n + 1)}>重新验证配置</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button color="error" variant="contained" disabled={busy || loading || !settings || !confirmed}
          onClick={() => void submit()}>{busy ? '移除中…' : '确认移除配置'}</Button>
      </DialogActions>
    </Dialog>
  )
}
