import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, List, ListItemButton, Stack, TextField, Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import type { XDriveSourceTargetBrowser, XDriveSourceTargetNode } from './SourceManager'

// This capability is supplied only by the owning Desktop. Web/Mobile Web
// never receive it, and the Server verifies Agent device/Root identity.
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
  open, targetBrowser, actions, onClose, onFinished,
}: {
  open: boolean
  targetBrowser: XDriveSourceTargetBrowser
  actions: XDriveLocalBackupCreateActions
  onClose(): void
  onFinished(message: string): void
}) {
  const [name, setName] = useState('')
  const [trail, setTrail] = useState<XDriveSourceTargetNode[]>([])
  const [directories, setDirectories] = useState<XDriveSourceTargetNode[]>([])
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<LocalDraft | null>(null)
  const requestID = useRef(0)
  const target = trail[trail.length - 1]
  const validName = name.trim().length > 0 && new TextEncoder().encode(name.trim()).length <= 128

  const browse = useCallback(async (nextTrail: XDriveSourceTargetNode[]) => {
    const current = nextTrail[nextTrail.length - 1]
    if (!current || !Number.isSafeInteger(current.id) || current.id <= 0) return
    const request = ++requestID.current
    setBrowsing(true)
    setError('')
    try {
      const items = await targetBrowser.children(current.id)
      if (request !== requestID.current) return
      setTrail(nextTrail)
      setDirectories(items.filter((node) => Number.isSafeInteger(node.id) && node.id > 0))
    } catch (failure) {
      if (request === requestID.current) {
        setError('无法读取云端目标目录：' + safeMessage(failure))
      }
    } finally {
      if (request === requestID.current) setBrowsing(false)
    }
  }, [targetBrowser])

  useEffect(() => {
    if (!open) {
      ++requestID.current
      return
    }
    let active = true
    setName('')
    setTrail([])
    setDirectories([])
    setDraft(null)
    setError('')
    setBrowsing(true)
    void targetBrowser.root().then((root) => {
      if (active) void browse([root])
    }).catch((failure) => {
      if (active) {
        setError('无法加载云端根目录：' + safeMessage(failure))
        setBrowsing(false)
      }
    })
    return () => {
      active = false
      ++requestID.current
    }
  }, [open, targetBrowser, browse])

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
      onFinished('本机目录已授权；真正的备份上传执行器尚未启用')
      onClose()
    } catch (failure) {
      // A timed-out authorization may have committed a Root binding.
      // Never assume the draft is empty or silently drop its reference.
      setError('本机目录授权或草稿清理未完成：' + safeMessage(failure) +
        '。同步文件夹仍保持安全状态；可重试授权或尝试安全清理。')
    }
  }

  const submit = async () => {
    if (busy || browsing) return
    if (!draft && (!validName || !target)) {
      setError('请输入不超过 128 字节的名称，并选择有效的云端目标目录。')
      return
    }
    setBusy(true)
    setError('')
    try {
      let current = draft
      if (!current) {
        current = await actions.create(name.trim(), target!.id)
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
      // Bound Sources and historical records are protected by the Server.
      setError('无法安全清理草稿：' + safeMessage(failure) + '。不会删除已有 Root 或云端数据。')
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
            只为当前 Desktop 添加备份，不允许控制其他设备。当前仅建立目录授权，不会上传、同步或推断删除文件。
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
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
            <Typography variant="subtitle2">云端目标目录</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {target ? trail.map((node) => node.name || '我的文件').join(' / ') : '正在加载云端目录…'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" startIcon={<ArrowBackRoundedIcon />}
                disabled={busy || Boolean(draft) || browsing || trail.length < 2}
                onClick={() => void browse(trail.slice(0, -1))}>
                上一级
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                {browsing ? '正在加载…' : '选中当前目录作为目标，或进入子目录'}
              </Typography>
            </Stack>
            <List dense sx={{ maxHeight: 184, overflowY: 'auto' }}>
              {directories.map((folder) => (
                <ListItemButton key={folder.id} disabled={busy || Boolean(draft) || browsing}
                  onClick={() => void browse([...trail, folder])}>
                  <FolderRoundedIcon color="action" fontSize="small" sx={{ mr: 1 }} />
                  <Typography variant="body2">{folder.name}</Typography>
                </ListItemButton>
              ))}
            </List>
          </Box>
          {draft ? (
            <Alert severity="warning">
              已创建暂停草稿 #{draft.id}，尚未确认完成本机 Root 授权。
              重试不会重新创建 Source；安全清理仅在仍未绑定且没有历史时才允许。
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
        <Button variant="contained"
          disabled={busy || browsing || (!draft && (!validName || !target))}
          onClick={() => void submit()}>
          {busy ? '正在处理…' : draft ? '重试本机目录授权' : '创建并选择本机目录'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
