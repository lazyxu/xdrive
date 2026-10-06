import { useCallback, useEffect, useState } from 'react'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import {
  Dialog,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { Node } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveStatePanel } from './StatePanel'
import { XDriveTableSurface } from './TableSurface'

export interface XDriveTrashDialogAdapter {
  listTrash(): Promise<Node[]>
  restoreTrash(node: Node): Promise<Node | void>
  deleteTrash(node: Node): Promise<unknown>
}

export function XDriveTrashDialog({
  open,
  adapter,
  onClose,
  onError,
  onFeedback,
  onChanged,
}: {
  open: boolean
  adapter: XDriveTrashDialogAdapter
  onClose: () => void
  onError: (error: unknown) => void
  onFeedback?: (message: string) => void
  onChanged?: () => void | Promise<void>
}) {
  const [items, setItems] = useState<Node[]>([])
  const [loading, setLoading] = useState(false)
  const [workingKey, setWorkingKey] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Node | null>(null)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      setItems(await adapter.listTrash())
    } catch (error) {
      onError(error)
    } finally {
      setLoading(false)
    }
  }, [adapter, onError, open])

  useEffect(() => {
    if (open) void load()
  }, [load, open])

  const restore = async (node: Node) => {
    const key = `restore:${node.id}`
    setWorkingKey(key)
    try {
      await adapter.restoreTrash(node)
      onFeedback?.('项目已恢复')
      await load()
      await onChanged?.()
    } catch (error) {
      onError(error)
    } finally {
      setWorkingKey('')
    }
  }

  const permanentlyDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    const key = `delete:${target.id}`
    setWorkingKey(key)
    try {
      await adapter.deleteTrash(target)
      setDeleteTarget(null)
      onFeedback?.('已永久删除')
      await load()
      await onChanged?.()
    } catch (error) {
      onError(error)
    } finally {
      setWorkingKey('')
    }
  }

  const busy = Boolean(workingKey)

  return (
    <>
      <Dialog
        open={open}
        onClose={() => { if (!busy) onClose() }}
        maxWidth="md"
        fullWidth
        scroll="paper"
        aria-label="回收站"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title="回收站"
          subtitle={loading && items.length === 0 ? '正在加载…' : `${items.length} 个项目`}
          onClose={onClose}
          closeDisabled={busy}
        />
        <XDriveDialogContent dividers>
          {loading && items.length === 0 ? (
            <XDriveStatePanel variant="plain" loading message="正在加载回收站…" />
          ) : items.length === 0 ? (
            <XDriveStatePanel variant="plain" message="回收站为空" />
          ) : (
            <XDriveTableSurface>
              <Table size="small" aria-label="回收站">
                <TableHead>
                  <TableRow>
                    <TableCell>名称</TableCell>
                    <TableCell sx={{ width: 120 }}>大小</TableCell>
                    <TableCell sx={{ width: 190 }}>删除时间</TableCell>
                    <TableCell align="right" sx={{ width: 230 }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((node) => (
                    <TableRow key={node.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {node.type === 'dir'
                            ? <FolderOpenRoundedIcon fontSize="small" />
                            : <InsertDriveFileRoundedIcon fontSize="small" />}
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{node.name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>{node.type === 'dir' ? '—' : formatBytes(node.size)}</TableCell>
                      <TableCell>{node.deleted_at ? new Date(node.deleted_at).toLocaleString() : '—'}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <XDriveActionButton
                            compact
                            loading={workingKey === `restore:${node.id}`}
                            loadingLabel="正在恢复…"
                            disabled={busy && workingKey !== `restore:${node.id}`}
                            onClick={() => void restore(node)}
                          >
                            恢复
                          </XDriveActionButton>
                          <XDriveActionButton
                            compact
                            intent="danger"
                            disabled={busy}
                            onClick={() => setDeleteTarget(node)}
                          >
                            永久删除
                          </XDriveActionButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </XDriveTableSurface>
          )}
        </XDriveDialogContent>
        <XDriveDialogActions>
          <XDriveActionButton disabled={busy} onClick={onClose}>关闭</XDriveActionButton>
        </XDriveDialogActions>
      </Dialog>

      <XDriveConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `永久删除 ${deleteTarget.name}？` : '永久删除项目？'}
        description="该项目、当前内容以及所有已保存的历史版本都将被永久删除，且无法撤销。"
        confirmLabel="永久删除"
        confirmIntent="danger"
        loading={Boolean(deleteTarget && workingKey === `delete:${deleteTarget.id}`)}
        loadingLabel="正在永久删除…"
        onCancel={() => { if (!busy) setDeleteTarget(null) }}
        onConfirm={() => void permanentlyDelete()}
      />
    </>
  )
}
