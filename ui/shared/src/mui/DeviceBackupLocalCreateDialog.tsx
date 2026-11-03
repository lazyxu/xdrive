import { useEffect, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField,
} from '@mui/material'
import type { XDriveSourceTargetBrowser } from './SourceManager'

// Only the owning Desktop Agent can create and bind this Source. The cloud
// destination is allocated server-side; no caller-selected target is trusted.
export interface XDriveLocalBackupCreateActions {
  create(name: string, targetNodeID: number): Promise<{ id: number; revision: number }>
  authorize(sourceID: number): Promise<{ cancelled: boolean }>
  discard(sourceID: number, revision: number): Promise<unknown>
}

type LocalDraft = { id: number; revision: number }

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function XDriveDeviceBackupLocalCreateDialog({
  open, actions, onClose, onFinished,
}: {
  open: boolean
  /** Retained for old callers. New Source creation NEVER browses the cloud target. */
  targetBrowser: XDriveSourceTargetBrowser
  actions: XDriveLocalBackupCreateActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<LocalDraft | null>(null)
  const [error, setError] = useState('')
  const validName = name.trim().length > 0 && new TextEncoder().encode(name.trim()).length <= 128

  useEffect(() => {
    if (!open) return
    setName('')
    setBusy(false)
    setDraft(null)
    setError('')
  }, [open])

  const authorize = async (current: LocalDraft) => {
    try {
      const grant = await actions.authorize(current.id)
      if (grant.cancelled) {
        await actions.discard(current.id, current.revision)
        setDraft(null)
        onFinished('用户已取消选择本机目录；未绑定的备份草稿已安全清理')
        onClose()
        return
      }
      setDraft(null)
      onFinished('本机目录已授权；云端目标由服务器自动创建，备份执行状态以实际任务为准')
      onClose()
    } catch (failure) {
      // An uncertain Root-binding acknowledgement cannot justify deletion.
      setError('本机目录授权或草稿清理未完成：' + safeMessage(failure) +
        '。保留暂停草稿，可重试授权或尝试安全清理。')
    }
  }

  const submit = async () => {
    if (busy || (!draft && !validName)) return
    setBusy(true)
    setError('')
    try {
      let current = draft
      if (!current) {
        // The new Server API accepts target_node_id=0 with auto_target=true.
        // The first argument is the Source name, not an arbitrary OS path.
        current = await actions.create(name.trim(), 0)
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
      onFinished('本机未绑定的备份草稿已安全清理')
      onClose()
    } catch (failure) {
      setError('无法安全清理草稿：' + safeMessage(failure) +
        '。不会删除已有 Root 或云端数据。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => {
      if (busy) return
      if (draft) {
        setError('仍有暂停草稿。请明确保留草稿并关闭，或尝试安全清理。')
        return
      }
      onClose()
    }} fullWidth maxWidth="sm">
      <DialogTitle>新增本机同步文件夹</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            云端目标由 xDrive Server 在“同步文件夹/设备备份”下自动创建专属目录。
            这里只选择和授权本机来源，不会把已有普通云端目录变为同步目标。
          </Alert>
          <TextField label="同步文件夹名称"
            value={name} disabled={busy || Boolean(draft)}
            onChange={event => setName(event.target.value)}
            error={name.length > 0 && !validName}
            helperText="最多 128 字节" fullWidth size="small" />
          {draft ? (
            <Alert severity="warning">
              已创建暂停草稿 #{draft.id}，尚未确认完成本机 Root 授权。
              重试不会创建第二个 Source；只有尚未绑定且没有历史的草稿才可安全清理。
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
          <Button color="warning" disabled={busy} onClick={() => void discard()}>
            安全清理草稿
          </Button>
        ) : null}
        <Button variant="contained" disabled={busy || (!draft && !validName)}
          onClick={() => void submit()}>
          {busy ? '正在处理…' : draft ? '重试本机目录授权' : '创建并选择本机目录'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
