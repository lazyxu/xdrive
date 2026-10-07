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
  const refreshRequestRef = useRef(0)
  const rememberSequenceRef = useRef(0)
  const rememberedSequenceByIDRef = useRef(new Map<string, number>())
  const enabledRef = useRef(enabled)
  const onTerminalTransitionRef = useRef(onTerminalTransition)
  enabledRef.current = enabled

  useEffect(() => {
    onTerminalTransitionRef.current = onTerminalTransition
  }, [onTerminalTransition])

  const rememberOperation = useCallback((operation: T) => {
    const sequence = rememberSequenceRef.current + 1
    rememberSequenceRef.current = sequence
    rememberedSequenceByIDRef.current.set(operation.id, sequence)
    statusRef.current.set(operation.id, operation.status)
    setOperations((currentOperations) => xDriveFileOperationUpsert(currentOperations, operation))
  }, [])

  const applyRefreshSnapshot = useCallback((
    nextOperations: readonly T[],
    refreshStartSequence: number,
  ) => {
    setOperations((currentOperations) => {
      let merged = [...nextOperations]
      for (const operation of currentOperations) {
        const rememberedSequence =
          rememberedSequenceByIDRef.current.get(operation.id) ?? 0
        if (rememberedSequence > refreshStartSequence) {
          merged = xDriveFileOperationUpsert(merged, operation)
        }
      }
      return merged
    })
  }, [])

  const beginRefresh = useCallback(() => {
    const requestID = refreshRequestRef.current + 1
    refreshRequestRef.current = requestID
    return {
      requestID,
      rememberSequence: rememberSequenceRef.current,
    }
  }, [])

  const refreshOperations = useCallback(async () => {
    if (!enabledRef.current) return null
    const refresh = beginRefresh()
    try {
      const nextOperations = await loadOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)
      if (
        enabledRef.current &&
        refresh.requestID === refreshRequestRef.current
      ) {
        applyRefreshSnapshot(nextOperations, refresh.rememberSequence)
      }
      return [...nextOperations]
    } catch (error) {
      if (
        enabledRef.current &&
        refresh.requestID === refreshRequestRef.current
      ) {
        onRefreshError?.(error)
      }
      return null
    }
  }, [applyRefreshSnapshot, beginRefresh, loadOperations, onRefreshError])

  const pollIntervalMs = xDriveFileOperationPollIntervalMs(operations, taskCenterVisible)

  useEffect(() => {
    if (!enabled) {
      refreshRequestRef.current += 1
      setOperations([])
      statusRef.current = new Map()
      rememberSequenceRef.current = 0
      rememberedSequenceByIDRef.current = new Map()
      return
    }

    let active = true
    const refresh = async () => {
      const request = beginRefresh()
      try {
        const nextOperations = await loadOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)
        if (
          active &&
          enabledRef.current &&
          request.requestID === refreshRequestRef.current
        ) {
          applyRefreshSnapshot(nextOperations, request.rememberSequence)
        }
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
  }, [applyRefreshSnapshot, beginRefresh, enabled, loadOperations, pollIntervalMs])

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
