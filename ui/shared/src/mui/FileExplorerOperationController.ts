import { useState } from 'react'
import {
  xDriveFileExplorerDropItemsPlan,
  xDriveFileExplorerDropItemsToParentPlan,
  xDriveFileExplorerRunQueuedOperation,
} from '../file-explorer-controller'
import type {
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
  }

export function useXDriveFileExplorerOperationController<
  TNode extends XDriveFileExplorerOperationNode & Pick<Node, 'type'>,
  TQueued,
>({
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
  nodeByID: ReadonlyMap<number, TNode>
  currentID?: number | null
  disabled?: boolean
  planPaste: (targetParentID: number) => XDriveFileExplorerPastePlan | null
  completePaste: (plan: { clearClipboard: boolean }) => void
  canPaste: (busy: boolean) => boolean
  clearSearch: () => void
  submitOperation: (plan: XDriveFileExplorerQueuedOperationPlan) => Promise<TQueued>
  onQueued: (queued: TQueued) => void
  onFeedback: (tone: 'good', message: string) => void
  onError: (error: unknown) => void
}) {
  const [busyAction, setBusyAction] = useState<XDriveFileExplorerQueuedOperationAction>('')

  const runPlan = async (
    action: Exclude<XDriveFileExplorerQueuedOperationAction, ''>,
    plan: XDriveFileExplorerQueuedOperationPlan,
    onComplete: () => void,
  ) => {
    if (disabled || busyAction) return false
    setBusyAction(action)
    try {
      return await xDriveFileExplorerRunQueuedOperation({
        plan,
        submit: () => submitOperation(plan),
        onQueued,
        onFeedback,
        onComplete,
        onError,
      })
    } finally {
      setBusyAction('')
    }
  }

  const pasteClipboard = async () => {
    if (currentID === null || currentID === undefined || disabled || busyAction) return
    const plan = planPaste(currentID)
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
    if (disabled || busyAction) return
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
    if (disabled || busyAction) return
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
