import { useEffect, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField, Typography,
} from '@mui/material'
import type { XDriveLocalBoundBackupRules } from '../device-backups'

// This private capability exists ONLY for the credential-verified owning
// Desktop. Web/Mobile and other desktops never receive raw ignore rules.
export interface XDriveLocalBackupRulesActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupRules>
  update(sourceID: number, revision: number, rules: string): Promise<XDriveLocalBoundBackupRules>
}

export function XDriveDeviceBackupLocalRulesDialog({
  sourceID, actions, onClose, onFinished,
}: {
  sourceID: number
  actions: XDriveLocalBackupRulesActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [loaded, setLoaded] = useState<XDriveLocalBoundBackupRules | null>(null)
  const [rules, setRules] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryID, setRetryID] = useState(0)
  const bytes = new TextEncoder().encode(rules).length
  const lines = rules.split(/\r\n|\r|\n/).length
  const valid = bytes <= 64 * 1024 && lines <= 4096
  const canSave = !loading && !busy && loaded !== null && valid && rules !== loaded.ignore_rules

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoaded(null)
    setRules('')
    setError('')
    void actions.load(sourceID).then((value) => {
      if (!active) return
      if (value.source_id !== sourceID || !Number.isSafeInteger(value.revision) ||
        value.revision <= 0 || typeof value.ignore_rules !== 'string') {
        throw new Error('本机规则配置与 Source 身份或版本不匹配')
      }
      setLoaded(value)
      setRules(value.ignore_rules)
      setLoading(false)
    }).catch((failure) => {
      if (active) {
        setLoading(false)
        setError('读取本机规则失败：' + (failure instanceof Error ? failure.message : String(failure)))
      }
    })
    return () => { active = false }
  }, [sourceID, actions, retryID])

  const save = async () => {
    if (!canSave || !loaded) return
    setBusy(true)
    setError('')
    try {
      const updated = await actions.update(sourceID, loaded.revision, rules)
      if (updated.source_id !== sourceID || updated.ignore_rules !== rules ||
        !Number.isSafeInteger(updated.revision) || updated.revision <= loaded.revision) {
        throw new Error('Server 返回的规则或 Source 版本不一致')
      }
      onFinished('已保存本机忽略规则；旧 Mirror 缺失证据已清零。备份执行器尚未启用')
    } catch (failure) {
      setError('保存规则失败：' + (failure instanceof Error ? failure.message : String(failure)))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="sm">
      <DialogTitle>本机同步文件夹 · 忽略规则</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            规则只由已授权的本机 Agent 读取和保存。每行一个模式，支持 * 和 **、目录后缀 /、# 注释及 ! 排除反转。
            保存不会触发扫描、上传或删除。修改规则将重置 Mirror 缺失判断证据。
          </Alert>
          <TextField label="忽略规则" value={rules} onChange={(event) => setRules(event.target.value)}
            size="small" fullWidth multiline minRows={8} maxRows={14}
            disabled={loading || busy || !loaded} error={!valid}
            placeholder={'*.tmp\n.cache/\n!important.tmp'}
            helperText={loading ? '正在验证本机设备凭据与 Root 授权…' : bytes + ' / 65536 字节，' + lines + ' / 4096 行；保存时由 Server 校验语法'} />
          <Typography variant="caption" color="text.secondary">
            当前仅保存配置，L05/L06 启用执行器前不会自动生效为后台同步。
          </Typography>
          {error ? <Alert severity="warning">{error}</Alert> : null}
          {error && !busy ? <Button size="small" onClick={() => setRetryID((n) => n + 1)}>重新读取规则</Button> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => void save()}>
          {busy ? '保存中…' : '保存忽略规则'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
