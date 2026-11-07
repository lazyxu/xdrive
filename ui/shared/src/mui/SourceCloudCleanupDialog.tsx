import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContentText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveStatusAlert } from './StatusAlert'
import type { ExternalSourceCloudCleanupPreview } from '../external-sources'

// Source cleanup is intentionally not ordinary Source delete. The Server
// independently validates the entire archived, unmanaged-by-Files subtree
// again in a transaction. This form never accepts an arbitrary NodeID.
export function XDriveSourceCloudCleanupDialog({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: ExternalSourceCloudCleanupPreview | null
  busy: boolean
  onClose: () => void
  onConfirm: (confirmedName: string) => void | Promise<void>
}) {
  const [confirmation, setConfirmation] = useState('')
  useEffect(() => {
    setConfirmation('')
  }, [preview?.source_id, preview?.source_revision, preview?.preview_digest])

  const eligible = Boolean(preview?.reversible && confirmation === preview.source_name)
  return (
    <Dialog open={Boolean(preview)} onClose={() => { if (!busy) onClose() }}
      maxWidth="sm" fullWidth slotProps={{ paper: xDriveDialogPaperProps }}>
      <XDriveDialogTitle title="独立清理云端文件？" onClose={onClose} closeDisabled={busy} />
      <XDriveDialogContent>
        <Stack spacing={2}>
          <XDriveStatusAlert tone="warning">
            此操作与归档来源完全分离。只会把当前已归档 Source 的受管目标文件夹移入可恢复的回收站，
            不会删除设备或远端的原件，不会删 Source、同步历史、版本或 CAS。
            目标、版本、权限及未完成上传会在提交时重新检查。
          </XDriveStatusAlert>
          <DialogContentText>
            来源：{preview?.source_name ?? '—'}
            {' · '}文件夹节点：{preview?.target_node_id ?? '—'}
          </DialogContentText>
          <Typography variant="body2">
            预览项目：{preview?.node_count ?? 0} 个节点，含 {preview?.file_count ?? 0} 个文件。
            如有活跃共享、其他来源依赖或未完成写入，服务端将拒绝清理。
          </Typography>
          <Typography variant="caption" color="text.secondary">
            完成后可在“回收站”手动恢复；原 Source 保持已归档。为保护 Source 历史，不允许通过普通永久删除移除仍绑定该 Source 的目标。
          </Typography>
          <TextField label="输入完整来源名称确认清理"
            size="small" fullWidth value={confirmation} disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off" />
        </Stack>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton disabled={busy} onClick={onClose}>取消</XDriveActionButton>
        <XDriveActionButton intent="danger" disabled={!eligible || busy}
          loading={busy} loadingLabel="正在重新校验并移入回收站…"
          onClick={() => onConfirm(confirmation)}>
          确认移入回收站
        </XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
