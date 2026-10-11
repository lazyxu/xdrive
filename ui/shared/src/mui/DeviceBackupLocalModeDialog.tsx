import { useEffect, useState } from 'react'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, Typography,
} from '@mui/material'
import type { XDriveLocalBoundBackupSettings } from '../device-backups'

export interface XDriveLocalBackupModeActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSettings>
  setMode(sourceID: number, revision: number, mode: 'backup' | 'mirror'): Promise<XDriveLocalBoundBackupSettings>
}

// A verified owning Desktop alone supplies this narrow Agent capability.
// No OS paths, Root credentials or background task control reaches the UI.
export function XDriveDeviceBackupLocalModeDialog({
  sourceID, actions, onClose, onFinished,
}: {
  sourceID: number
  actions: XDriveLocalBackupModeActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [settings, setSettings] = useState<XDriveLocalBoundBackupSettings | null>(null)
  const [mode, setMode] = useState<'backup' | 'mirror'>('backup')
  const [mirrorConfirmed, setMirrorConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryID, setRetryID] = useState(0)
  const changed = settings !== null && mode !== settings.sync_mode
  const canSave = !loading && !busy && changed && (mode !== 'mirror' || mirrorConfirmed)

  useEffect(() => {
    let active = true
    setSettings(null)
    setLoading(true)
    setError('')
    setMirrorConfirmed(false)
    void actions.load(sourceID).then((value) => {
      if (!active) return
      if (value.source_id !== sourceID || !Number.isSafeInteger(value.revision) ||
        value.revision <= 0 || (value.sync_mode !== 'backup' && value.sync_mode !== 'mirror')) {
        throw new Error('本机同步文件夹身份、版本或备份策略无效')
      }
      setSettings(value)
      setMode(value.sync_mode)
      setLoading(false)
    }).catch((failure) => {
      if (active) {
        setError('读取本机备份策略失败：' + (failure instanceof Error ? failure.message : String(failure)))
        setLoading(false)
      }
    })
    return () => { active = false }
  }, [sourceID, actions, retryID])

  const save = async () => {
    if (!canSave || !settings) return
    setBusy(true)
    setError('')
    try {
      const updated = await actions.setMode(sourceID, settings.revision, mode)
      if (updated.source_id !== sourceID || updated.sync_mode !== mode ||
        !Number.isSafeInteger(updated.revision) || updated.revision <= settings.revision) {
        throw new Error('Server 返回的同步文件夹策略或版本不一致')
      }
      onFinished('已更新本机备份策略；旧 Mirror 删除证据已重新归零，真实上传与删除仍未启用')
    } catch (failure) {
      setError('更新备份策略失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setBusy(false)
    }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => { if (!busy) onClose() }}>
      <DialogTitle>本机同步文件夹 · 备份策略</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            这里只修改已绑定、已暂停的本机 Source 配置，不会启动上传、同步或删除，也不会更换本地 Root。
          </Alert>
          {loading ? <Typography variant="body2">正在验证本机 Root 授权…</Typography> : null}
          <RadioGroup value={mode} onChange={(event) => {
            if (event.target.value === 'backup' || event.target.value === 'mirror') {
              setMode(event.target.value)
              setMirrorConfirmed(false)
            }
          }}>
            <FormControlLabel disabled={loading || busy || !settings} value="backup"
              control={<Radio />} label="Backup：本地文件消失时不删除云端备份" />
            <FormControlLabel disabled={loading || busy || !settings} value="mirror"
              control={<Radio />} label="Mirror：仅在未来执行器上线后可能按安全规则镜像清理" />
          </RadioGroup>
          {mode === 'mirror' ? (
            <>
              <Alert severity="warning">
                Mirror 未来只允许在两轮可靠完整扫描、至少 24 小时宽限后将缺失文件移到云端回收站；
                Root 无法访问、扫描不完整或设备撤销都不能推断删除。目前执行器未启用。
              </Alert>
              <FormControlLabel control={<Checkbox checked={mirrorConfirmed}
                onChange={(event) => setMirrorConfirmed(event.target.checked)} />}
                disabled={busy || loading || !settings}
                label="我明确同意未来按上述安全规则执行 Mirror，且理解本次只保存配置" />
            </>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetryID((n) => n + 1)}>重新读取配置</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => void save()}>
          {busy ? '保存中…' : '保存策略'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
