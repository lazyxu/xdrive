import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, List, ListItemButton, Stack, Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import type { XDriveLocalBoundBackupSettings } from '../device-backups'
import type { XDriveSourceTargetBrowser, XDriveSourceTargetNode } from './SourceManager'

export interface XDriveLocalBackupTargetActions {
  load(sourceID: number): Promise<XDriveLocalBoundBackupSettings>
  retarget(sourceID: number, revision: number, targetNodeID: number): Promise<XDriveLocalBoundBackupSettings>
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

// This chooser is only mounted for a credential-verified owning Desktop row.
// The Server validates target Node ownership/directory type and the Agent
// validates Root/device proof on every save. No cloud bytes are moved here.
export function XDriveDeviceBackupLocalTargetDialog({
  sourceID, actions, targetBrowser, onClose, onFinished,
}: {
  sourceID: number
  actions: XDriveLocalBackupTargetActions
  targetBrowser: XDriveSourceTargetBrowser
  onClose(): void
  onFinished(message: string): void
}) {
  const [settings, setSettings] = useState<XDriveLocalBoundBackupSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [trail, setTrail] = useState<XDriveSourceTargetNode[]>([])
  const [children, setChildren] = useState<XDriveSourceTargetNode[]>([])
  const [browsing, setBrowsing] = useState(true)
  const requestID = useRef(0)
  const target = trail[trail.length - 1]

  const browse = useCallback(async (nextTrail: XDriveSourceTargetNode[]) => {
    const current = nextTrail[nextTrail.length - 1]
    if (!current || !Number.isSafeInteger(current.id) || current.id <= 0) return
    const request = ++requestID.current
    setBrowsing(true)
    setError('')
    try {
      const directories = await targetBrowser.children(current.id)
      if (request !== requestID.current) return
      setTrail(nextTrail)
      setChildren(directories.filter((node) => Number.isSafeInteger(node.id) && node.id > 0))
    } catch (failure) {
      if (request === requestID.current) setError('无法读取云端目录：' + errorMessage(failure))
    } finally {
      if (request === requestID.current) setBrowsing(false)
    }
  }, [targetBrowser])

  useEffect(() => {
    let active = true
    setSettings(null)
    setLoading(true)
    setError('')
    void actions.load(sourceID).then((value) => {
      if (!active) return
      if (value.source_id !== sourceID || !Number.isSafeInteger(value.revision) || value.revision <= 0) {
        throw new Error('本机同步文件夹身份或版本不匹配')
      }
      setSettings(value)
      setLoading(false)
    }).catch((failure) => {
      if (active) {
        setError('读取本机设置失败：' + errorMessage(failure))
        setLoading(false)
      }
    })
    setBrowsing(true)
    void targetBrowser.root().then((root) => {
      if (active) void browse([root])
    }).catch((failure) => {
      if (active) {
        setError('云端目录不可用：' + errorMessage(failure))
        setBrowsing(false)
      }
    })
    return () => { active = false; ++requestID.current }
  }, [actions, sourceID, targetBrowser, browse])

  const save = async () => {
    if (busy || loading || browsing || !settings || !target ||
      !Number.isSafeInteger(target.id) || target.id <= 0 ||
      target.id === settings.target_node_id) return
    setBusy(true)
    setError('')
    try {
      const updated = await actions.retarget(sourceID, settings.revision, target.id)
      if (updated.source_id !== sourceID || updated.target_node_id !== target.id) {
        throw new Error('Server 返回的目标或同步文件夹身份不一致')
      }
      onFinished('已修改本机备份云端目标；不会移动或删除原有云端文件，实际上传仍未启用')
    } catch (failure) {
      setError('修改云端目标失败：' + errorMessage(failure))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={() => { if (!busy) onClose() }} fullWidth maxWidth="sm">
      <DialogTitle>修改本机备份云端目标</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            仅修改这台设备已绑定同步文件夹的后续备份目标。不会移动、覆盖或删除原云端文件，也不会启动同步。
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            当前目标：{loading ? '正在读取…' : settings?.target_path || '尚未配置'}
          </Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
            <Typography variant="subtitle2">选择新目标目录</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {target ? trail.map((node) => node.name || '我的文件').join(' / ') : '正在加载目录…'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" startIcon={<ArrowBackRoundedIcon />}
                disabled={busy || browsing || trail.length < 2}
                onClick={() => void browse(trail.slice(0, -1))}>上一级</Button>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                {browsing ? '正在加载…' : '当前目录可作为目标，也可进入子目录'}
              </Typography>
            </Stack>
            <List dense sx={{ maxHeight: 200, overflowY: 'auto' }}>
              {children.map((folder) => (
                <ListItemButton key={folder.id} disabled={busy || browsing}
                  onClick={() => void browse([...trail, folder])}>
                  <FolderRoundedIcon color="action" fontSize="small" sx={{ mr: 1 }} />
                  <Typography variant="body2">{folder.name}</Typography>
                </ListItemButton>
              ))}
            </List>
          </Box>
          {error ? <Alert severity="warning">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={busy || loading || browsing || !settings || !target ||
          target.id === settings.target_node_id}
          onClick={() => void save()}>{busy ? '保存中…' : '确认新目标'}</Button>
      </DialogActions>
    </Dialog>
  )
}
