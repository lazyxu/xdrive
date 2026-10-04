import { useCallback, useRef, useState } from 'react'
import { xDriveFileOperationConflictPolicyLabel } from '../file-operations'
import type { XDriveFileOperationConflictResolution } from '../file-operations'
import type { XDriveFileOperationLifecycleItem } from './FileOperationLifecycle'

type XDriveFileOperationAction =
  | ''
  | 'clear-history'
  | `cancel:${string}`
  | `retry:${string}`
  | `resolve:${XDriveFileOperationConflictResolution}:${string}`

export function useXDriveFileOperationActions<
  TOperation extends XDriveFileOperationLifecycleItem,
  TTransferHistory = void,
>({
  cancelOperation,
  retryOperation,
  resolveConflict,
  clearOperationHistory,
  clearTransferHistory,
  onTransferHistoryCleared,
  rememberOperation,
  refreshOperations,
  onError,
  onFeedback,
}: {
  cancelOperation: (id: string) => Promise<TOperation>
  retryOperation: (id: string) => Promise<TOperation>
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

  const beginAction = useCallback((nextAction: XDriveFileOperationAction) => {
    if (actionRef.current) return false
    actionRef.current = nextAction
    setAction(nextAction)
    return true
  }, [])

  const finishAction = useCallback(() => {
    actionRef.current = ''
    setAction('')
  }, [])

  const cancel = useCallback(async (id: string) => {
    if (!beginAction(`cancel:${id}`)) return false
    try {
      rememberOperation(await cancelOperation(id))
      await refreshOperations()
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      finishAction()
    }
  }, [beginAction, cancelOperation, finishAction, onError, refreshOperations, rememberOperation])

  const retry = useCallback(async (id: string) => {
    if (!beginAction(`retry:${id}`)) return false
    try {
      const operation = await retryOperation(id)
      rememberOperation(operation)
      onFeedback?.('文件操作已重新加入队列。')
      await refreshOperations()
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      finishAction()
    }
  }, [beginAction, finishAction, onError, onFeedback, refreshOperations, rememberOperation, retryOperation])

  const resolve = useCallback(async (
    id: string,
    policy: XDriveFileOperationConflictResolution,
  ) => {
    if (!resolveConflict || !beginAction(`resolve:${policy}:${id}`)) return false
    try {
      const operation = await resolveConflict(id, policy)
      rememberOperation(operation)
      onFeedback?.(`已按“${xDriveFileOperationConflictPolicyLabel(policy)}”重新加入队列。`)
      await refreshOperations()
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      finishAction()
    }
  }, [
    beginAction,
    finishAction,
    onError,
    onFeedback,
    refreshOperations,
    rememberOperation,
    resolveConflict,
  ])

  const clearHistory = useCallback(async () => {
    if (!beginAction('clear-history')) return false
    try {
      await clearOperationHistory()
      try {
        const transferResult = await clearTransferHistory()
        onTransferHistoryCleared?.(transferResult)
      } catch (error) {
        await refreshOperations()
        throw error
      }
      await refreshOperations()
      onFeedback?.('已清空已完成、失败和已取消的任务历史。')
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      finishAction()
    }
  }, [
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
      : ''
  const resolvingID = resolvingPolicy
    ? action.slice(`resolve:${resolvingPolicy}:`.length)
    : ''

  return {
    busy: Boolean(action),
    cancellingID: action.startsWith('cancel:') ? action.slice('cancel:'.length) : '',
    retryingID: action.startsWith('retry:') ? action.slice('retry:'.length) : '',
    resolvingID,
    resolvingPolicy,
    clearHistoryLoading: action === 'clear-history',
    cancelOperation: cancel,
    retryOperation: retry,
    resolveConflict: resolve,
    clearHistory,
  }
}
