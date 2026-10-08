import { useState } from 'react'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ShareRoundedIcon from '@mui/icons-material/ShareRounded'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import {
  XDriveFilePropertiesDialog,
  XDriveShareDialog,
} from '@xdrive/ui/mui'
import type { XDriveShareDialogAdapter } from '@xdrive/ui/mui'
import { formatBytes } from '../../ui/shared/src'
import type { Node } from '../../ui/shared/src'
import type { XDriveApi } from './api'

function fileType(node: Node) {
  const dot = node.name.lastIndexOf('.')
  return dot > 0 && dot < node.name.length - 1
    ? node.name.slice(dot + 1).toUpperCase()
    : '文件'
}

export default function WebUnsupportedFileDialog({
  node,
  api,
  shareDialogAdapter,
  onClose,
  onError,
}: {
  node: Node | null
  api: XDriveApi
  shareDialogAdapter: XDriveShareDialogAdapter
  onClose: () => void
  onError: (error: unknown) => void
}) {
  const [shareOpen, setShareOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)

  return (
    <>
      <Dialog
        open={Boolean(node)}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        aria-label="无可用的 Web 打开程序"
      >
        <DialogTitle>无可用的 Web 打开程序</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            <Typography variant="body1" fontWeight={600}>
              {node?.name ?? ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              当前版本尚未为此文件类型注册 Web 程序。文件不会被自动下载。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>关闭</Button>
          <Button
            startIcon={<InfoOutlinedIcon />}
            disabled={!node}
            onClick={() => setPropertiesOpen(true)}
          >
            属性
          </Button>
          <Button
            startIcon={<ShareRoundedIcon />}
            disabled={!node}
            onClick={() => setShareOpen(true)}
          >
            分享
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadRoundedIcon />}
            disabled={!node}
            onClick={() => {
              if (!node) return
              void api.download(node).catch(onError)
            }}
          >
            下载
          </Button>
        </DialogActions>
      </Dialog>

      <XDriveShareDialog
        adapter={shareDialogAdapter}
        node={shareOpen ? node : null}
        onClose={() => setShareOpen(false)}
        onError={onError}
        expiryMode="datetime"
        listVariant="table"
      />

      <XDriveFilePropertiesDialog
        open={propertiesOpen && Boolean(node)}
        title={node?.name ?? ''}
        properties={node ? [
          { label: '名称', value: node.name },
          { label: '类型', value: fileType(node) },
          { label: '大小', value: formatBytes(node.size) },
          { label: '修改时间', value: new Date(node.updated_at).toLocaleString() },
          { label: '创建时间', value: new Date(node.created_at).toLocaleString() },
          { label: '节点 ID', value: String(node.id), section: 'technical' as const },
          { label: '修订', value: String(node.revision), section: 'technical' as const },
        ] : []}
        onClose={() => setPropertiesOpen(false)}
      />
    </>
  )
}
