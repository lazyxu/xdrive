import { useCallback, useRef, useState } from 'react'
import { xDriveFileExplorerDeleteOperationPlan } from '../file-explorer-controller'
import type { Node } from '../models'
import {
  resolveXDriveTransport,
  type XDriveTransportResult,
} from '../transport-result'

export type XDriveFileExplorerDeleteNode =
  Pick<Node, 'id' | 'revision' | 'name' | 'type'>

export type XDriveFileExplorerDeleteConfirmation = {
  title: string
  description: string
  confirmLabel: string
  intent: 'danger' | 'warning'
  run: () => Promise<void>
}

export function useXDriveFileExplorerDeleteController<
  TNode extends XDriveFileExplorerDeleteNode,
  TQueued,
>({
  submitOperation,
  onQueued,
  requestConfirmation,
  confirmationIntent = 'danger',
  onFeedback,
  onError,
}: {
  submitOperation: (
    operation: 'delete',
    items: Array<{ id: number; revision: number }>,
  ) => Promise<XDriveTransportResult<TQueued>>
  onQueued: (queued: TQueued) => void
  requestConfirmation: (confirmation: XDriveFileExplorerDeleteConfirmation) => void
  confirmationIntent?: XDriveFileExplorerDeleteConfirmation['intent']
  onFeedback: (message: string) => void
  onError: (error: unknown) => void
}) {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const runDelete = useCallback(async (nodes: readonly TNode[]) => {
    if (busyRef.current) return false
    const plan = xDriveFileExplorerDeleteOperationPlan(nodes)
    if (plan.count === 0) return false

    busyRef.current = true
    setBusy(true)
    try {
      const queued = await resolveXDriveTransport(
        submitOperation(plan.operation, plan.items),
      )
      onQueued(queued)
      onFeedback(plan.message)
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [onError, onFeedback, onQueued, submitOperation])

  const requestDelete = useCallback((nodes: readonly TNode[]) => {
    if (busyRef.current) return
    const plan = xDriveFileExplorerDeleteOperationPlan(nodes)
    if (plan.count === 0) return

    const first = nodes[0]
    requestConfirmation({
      title: plan.count === 1
        ? `将“${first.name}”移到回收站？`
        : `将所选 ${plan.count} 个项目移到回收站？`,
      description: plan.count === 1
        ? first.type === 'dir'
          ? '该文件夹及其中的全部内容会从云端文件列表中移除，但之后仍可从回收站恢复。'
          : '该文件会从云端文件列表中移除，但之后仍可从回收站恢复。'
        : '所选文件和文件夹会从云端文件列表中移除，但之后仍可从回收站恢复。',
      confirmLabel: '移到回收站',
      intent: confirmationIntent,
      run: async () => {
        await runDelete(nodes)
      },
    })
  }, [confirmationIntent, requestConfirmation, runDelete])

  const remove = useCallback((node: TNode) => {
    requestDelete([node])
  }, [requestDelete])

  return {
    busy,
    remove,
    removeMany: requestDelete,
  }
}
