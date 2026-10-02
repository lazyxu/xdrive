import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material'
import type { FileVersion, Node } from '../models'
import { formatSize } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveStatePanel } from './StatePanel'
import { XDriveTableSurface } from './TableSurface'

export interface XDriveVersionHistoryDialogAdapter {
  listVersions(nodeID: number): Promise<FileVersion[]>
  restoreVersion(node: Node, version: FileVersion): Promise<Node>
  downloadVersion?: (node: Node, version: FileVersion) => Promise<void>
}

export function XDriveVersionHistoryDialog({
  node,
  adapter,
  onClose,
  onError,
  onFeedback,
  onRestored,
}: {
  node: Node | null
  adapter: XDriveVersionHistoryDialogAdapter
  onClose: () => void
  onError: (error: unknown) => void
  onFeedback?: (message: string) => void
  onRestored?: (node: Node) => void | Promise<void>
}) {
  const [currentNode, setCurrentNode] = useState<Node | null>(node)
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [workingKey, setWorkingKey] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<FileVersion | null>(null)

  const load = useCallback(async (nodeID: number) => {
    setLoading(true)
    try {
      setVersions(await adapter.listVersions(nodeID))
    } catch (error) {
      onError(error)
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [adapter, onError])

  useEffect(() => {
    setCurrentNode(node)
    setRestoreTarget(null)
    if (node) {
      void load(node.id)
    } else {
      setVersions([])
    }
  }, [load, node?.id, node?.revision])

  const restore = async () => {
    if (!currentNode || !restoreTarget) return
    const target = restoreTarget
    const key = `restore:${target.id}`
    setWorkingKey(key)
    try {
      const restored = await adapter.restoreVersion(currentNode, target)
      setCurrentNode(restored)
      setRestoreTarget(null)
      onFeedback?.('版本已恢复')
      await load(restored.id)
      await onRestored?.(restored)
    } catch (error) {
      onError(error)
    } finally {
      setWorkingKey('')
    }
  }

  const download = async (version: FileVersion) => {
    if (!currentNode || !adapter.downloadVersion) return
    const key = `download:${version.id}`
    setWorkingKey(key)
    try {
      await adapter.downloadVersion(currentNode, version)
    } catch (error) {
      onError(error)
    } finally {
      setWorkingKey('')
    }
  }

  const busy = Boolean(workingKey)
  const open = Boolean(node)

  return (
    <>
      <Dialog
        open={open}
        onClose={() => { if (!busy) onClose() }}
        maxWidth="md"
        fullWidth
        scroll="paper"
        aria-label="版本历史"
        slotProps={{ paper: xDriveDialogPaperProps }}
      >
        <XDriveDialogTitle
          title={currentNode ? `版本历史 — ${currentNode.name}` : '版本历史'}
          subtitle={currentNode ? `当前版本 r${currentNode.revision}` : undefined}
          onClose={onClose}
          closeDisabled={busy}
        />
        <XDriveDialogContent dividers>
          {loading && versions.length === 0 ? (
            <XDriveStatePanel variant="plain" loading message="正在加载历史版本…" />
          ) : versions.length === 0 ? (
            <XDriveStatePanel variant="plain" message="暂无历史版本" />
          ) : (
            <XDriveTableSurface>
              <Table size="small" aria-label="版本历史">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 110 }}>版本</TableCell>
                    <TableCell sx={{ width: 120 }}>大小</TableCell>
                    <TableCell sx={{ width: 190 }}>保存时间</TableCell>
                    <TableCell align="right">操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {versions.map((version) => (
                    <TableRow key={version.id} hover>
                      <TableCell>{`r${version.revision}`}</TableCell>
                      <TableCell>{formatSize(version.size)}</TableCell>
                      <TableCell>{new Date(version.created_at).toLocaleString()}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {adapter.downloadVersion ? (
                            <XDriveActionButton
                              compact
                              loading={workingKey === `download:${version.id}`}
                              loadingLabel="正在下载…"
                              disabled={busy && workingKey !== `download:${version.id}`}
                              onClick={() => void download(version)}
                            >
                              下载
                            </XDriveActionButton>
                          ) : null}
                          <XDriveActionButton
                            compact
                            intent="primary"
                            disabled={busy}
                            onClick={() => setRestoreTarget(version)}
                          >
                            恢复
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
        open={Boolean(restoreTarget)}
        title={restoreTarget ? `恢复到版本 ${restoreTarget.revision}？` : '恢复历史版本？'}
        description="当前内容会先保留为一个新的历史版本。"
        confirmLabel="恢复版本"
        confirmIntent="primary"
        loading={Boolean(restoreTarget && workingKey === `restore:${restoreTarget.id}`)}
        loadingLabel="正在恢复…"
        onCancel={() => { if (!busy) setRestoreTarget(null) }}
        onConfirm={() => void restore()}
      />
    </>
  )
}
