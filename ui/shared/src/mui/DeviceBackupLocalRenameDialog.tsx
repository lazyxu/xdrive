import { useEffect, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField, Typography,
} from '@mui/material'
import type { XDriveLocalBoundBackupSettings } from '../device-backups'

// Provided only by a credential-verified owning Desktop; no Root or token.
export interface XDriveLocalBackupSettingsActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSettings>
  rename(sourceID: number, revision: number, name: string): Promise<XDriveLocalBoundBackupSettings>
}

export function XDriveDeviceBackupLocalRenameDialog({
  sourceID, actions, onClose, onFinished,
}: {
  sourceID: number
  actions: XDriveLocalBackupSettingsActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [settings, setSettings] = useState<XDriveLocalBoundBackupSettings | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryID, setRetryID] = useState(0)
  const valid = name.trim().length > 0 && new TextEncoder().encode(name.trim()).length <= 128

  useEffect(() => {
    let active = true
    setLoading(true)
    setSettings(null)
    setError('')
    void actions.load(sourceID).then((data) => {
      if (!active) return
      if (data.source_id !== sourceID || !Number.isSafeInteger(data.revision) || data.revision <= 0) {
        throw new Error('本机 Source 身份或版本不匹配')
      }
      setSettings(data)
      setName(data.name)
      setLoading(false)
    }).catch((failure) => {
      if (!active) return
      setError('读取本机配置失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setLoading(false)
    })
    return () => { active = false }
  }, [sourceID, actions, retryID])

  const save = async () => {
    if (busy || loading || !settings || !valid) return
    setBusy(true)
    setError('')
    try {
      const result = await actions.rename(sourceID, settings.revision, name.trim())
      if (result.source_id !== sourceID) throw new Error('Source ID 不匹配')
      onFinished('已通过本机 Agent 重命名同步文件夹；真正的上传仍未启用')
    } catch (failure) {
      setError('保存失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="xs">
      <DialogTitle>重命名本机同步文件夹</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            只修改当前设备已绑定的备份名称，不变更 Root、目标目录或运行计划。
          </Typography>
          {loading ? <Typography variant="body2">正在验证本机 Root 授权…</Typography> : null}
          <TextField label="同步文件夹名称" fullWidth size="small"
            value={name} disabled={loading || busy || !settings}
            onChange={(event) => setName(event.target.value)}
            error={name.length > 0 && !valid}
            helperText="最多 128 字节；保存时 Agent 与 Server 双重校验"
          />
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetryID((n) => n + 1)}>重新读取配置</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={busy || loading || !settings || !valid || name.trim() === settings.name}
          onClick={() => void save()}>{busy ? '保存中…' : '保存名称'}</Button>
      </DialogActions>
    </Dialog>
  )
}
