import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded'
import type { Node } from '../models'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
  XDriveFileExplorerMenuItem,
  XDriveFileExplorerSort,
  XDriveFileExplorerVirtualCollection,
} from './FileExplorer'
import { XDriveConfirmDialog } from './ConfirmDialog'
import type { XDriveTrashDialogAdapter } from './TrashDialog'
import { useXDriveVirtualCollection } from './VirtualCollectionController'
import type { XDriveVirtualCollectionRange } from '../virtual-collection'

const fileExplorerTrashPageSize = 200

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
  lifecycleKey = '',
  enabled,
  adapter,
  sort,
  onError,
  onFeedback,
  onChanged,
}: {
  lifecycleKey?: string
  enabled: boolean
  adapter: XDriveTrashDialogAdapter
  sort: XDriveFileExplorerSort
  onError: (error: unknown) => void
  onFeedback?: (message: string) => void
  onChanged?: () => void | Promise<void>
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(false)
  const [workingKey, setWorkingKey] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Node | null>(null)
  const requestRef = useRef(0)
  const workingGenerationRef = useRef(0)
  const enabledRef = useRef(enabled)
  const lifecycleKeyRef = useRef(lifecycleKey)
  const onErrorRef = useRef(onError)
  const onFeedbackRef = useRef(onFeedback)
  const onChangedRef = useRef(onChanged)
  if (lifecycleKeyRef.current !== lifecycleKey) {
    lifecycleKeyRef.current = lifecycleKey
    requestRef.current += 1
    workingGenerationRef.current += 1
  }
  enabledRef.current = enabled
  onErrorRef.current = onError
  onFeedbackRef.current = onFeedback
  onChangedRef.current = onChanged

  const rangeEnabled = Boolean(adapter.listTrashRange)
  const rangeQueryKey = rangeEnabled
    ? `file-explorer-trash:${lifecycleKey}:${enabled ? 'enabled' : 'disabled'}:${sort.key}:${sort.direction}`
    : `file-explorer-trash:legacy:${lifecycleKey}`
  const countedRangeKeyRef = useRef('')
  if (countedRangeKeyRef.current && countedRangeKeyRef.current !== rangeQueryKey) {
    countedRangeKeyRef.current = ''
  }
  const loadTrashRange = useCallback(async (
    range: XDriveVirtualCollectionRange,
  ) => {
    if (!adapter.listTrashRange) throw new Error('Trash range adapter is unavailable.')
    const includeCount = countedRangeKeyRef.current !== rangeQueryKey
    const page = await adapter.listTrashRange({
      offset: range.offset,
      limit: range.limit,
      sort: sort.key,
      order: sort.direction,
      includeCount,
    })
    const hasCount = page.total_count_included !== false
    if (hasCount) countedRangeKeyRef.current = rangeQueryKey
    return {
      items: page.items,
      totalCount: hasCount ? page.total_count : null,
      offset: page.offset,
      limit: page.limit,
    }
  }, [adapter, rangeQueryKey, sort.direction, sort.key])
  const rangeCollection = useXDriveVirtualCollection<Node>({
    queryKey: rangeQueryKey,
    loadRange: loadTrashRange,
    onError: (error) => onErrorRef.current(error),
    pageSize: fileExplorerTrashPageSize,
  })

  const beginWorking = useCallback((key: string) => {
    const generation = workingGenerationRef.current + 1
    workingGenerationRef.current = generation
    setWorkingKey(key)
    return generation
  }, [])

  const finishWorking = useCallback((generation: number) => {
    if (generation !== workingGenerationRef.current) return
    setWorkingKey('')
  }, [])

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return []
    const requestID = requestRef.current + 1
    requestRef.current = requestID
    setLoading(true)
    try {
      if (adapter.listTrashRange) {
        countedRangeKeyRef.current = ''
        rangeCollection.reset(rangeQueryKey)
        const page = await adapter.listTrashRange({
          offset: 0,
          limit: fileExplorerTrashPageSize,
          sort: sort.key,
          order: sort.direction,
          includeCount: true,
        })
        if (requestID === requestRef.current && enabledRef.current) {
          countedRangeKeyRef.current = rangeQueryKey
          rangeCollection.primePage({
            items: page.items,
            totalCount: page.total_count,
            offset: page.offset,
            limit: page.limit,
          })
          setNodes(page.items)
        }
        return page.items
      }
      const next = await adapter.listTrash()
      if (requestID === requestRef.current && enabledRef.current) setNodes(next)
      return next
    } catch (error) {
      if (requestID === requestRef.current && enabledRef.current) onErrorRef.current(error)
      return []
    } finally {
      if (requestID === requestRef.current) setLoading(false)
    }
  }, [
    adapter,
    rangeCollection.primePage,
    rangeCollection.reset,
    rangeQueryKey,
    sort.direction,
    sort.key,
  ])

  useEffect(() => {
    requestRef.current += 1
    workingGenerationRef.current += 1
    countedRangeKeyRef.current = ''
    setLoading(false)
    setWorkingKey('')
    setDeleteTarget(null)
    setNodes([])
  }, [lifecycleKey])

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1
      workingGenerationRef.current += 1
      setLoading(false)
      setWorkingKey('')
      setDeleteTarget(null)
      return
    }
    void refresh()
  }, [enabled, refresh])

  const rangedNodes = useMemo(
    () => rangeEnabled
      ? [...rangeCollection.loadedItems.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([, node]) => node)
      : nodes,
    [nodes, rangeCollection.loadedItems, rangeEnabled],
  )
  const nodeByID = useMemo(
    () => new Map(rangedNodes.map((node) => [node.id, node])),
    [rangedNodes],
  )
  const items = useMemo(() => rangedNodes.map(projectTrashNode), [rangedNodes])
  const projectedLoadedItems = useMemo(() => {
    const projected = new Map<number, XDriveFileExplorerItem>()
    if (!rangeEnabled) return projected
    for (const [index, node] of rangeCollection.loadedItems) {
      projected.set(index, projectTrashNode(node))
    }
    return projected
  }, [rangeCollection.loadedItems, rangeEnabled])
  const virtualCollection = useMemo<XDriveFileExplorerVirtualCollection | undefined>(() => {
    if (!rangeEnabled || rangeCollection.totalCount === null) return undefined
    return {
      interactionKey: rangeQueryKey,
      itemCount: rangeCollection.totalCount,
      loadedItems: projectedLoadedItems,
      itemAt: (index) => projectedLoadedItems.get(index),
      onRangeChange: rangeCollection.ensureViewport,
      collectRange: async (startIndex, endIndex) => {
        const raw = await rangeCollection.collectRange(startIndex, endIndex)
        return raw?.map(projectTrashNode) ?? null
      },
    }
  }, [
    projectedLoadedItems,
    rangeCollection.collectRange,
    rangeCollection.ensureViewport,
    rangeCollection.totalCount,
    rangeEnabled,
    rangeQueryKey,
  ])
  const itemCount = virtualCollection?.itemCount ?? items.length

  const changed = useCallback(async (workingGeneration?: number) => {
    await refresh()
    if (
      workingGeneration !== undefined &&
      workingGeneration !== workingGenerationRef.current
    ) return
    await onChangedRef.current?.()
  }, [refresh])

  const restore = useCallback(async (item: XDriveFileExplorerItem) => {
    const node = nodeByID.get(Number(item.id))
    if (!node || workingKey) return
    const workingGeneration = beginWorking(`restore:${node.id}`)
    try {
      await adapter.restoreTrash(node)
      if (
        workingGeneration !== workingGenerationRef.current ||
        !enabledRef.current
      ) return
      onFeedbackRef.current?.('项目已恢复')
      await changed(workingGeneration)
    } catch (error) {
      if (
        workingGeneration === workingGenerationRef.current &&
        enabledRef.current
      ) onErrorRef.current(error)
    } finally {
      finishWorking(workingGeneration)
    }
  }, [adapter, beginWorking, changed, finishWorking, nodeByID, workingKey])

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
    const workingGeneration = beginWorking(`delete:${node.id}`)
    try {
      await adapter.deleteTrash(node)
      if (
        workingGeneration !== workingGenerationRef.current ||
        !enabledRef.current
      ) return
      setDeleteTarget(null)
      onFeedbackRef.current?.('已永久删除')
      await changed(workingGeneration)
    } catch (error) {
      if (
        workingGeneration === workingGenerationRef.current &&
        enabledRef.current
      ) {
        onErrorRef.current(error)
      }
    } finally {
      finishWorking(workingGeneration)
    }
  }, [adapter, beginWorking, changed, deleteTarget, finishWorking, workingKey])

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
    itemCount,
    virtualCollection,
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
