import { useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, TextField, Typography,
} from '@mui/material'
import type { XDriveSourceTargetBrowser } from './SourceManager'

// Only the owning Desktop may create a native Push Source and approve a
// local Root. The cloud target is exclusively allocated by Server/SourceID.
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
  open, targetBrowser: _targetBrowser, actions, onClose, onFinished,
}: {
  open: boolean
  /** Kept for host API compatibility; selecting a target is no longer allowed. */
  targetBrowser: XDriveSourceTargetBrowser
  actions: XDriveLocalBackupCreateActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<LocalDraft | null>(null)
  const validName = name.trim().length > 0 && new TextEncoder().encode(name.trim()).length <= 128

  const close = () => {
    setName('')
    setError('')
    setDraft(null)
    onClose()
  }

  const authorize = async (current: LocalDraft) => {
    try {
      const grant = await actions.authorize(current.id)
      if (grant.cancelled) {
        await actions.discard(current.id, current.revision)
        setDraft(null)
        onFinished('用户取消授权；仅空的本机备份草稿已安全清理')
        close()
        return
      }
      setDraft(null)
      onFinished('本机目录已授权；云端专属目标由服务器自动创建')
      close()
    } catch (failure) {
      // An uncertain response may have committed a Root binding; do not
      // delete the draft or allow another device to claim that Root.
      setError('授权结果未确认：' + safeMessage(failure) + '。可重试或保留草稿。')
    }
  }

  const submit = async () => {
    if (busy || (!draft && !validName)) {
      if (!draft) setError('请输入不超过 128 字节的名称。')
      return
    }
    setBusy(true)
    setError('')
    try {
      let current = draft
      if (!current) {
        // Zero means Server allocates a stable exclusive Source target.
        current = await actions.create(name.trim(), 0)
        setDraft(current)
      }
      await authorize(current)
    } catch (failure) {
      setError('创建本机备份失败：' + safeMessage(failure))
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
      onFinished('未绑定、无历史的草稿已清理；没有删除云端文件')
      close()
    } catch (failure) {
      setError('无法安全清理草稿：' + safeMessage(failure) + '。草稿及 Root 状态均保留。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => {
      if (busy) return
      if (draft) {
        setError('仍有未确认的草稿，须选择保留、重试或安全清理。')
      } else {
        close()
      }
    }} fullWidth maxWidth="sm">
      <DialogTitle>新增本机同步文件夹</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            只为当前 Desktop 注册设备备份。云端目标由服务器在“同步文件夹 / 设备备份”下分配专属只读目录；下一步仅授权本机文件夹，不立即上传或推断删除。
          </Alert>
          <TextField
            label="同步文件夹名称"
            value={name}
            disabled={busy || Boolean(draft)}
            onChange={(event) => setName(event.target.value)}
            error={name.length > 0 && !validName}
            helperText="最多 128 字节；修改显示名称不会改变已绑定云端路径"
            fullWidth size="small"
          />
          <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
            <Typography variant="subtitle2">云端目标</Typography>
            <Typography variant="body2" color="text.secondary">
              系统自动创建。每个 Source 独占整个目标目录，不允许普通上传、移动、覆盖或删除。
            </Typography>
          </Box>
          {draft ? (
            <Alert severity="warning">
              已创建暂停草稿 #{draft.id}，本机 Root 授权尚未确认。可以重试；仅无绑定、无历史的草稿允许安全清理。
            </Alert>
          ) : null}
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap' }}>
        <Button disabled={busy} onClick={() => {
          if (draft) {
            setDraft(null)
            onClose()
          } else {
            close()
          }
        }}>{draft ? '保留草稿并关闭' : '取消'}</Button>
        {draft ? (
          <Button color="warning" disabled={busy} onClick={() => { void discard() }}>
            安全清理草稿
          </Button>
        ) : null}
        <Button variant="contained" disabled={busy || (!draft && !validName)} onClick={() => { void submit() }}>
          {busy ? '正在处理…' : draft ? '重试本机目录授权' : '创建并选择本机目录'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
