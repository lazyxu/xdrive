import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import type { Node } from '../models'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
  XDriveFileExplorerMenuItem,
} from './FileExplorer'
import { XDriveConfirmDialog } from './ConfirmDialog'
import type { XDriveTrashDialogAdapter } from './TrashDialog'

export const XDRIVE_FILE_EXPLORER_TRASH_CRUMBS: XDriveFileExplorerCrumb[] = [
  { id: 'trash', name: '回收站' },
]

function projectTrashNode(node: Node): XDriveFileExplorerItem {
  const deletedAt = node.deleted_at
  return {
    id: node.id,
    name: node.name,
    kind: node.type,
    size: node.size,
    revision: node.revision,
    updatedAt: deletedAt || node.updated_at,
    secondaryLabel: deletedAt ? `删除于 ${new Date(deletedAt).toLocaleString()}` : undefined,
    properties: deletedAt
      ? [{ label: '删除时间', value: new Date(deletedAt).toLocaleString() }]
      : undefined,
  }
}

export function useXDriveFileExplorerTrash({
  enabled,
  adapter,
  onError,
  onFeedback,
  onChanged,
}: {
  enabled: boolean
  adapter: XDriveTrashDialogAdapter
  onError: (error: unknown) => void
  onFeedback?: (message: string) => void
  onChanged?: () => void | Promise<void>
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(false)
  const [workingKey, setWorkingKey] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Node | null>(null)
  const requestRef = useRef(0)
  const enabledRef = useRef(enabled)
  const onErrorRef = useRef(onError)
  const onFeedbackRef = useRef(onFeedback)
  const onChangedRef = useRef(onChanged)
  enabledRef.current = enabled
  onErrorRef.current = onError
  onFeedbackRef.current = onFeedback
  onChangedRef.current = onChanged

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return []
    const requestID = requestRef.current + 1
    requestRef.current = requestID
    setLoading(true)
    try {
      const next = await adapter.listTrash()
      if (requestID === requestRef.current && enabledRef.current) setNodes(next)
      return next
    } catch (error) {
      if (requestID === requestRef.current && enabledRef.current) onErrorRef.current(error)
      return []
    } finally {
      if (requestID === requestRef.current) setLoading(false)
    }
  }, [adapter])

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1
      setLoading(false)
      setWorkingKey('')
      setDeleteTarget(null)
      return
    }
    void refresh()
  }, [enabled, refresh])

  const nodeByID = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  )
  const items = useMemo(() => nodes.map(projectTrashNode), [nodes])

  const changed = useCallback(async () => {
    await refresh()
    await onChangedRef.current?.()
  }, [refresh])

  const restore = useCallback(async (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (!node || workingKey) return
    setWorkingKey(`restore:${node.id}`)
    try {
      await adapter.restoreTrash(node)
      onFeedbackRef.current?.('项目已恢复')
      await changed()
    } catch (error) {
      onErrorRef.current(error)
    } finally {
      setWorkingKey('')
    }
  }, [adapter, changed, nodeByID, workingKey])

  const requestPermanentDelete = useCallback((item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (node && !workingKey) setDeleteTarget(node)
  }, [nodeByID, workingKey])

  const cancelPermanentDelete = useCallback(() => {
    if (!workingKey) setDeleteTarget(null)
  }, [workingKey])

  const confirmPermanentDelete = useCallback(async () => {
    const node = deleteTarget
    if (!node || workingKey) return
    setWorkingKey(`delete:${node.id}`)
    try {
      await adapter.deleteTrash(node)
      setDeleteTarget(null)
      onFeedbackRef.current?.('已永久删除')
      await changed()
    } catch (error) {
      onErrorRef.current(error)
    } finally {
      setWorkingKey('')
    }
  }, [adapter, changed, deleteTarget, workingKey])

  const getItemMenuItems = useCallback((
    item: XDriveFileExplorerItem,
  ): XDriveFileExplorerMenuItem[] => [
    {
      id: 'trash-restore',
      label: '恢复',
      icon: <RestoreFromTrashRoundedIcon fontSize="small" />,
      disabled: Boolean(workingKey),
      onSelect: () => { void restore(item) },
    },
    {
      id: 'trash-delete-forever',
      label: '永久删除',
      icon: <DeleteForeverRoundedIcon fontSize="small" />,
      disabled: Boolean(workingKey),
      danger: true,
      dividerBefore: true,
      onSelect: () => requestPermanentDelete(item),
    },
  ], [requestPermanentDelete, restore, workingKey])

  return {
    items,
    crumbs: XDRIVE_FILE_EXPLORER_TRASH_CRUMBS,
    loading,
    working: Boolean(workingKey),
    workingKey,
    deleteTarget,
    refresh,
    getItemMenuItems,
    cancelPermanentDelete,
    confirmPermanentDelete,
  }
}

export function XDriveFileExplorerTrashDeleteDialog({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: Node | null
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <XDriveConfirmDialog
      open={Boolean(target)}
      title={target ? `永久删除 ${target.name}？` : '永久删除项目？'}
      description="该项目、当前内容以及所有已保存的历史版本都将被永久删除，且无法撤销。"
      confirmLabel="永久删除"
      confirmIntent="danger"
      loading={loading}
      loadingLabel="正在永久删除…"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
