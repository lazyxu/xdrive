import { useEffect, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField, Typography,
} from '@mui/material'

// Only the owning Desktop can provide these capabilities. The Server
// verifies the enrolled device and provisions an exclusive cloud target.
// targetNodeID remains in the Agent port for older implementations but new
// Local Push sources always supply 0; no ordinary cloud folder is selected.
export interface XDriveLocalBackupCreateActions {
  create(name: string, targetNodeID: number): Promise<{ id: number; revision: number }>
  authorize(sourceID: number): Promise<{ cancelled: boolean }>
  discard(sourceID: number, revision: number): Promise<unknown>
}

type LocalDraft = { id: number; revision: number }

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/valid source configuration is required/i.test(message)) {
    return 'Server 拒绝当前本机 Push 来源配置。这通常说明 Server 与 Desktop/Agent 的来源创建协议不兼容，' +
      '请核对并同步更新支持 Server 自动创建受管目标的版本；不能通过手选普通云端目录绕过。' +
      '若请求结果不明确，请先刷新「本机待完成授权」检查是否已有草稿。原始错误：' + message
  }
  return message
}

export function XDriveDeviceBackupLocalCreateDialog({
  open, actions, onClose, onFinished,
}: {
  open: boolean
  actions: XDriveLocalBackupCreateActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<LocalDraft | null>(null)
  const normalizedName = name.trim()
  const validName = normalizedName.length > 0 &&
    new TextEncoder().encode(normalizedName).length <= 128

  useEffect(() => {
    if (!open) return
    setName('')
    setDraft(null)
    setError('')
  }, [open])

  const authorize = async (current: LocalDraft) => {
    try {
      const grant = await actions.authorize(current.id)
      if (grant.cancelled) {
        await actions.discard(current.id, current.revision)
        setDraft(null)
        onFinished('用户已取消选择本机目录；未绑定的 Source 和专属空云端目录已安全清理')
        onClose()
        return
      }
      setDraft(null)
      onFinished('本机目录已授权；云端专属目标由 Server 自动创建，备份执行器尚未启用')
      onClose()
    } catch (failure) {
      // A timed-out native grant may have committed a Root binding. Never
      // assume the draft is empty or implicitly remove its cloud directory.
      setError('本机目录授权或草稿清理未完成：' + safeMessage(failure) +
        '。来源保持安全状态；可重试授权或尝试安全清理。')
    }
  }

  const submit = async () => {
    if (busy) return
    if (!draft && !validName) {
      setError('请输入不超过 128 字节的同步文件夹名称。')
      return
    }
    setBusy(true)
    setError('')
    try {
      let current = draft
      if (!current) {
        // Creating a new Source cannot claim a caller-chosen ordinary cloud
        // directory. The authenticated Server derives this from the device.
        current = await actions.create(normalizedName, 0)
        setDraft(current)
      }
      await authorize(current)
    } catch (failure) {
      setError('本机备份草稿创建失败：' + safeMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    if (!draft || busy) return
    setBusy(true)
    setError('')
    try {
      await actions.discard(draft.id, draft.revision)
      setDraft(null)
      onFinished('本机未绑定的备份草稿及可安全清理的专属空目录已删除')
      onClose()
    } catch (failure) {
      // Bound Sources, directly shared roots, and historical records are
      // protected by the Server's transaction-level cleanup checks.
      setError('无法安全清理草稿：' + safeMessage(failure) +
        '。不会删除已有文件、分享或本机 Root 授权。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return
        if (draft) {
          setError('仍有暂停草稿。可以重新授权、尝试清理，或明确选择“保留草稿并关闭”。')
          return
        }
        onClose()
      }}
      fullWidth maxWidth="sm"
    >
      <DialogTitle>新增本机同步文件夹</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            仅为当前 Desktop 创建备份来源。云端目标由 Server 根据已验证的设备身份自动创建；
            本机 Root 须由原生选择器单独授权，当前不会自动扫描、上传或删除文件。
          </Alert>
          <TextField
            label="同步文件夹名称"
            value={name}
            disabled={busy || Boolean(draft)}
            onChange={(event) => setName(event.target.value)}
            error={name.length > 0 && !validName}
            helperText="最多 128 字节"
            fullWidth size="small"
          />
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            云端目标由 Server 根据已验证的设备与 Source 自动创建；实际目录路径以 Server 返回的受管目标为准。
          </Typography>
          {draft ? (
            <Alert severity="warning">
              已创建暂停草稿 #{draft.id}，尚未确认完成本机 Root 授权。
              重试不会重新创建 Source；只有仍未绑定、无文件且没有分享时才能清理专属空目录。
            </Alert>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap' }}>
        <Button disabled={busy} onClick={onClose}>
          {draft ? '保留草稿并关闭' : '取消'}
        </Button>
        {draft ? (
          <Button color="warning" disabled={busy} onClick={() => void discard()}>安全清理草稿</Button>
        ) : null}
        <Button variant="contained" disabled={busy || (!draft && !validName)}
          onClick={() => void submit()}>
          {busy ? '正在处理…' : draft ? '重试本机目录授权' : '创建并选择本机目录'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
