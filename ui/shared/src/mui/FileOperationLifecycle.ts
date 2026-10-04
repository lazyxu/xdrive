import { useCallback, useEffect, useRef, useState } from 'react'
import {
  XDRIVE_FILE_OPERATION_HISTORY_LIMIT,
  xDriveFileOperationPollIntervalMs,
  xDriveFileOperationTransitionSnapshot,
  xDriveFileOperationUpsert,
} from '../file-operations'
import type { XDriveFileOperation } from '../file-operations'

export type XDriveFileOperationLifecycleItem = Pick<XDriveFileOperation, 'id' | 'status'>

export function useXDriveFileOperationLifecycle<
  T extends XDriveFileOperationLifecycleItem,
>({
  enabled,
  taskCenterVisible = false,
  loadOperations,
  onRefreshError,
  onTerminalTransition,
}: {
  enabled: boolean
  taskCenterVisible?: boolean
  loadOperations: (limit: number) => Promise<readonly T[]>
  onRefreshError?: (error: unknown) => void
  onTerminalTransition?: () => void
}) {
  const [operations, setOperations] = useState<T[]>([])
  const statusRef = useRef(new Map<string, string>())
  const onTerminalTransitionRef = useRef(onTerminalTransition)

  useEffect(() => {
    onTerminalTransitionRef.current = onTerminalTransition
  }, [onTerminalTransition])

  const rememberOperation = useCallback((operation: T) => {
    statusRef.current.set(operation.id, operation.status)
    setOperations((currentOperations) => xDriveFileOperationUpsert(currentOperations, operation))
  }, [])

  const refreshOperations = useCallback(async () => {
    try {
      const nextOperations = await loadOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)
      setOperations([...nextOperations])
      return [...nextOperations]
    } catch (error) {
      onRefreshError?.(error)
      return null
    }
  }, [loadOperations, onRefreshError])

  const pollIntervalMs = xDriveFileOperationPollIntervalMs(operations, taskCenterVisible)

  useEffect(() => {
    if (!enabled) {
      setOperations([])
      statusRef.current = new Map()
      return
    }

    let active = true
    const refresh = async () => {
      try {
        const nextOperations = await loadOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)
        if (active) setOperations([...nextOperations])
      } catch {
        // Background polling is intentionally quiet; explicit actions use refreshOperations for errors.
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), pollIntervalMs)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [enabled, loadOperations, pollIntervalMs])

  useEffect(() => {
    const transition = xDriveFileOperationTransitionSnapshot(statusRef.current, operations)
    statusRef.current = transition.statuses
    if (transition.hasTerminalTransition) onTerminalTransitionRef.current?.()
  }, [operations])

  return {
    operations,
    rememberOperation,
    refreshOperations,
  }
}
