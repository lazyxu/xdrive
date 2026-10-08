import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box,
  Dialog,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { FileVersion, Node } from '../models'
import { formatBytes } from '../format'
import { XDriveActionButton } from './ActionButton'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'
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
  const loadRequestRef = useRef(0)
  const workGenerationRef = useRef(0)

  const load = useCallback(async (nodeID: number) => {
    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    setLoading(true)
    try {
      const next = await adapter.listVersions(nodeID)
      if (requestID !== loadRequestRef.current) return
      setVersions(next)
    } catch (error) {
      if (requestID !== loadRequestRef.current) return
      onError(error)
      setVersions([])
    } finally {
      if (requestID === loadRequestRef.current) setLoading(false)
    }
  }, [adapter, onError])

  useEffect(() => {
    workGenerationRef.current += 1
    setWorkingKey('')
    setCurrentNode(node)
    setRestoreTarget(null)
    if (node) {
      void load(node.id)
    } else {
      loadRequestRef.current += 1
      setVersions([])
      setLoading(false)
    }
  }, [load, node?.id, node?.revision])

  useEffect(() => () => {
    loadRequestRef.current += 1
    workGenerationRef.current += 1
  }, [])

  const beginWork = (key: string) => {
    const generation = workGenerationRef.current + 1
    workGenerationRef.current = generation
    setWorkingKey(key)
    return generation
  }

  const workIsCurrent = (generation: number) => (
    generation === workGenerationRef.current
  )

  const finishWork = (generation: number) => {
    if (workIsCurrent(generation)) setWorkingKey('')
  }

  const restore = async () => {
    if (!currentNode || !restoreTarget) return
    const target = restoreTarget
    const key = `restore:${target.id}`
    const workGeneration = beginWork(key)
    try {
      const restored = await adapter.restoreVersion(currentNode, target)
      if (!workIsCurrent(workGeneration)) return
      setCurrentNode(restored)
      setRestoreTarget(null)
      onFeedback?.('版本已恢复')
      await load(restored.id)
      if (!workIsCurrent(workGeneration)) return
      await onRestored?.(restored)
    } catch (error) {
      if (workIsCurrent(workGeneration)) onError(error)
    } finally {
      finishWork(workGeneration)
    }
  }

  const download = async (version: FileVersion) => {
    if (!currentNode || !adapter.downloadVersion) return
    const key = `download:${version.id}`
    const workGeneration = beginWork(key)
    try {
      await adapter.downloadVersion(currentNode, version)
    } catch (error) {
      if (workIsCurrent(workGeneration)) onError(error)
    } finally {
      finishWork(workGeneration)
    }
  }

  const busy = Boolean(workingKey)
  const open = Boolean(node)
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()

  return (
    <>
      <Dialog
        open={open}
        onClose={() => { if (!busy) onClose() }}
        maxWidth="md"
        fullWidth
        fullScreen={compactTouch}
        scroll="paper"
        aria-label="版本历史"
        slotProps={{ paper: dialogPaper }}
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
          ) : compactTouch ? (
            <Stack
              spacing={1}
              data-xdrive-version-history-mobile-list
              aria-label="版本历史"
            >
              {versions.map((version) => (
                <Box
                  key={version.id}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    p: 1.25,
                  }}
                >
                  <Stack spacing={1}>
                    <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {`r${version.revision}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(version.created_at).toLocaleString()}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {formatBytes(version.size)}
                    </Typography>
                    <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                      {adapter.downloadVersion ? (
                        <XDriveActionButton
                          loading={workingKey === `download:${version.id}`}
                          loadingLabel="正在下载…"
                          disabled={busy && workingKey !== `download:${version.id}`}
                          onClick={() => void download(version)}
                        >
                          下载
                        </XDriveActionButton>
                      ) : null}
                      <XDriveActionButton
                        intent="primary"
                        disabled={busy}
                        onClick={() => setRestoreTarget(version)}
                      >
                        恢复
                      </XDriveActionButton>
                    </Stack>
                  </Stack>
                </Box>
              ))}
            </Stack>
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
                      <TableCell>{formatBytes(version.size)}</TableCell>
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
