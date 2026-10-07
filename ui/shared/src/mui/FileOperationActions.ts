import { useCallback, useEffect, useRef, useState } from 'react'
import { xDriveFileOperationConflictPolicyLabel } from '../file-operations'
import type { XDriveFileOperationConflictResolution } from '../file-operations'
import type { XDriveFileOperationLifecycleItem } from './FileOperationLifecycle'

type XDriveFileOperationAction =
  | ''
  | 'clear-history'
  | `cancel:${string}`
  | `retry:${string}`
  | `undo:${string}`
  | `redo:${string}`
  | `resolve:${XDriveFileOperationConflictResolution}:${string}`

export function useXDriveFileOperationActions<
  TOperation extends XDriveFileOperationLifecycleItem,
  TTransferHistory = void,
>({
  lifecycleKey,
  cancelOperation,
  retryOperation,
  undoOperation,
  redoOperation,
  resolveConflict,
  clearOperationHistory,
  clearTransferHistory,
  onTransferHistoryCleared,
  rememberOperation,
  refreshOperations,
  onError,
  onFeedback,
}: {
  lifecycleKey: string
  cancelOperation: (id: string) => Promise<TOperation>
  retryOperation: (id: string) => Promise<TOperation>
  undoOperation?: (id: string) => Promise<TOperation>
  redoOperation?: (id: string) => Promise<TOperation>
  resolveConflict?: (id: string, policy: XDriveFileOperationConflictResolution) => Promise<TOperation>
  clearOperationHistory: () => Promise<void>
  clearTransferHistory: () => Promise<TTransferHistory>
  onTransferHistoryCleared?: (result: TTransferHistory) => void
  rememberOperation: (operation: TOperation) => void
  refreshOperations: () => Promise<unknown>
  onError: (error: unknown) => void
  onFeedback?: (message: string) => void
}) {
  const [action, setAction] = useState<XDriveFileOperationAction>('')
  const actionRef = useRef<XDriveFileOperationAction>('')
  const lifecycleGenerationRef = useRef(1)

  useEffect(() => {
    lifecycleGenerationRef.current += 1
    actionRef.current = ''
    setAction('')
    return () => {
      lifecycleGenerationRef.current += 1
      actionRef.current = ''
    }
  }, [lifecycleKey])

  const beginAction = useCallback((nextAction: XDriveFileOperationAction) => {
    if (actionRef.current) return null
    const generation = lifecycleGenerationRef.current
    actionRef.current = nextAction
    setAction(nextAction)
    return generation
  }, [])

  const actionIsCurrent = useCallback((generation: number) => (
    generation === lifecycleGenerationRef.current
  ), [])

  const finishAction = useCallback((generation: number) => {
    if (!actionIsCurrent(generation)) return
    actionRef.current = ''
    setAction('')
  }, [actionIsCurrent])

  const cancel = useCallback(async (id: string) => {
    const generation = beginAction(`cancel:${id}`)
    if (generation === null) return false
    try {
      const operation = await cancelOperation(id)
      if (!actionIsCurrent(generation)) return false
      rememberOperation(operation)
      await refreshOperations()
      return actionIsCurrent(generation)
    } catch (error) {
      if (!actionIsCurrent(generation)) return false
      onError(error)
      return false
    } finally {
      finishAction(generation)
    }
  }, [actionIsCurrent, beginAction, cancelOperation, finishAction, onError, refreshOperations, rememberOperation])

  const retry = useCallback(async (id: string) => {
    const generation = beginAction(`retry:${id}`)
    if (generation === null) return false
    try {
      const operation = await retryOperation(id)
      if (!actionIsCurrent(generation)) return false
      rememberOperation(operation)
      onFeedback?.('文件操作已重新加入队列。')
      await refreshOperations()
      return actionIsCurrent(generation)
    } catch (error) {
      if (!actionIsCurrent(generation)) return false
      onError(error)
      return false
    } finally {
      finishAction(generation)
    }
  }, [actionIsCurrent, beginAction, finishAction, onError, onFeedback, refreshOperations, rememberOperation, retryOperation])

  const undo = useCallback(async (id: string) => {
    if (!undoOperation) return false
    const generation = beginAction(`undo:${id}`)
    if (generation === null) return false
    try {
      const operation = await undoOperation(id)
      if (!actionIsCurrent(generation)) return false
      rememberOperation(operation)
      onFeedback?.('撤销操作已加入队列。')
      await refreshOperations()
      return actionIsCurrent(generation)
    } catch (error) {
      if (!actionIsCurrent(generation)) return false
      onError(error)
      return false
    } finally {
      finishAction(generation)
    }
  }, [actionIsCurrent, beginAction, finishAction, onError, onFeedback, refreshOperations, rememberOperation, undoOperation])

  const redo = useCallback(async (id: string) => {
    if (!redoOperation) return false
    const generation = beginAction(`redo:${id}`)
    if (generation === null) return false
    try {
      const operation = await redoOperation(id)
      if (!actionIsCurrent(generation)) return false
      rememberOperation(operation)
      onFeedback?.('重做操作已加入队列。')
      await refreshOperations()
      return actionIsCurrent(generation)
    } catch (error) {
      if (!actionIsCurrent(generation)) return false
      onError(error)
      return false
    } finally {
      finishAction(generation)
    }
  }, [actionIsCurrent, beginAction, finishAction, onError, onFeedback, redoOperation, refreshOperations, rememberOperation])

  const resolve = useCallback(async (
    id: string,
    policy: XDriveFileOperationConflictResolution,
  ) => {
    if (!resolveConflict) return false
    const generation = beginAction(`resolve:${policy}:${id}`)
    if (generation === null) return false
    try {
      const operation = await resolveConflict(id, policy)
      if (!actionIsCurrent(generation)) return false
      rememberOperation(operation)
      onFeedback?.(`已按“${xDriveFileOperationConflictPolicyLabel(policy)}”重新加入队列。`)
      await refreshOperations()
      return actionIsCurrent(generation)
    } catch (error) {
      if (!actionIsCurrent(generation)) return false
      onError(error)
      return false
    } finally {
      finishAction(generation)
    }
  }, [
    actionIsCurrent,
    beginAction,
    finishAction,
    onError,
    onFeedback,
    refreshOperations,
    rememberOperation,
    resolveConflict,
  ])

  const clearHistory = useCallback(async () => {
    const generation = beginAction('clear-history')
    if (generation === null) return false
    try {
      await clearOperationHistory()
      if (!actionIsCurrent(generation)) return false
      try {
        const transferResult = await clearTransferHistory()
        if (!actionIsCurrent(generation)) return false
        onTransferHistoryCleared?.(transferResult)
      } catch (error) {
        if (!actionIsCurrent(generation)) return false
        await refreshOperations()
        if (!actionIsCurrent(generation)) return false
        throw error
      }
      await refreshOperations()
      if (!actionIsCurrent(generation)) return false
      onFeedback?.('已清空已完成、失败和已取消的任务历史。')
      return true
    } catch (error) {
      if (!actionIsCurrent(generation)) return false
      onError(error)
      return false
    } finally {
      finishAction(generation)
    }
  }, [
    actionIsCurrent,
    beginAction,
    clearOperationHistory,
    clearTransferHistory,
    finishAction,
    onError,
    onFeedback,
    onTransferHistoryCleared,
    refreshOperations,
  ])

  const resolvingPolicy: XDriveFileOperationConflictResolution | '' = action.startsWith('resolve:skip:')
    ? 'skip'
    : action.startsWith('resolve:keep_both:')
      ? 'keep_both'
      : action.startsWith('resolve:replace:')
        ? 'replace'
        : ''
  const resolvingID = resolvingPolicy
    ? action.slice(`resolve:${resolvingPolicy}:`.length)
    : ''

  return {
    busy: Boolean(action),
    cancellingID: action.startsWith('cancel:') ? action.slice('cancel:'.length) : '',
    retryingID: action.startsWith('retry:') ? action.slice('retry:'.length) : '',
    undoingID: action.startsWith('undo:') ? action.slice('undo:'.length) : '',
    redoingID: action.startsWith('redo:') ? action.slice('redo:'.length) : '',
    resolvingID,
    resolvingPolicy,
    clearHistoryLoading: action === 'clear-history',
    cancelOperation: cancel,
    retryOperation: retry,
    undoOperation: undo,
    redoOperation: redo,
    resolveConflict: resolve,
    clearHistory,
  }
}
