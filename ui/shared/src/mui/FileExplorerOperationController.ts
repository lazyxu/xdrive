import { useEffect, useRef, useState } from 'react'
import {
  xDriveFileExplorerDropItemsPlan,
  xDriveFileExplorerDropItemsToParentPlan,
  xDriveFileExplorerRunQueuedOperation,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerCopyMoveOperation,
  XDriveFileExplorerOperationNode,
  XDriveFileExplorerQueuedOperationPlan,
  XDriveFileExplorerSelectionItem,
} from '../file-explorer-controller'
import type { Node } from '../models'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
} from './FileExplorer'

export type XDriveFileExplorerQueuedOperationAction =
  | ''
  | 'paste'
  | 'drop-items'

export type XDriveFileExplorerPastePlan =
  XDriveFileExplorerQueuedOperationPlan & {
    clearClipboard: boolean
    clipboardGeneration: number
  }

export function useXDriveFileExplorerOperationController<
  TNode extends XDriveFileExplorerOperationNode & Pick<Node, 'type'>,
  TQueued,
>({
  lifecycleKey,
  nodeByID,
  currentID,
  disabled = false,
  planPaste,
  completePaste,
  canPaste,
  clearSearch,
  submitOperation,
  onQueued,
  onFeedback,
  onError,
}: {
  lifecycleKey: string
  nodeByID: ReadonlyMap<number, TNode>
  currentID?: number | null
  disabled?: boolean
  planPaste: (
    targetParentID: number,
    operationOverride?: XDriveFileExplorerCopyMoveOperation,
  ) => XDriveFileExplorerPastePlan | null
  completePaste: (plan: {
    clearClipboard: boolean
    clipboardGeneration: number
  }) => void
  canPaste: (busy: boolean) => boolean
  clearSearch: () => void
  submitOperation: (plan: XDriveFileExplorerQueuedOperationPlan) => Promise<TQueued>
  onQueued: (queued: TQueued) => void
  onFeedback: (tone: 'good', message: string) => void
  onError: (error: unknown) => void
}) {
  const [busyAction, setBusyAction] = useState<XDriveFileExplorerQueuedOperationAction>('')
  const busyActionRef = useRef<XDriveFileExplorerQueuedOperationAction>('')
  const lifecycleGenerationRef = useRef(1)

  useEffect(() => {
    lifecycleGenerationRef.current += 1
    busyActionRef.current = ''
    setBusyAction('')
    return () => {
      lifecycleGenerationRef.current += 1
      busyActionRef.current = ''
    }
  }, [lifecycleKey])

  const runPlan = async (
    action: Exclude<XDriveFileExplorerQueuedOperationAction, ''>,
    plan: XDriveFileExplorerQueuedOperationPlan,
    onComplete: () => void,
  ) => {
    if (disabled || busyActionRef.current) return false
    const generation = lifecycleGenerationRef.current
    const isCurrent = () => generation === lifecycleGenerationRef.current
    busyActionRef.current = action
    setBusyAction(action)
    try {
      const completed = await xDriveFileExplorerRunQueuedOperation({
        plan,
        submit: () => submitOperation(plan),
        onQueued: (queued) => {
          if (isCurrent()) onQueued(queued)
        },
        onFeedback: (tone, message) => {
          if (isCurrent()) onFeedback(tone, message)
        },
        onComplete: () => {
          if (isCurrent()) onComplete()
        },
        onError: (error) => {
          if (isCurrent()) onError(error)
        },
      })
      return completed && isCurrent()
    } finally {
      if (isCurrent()) {
        busyActionRef.current = ''
        setBusyAction('')
      }
    }
  }

  const pasteClipboard = async (
    operationOverride?: XDriveFileExplorerCopyMoveOperation,
  ) => {
    if (
      currentID === null ||
      currentID === undefined ||
      disabled ||
      busyActionRef.current
    ) return
    const plan = planPaste(currentID, operationOverride)
    if (!plan) return
    await runPlan('paste', plan, () => {
      completePaste(plan)
      clearSearch()
    })
  }

  const dropItemsToFolder = async (
    selected: XDriveFileExplorerItem[],
    target: XDriveFileExplorerItem,
    operation: 'move' | 'copy',
  ) => {
    if (disabled || busyActionRef.current) return
    const plan = xDriveFileExplorerDropItemsPlan(
      operation,
      selected,
      target,
      nodeByID,
    )
    if (!plan) return
    await runPlan('drop-items', plan, clearSearch)
  }

  const dropItemsToCrumb = async (
    selected: XDriveFileExplorerSelectionItem[],
    crumb: XDriveFileExplorerCrumb,
    operation: 'move' | 'copy',
  ) => {
    if (disabled || busyActionRef.current) return
    const plan = xDriveFileExplorerDropItemsToParentPlan(
      operation,
      selected,
      Number(crumb.id),
      nodeByID,
    )
    if (!plan) return
    await runPlan('drop-items', plan, clearSearch)
  }

  const busy = Boolean(busyAction)

  return {
    busy,
    busyAction,
    canPaste: canPaste(disabled || busy),
    pasteClipboard,
    dropItemsToFolder,
    dropItemsToCrumb,
  }
}
