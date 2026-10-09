import { useEffect, useRef, useState } from 'react'
import {
  xDriveFileExplorerDestinationTargetDisabledReason,
  xDriveFileExplorerDropOperationPlan,
  xDriveFileExplorerDropItemsPlan,
  xDriveFileExplorerDropItemsToParentPlan,
  xDriveFileExplorerResolveSelectionNodes,
  xDriveFileExplorerRunQueuedOperation,
  xDriveFileExplorerSelectionActionDisabledReason,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerCopyMoveOperation,
  XDriveFileExplorerDestinationCrumb,
  XDriveFileExplorerDestinationRequest,
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
  | 'destination'

export type XDriveFileExplorerPastePlan =
  XDriveFileExplorerQueuedOperationPlan & {
    clearClipboard: boolean
    clipboardGeneration: number
  }

export function useXDriveFileExplorerOperationController<
  TNode extends XDriveFileExplorerOperationNode & Pick<Node, 'type' | 'name'>,
  TQueued,
>({
  lifecycleKey,
  nodeByID,
  currentID,
  disabled = false,
  maxItems,
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
  maxItems?: number
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
  const [destinationRequest, setDestinationRequest] = useState<XDriveFileExplorerDestinationRequest | null>(null)
  const destinationRef = useRef<{
    request: XDriveFileExplorerDestinationRequest
    lifecycleKey: string
    clearSourceSearch: () => void
  } | null>(null)

  useEffect(() => {
    lifecycleGenerationRef.current += 1
    busyActionRef.current = ''
    setBusyAction('')
    destinationRef.current = null
    setDestinationRequest(null)
    return () => {
      lifecycleGenerationRef.current += 1
      busyActionRef.current = ''
    }
  }, [lifecycleKey])

  const planDisabledReason = (plan: XDriveFileExplorerQueuedOperationPlan | null) => (
    plan && maxItems !== undefined && Math.max(plan.count, plan.items.length) > maxItems
      ? `一次操作最多 ${maxItems} 个项目，请缩小选择范围。`
      : null
  )

  const runPlan = async (
    action: Exclude<XDriveFileExplorerQueuedOperationAction, ''>,
    plan: XDriveFileExplorerQueuedOperationPlan,
    onComplete: () => void,
    rejectOnFailure = false,
  ) => {
    if (disabled || busyActionRef.current) {
      if (rejectOnFailure) throw new Error('当前有文件操作正在进行，请稍后重试。')
      return false
    }
    const reason = planDisabledReason(plan)
    if (reason) {
      const error = new Error(reason)
      onError(error)
      if (rejectOnFailure) throw error
      return false
    }
    const generation = lifecycleGenerationRef.current
    const isCurrent = () => generation === lifecycleGenerationRef.current
    busyActionRef.current = action
    setBusyAction(action)
    try {
      let failure: unknown
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
          failure = error
          if (isCurrent()) onError(error)
        },
      })
      if (rejectOnFailure && !isCurrent()) throw new Error('文件会话已变化，请重新选择操作。')
      if (rejectOnFailure && !completed) throw failure ?? new Error('文件操作未能提交，请重试。')
      return completed && isCurrent()
    } finally {
      if (isCurrent()) {
        busyActionRef.current = ''
        setBusyAction('')
      }
    }
  }

  const openDestination = (
    operation: XDriveFileExplorerCopyMoveOperation,
    selected: readonly XDriveFileExplorerSelectionItem[],
    initialCrumbs: readonly XDriveFileExplorerDestinationCrumb[],
  ) => {
    if (disabled || busyActionRef.current) {
      onError(new Error('当前有文件操作正在进行，请稍后重试。'))
      return
    }
    const reason = xDriveFileExplorerSelectionActionDisabledReason({
      selected,
      selectedCount: new Set(selected.map((item) => Number(item.id))).size,
      nodeByID,
      maxItems,
      requireRevision: true,
    })
    if (reason) {
      onError(new Error(reason))
      return
    }
    if (!initialCrumbs.length || initialCrumbs.some((crumb) => !Number.isSafeInteger(crumb.id) || crumb.id <= 0)) {
      onError(new Error('无法确定当前文件夹，请稍后重试。'))
      return
    }
    const nodes = xDriveFileExplorerResolveSelectionNodes(selected, nodeByID)!
    const request: XDriveFileExplorerDestinationRequest = Object.freeze({
      operation,
      sources: Object.freeze(nodes.map(({ id, revision, name, type, parent_id }) => Object.freeze({ id, revision, name, type, parent_id }))),
      initialCrumbs: Object.freeze(initialCrumbs.map(({ id, name }) => Object.freeze({ id, name }))),
    })
    destinationRef.current = { request, lifecycleKey, clearSourceSearch: clearSearch }
    setDestinationRequest(request)
  }

  const closeDestination = () => {
    if (busyActionRef.current === 'destination') return
    destinationRef.current = null
    setDestinationRequest(null)
  }

  const submitDestination = async (
    targetCrumbs: readonly XDriveFileExplorerDestinationCrumb[],
  ): Promise<void> => {
    const context = destinationRef.current
    if (!context || context.lifecycleKey !== lifecycleKey) {
      throw new Error('目标选择已失效，请重新选择操作。')
    }
    const { request } = context
    const reason = xDriveFileExplorerDestinationTargetDisabledReason(request.operation, request.sources, targetCrumbs)
    if (reason) throw new Error(reason)
    const plan = xDriveFileExplorerDropOperationPlan(request.operation, [...request.sources], targetCrumbs.at(-1)!.id)
    if (plan.count !== request.sources.length) {
      throw new Error('无法提交全部所选项目，请重新选择目标文件夹。')
    }
    await runPlan('destination', plan, () => {
      context.clearSourceSearch()
      if (destinationRef.current === context) {
        destinationRef.current = null
        setDestinationRequest(null)
      }
    }, true)
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
  const pasteDisabledReason = currentID === undefined || currentID === null
    ? null
    : planDisabledReason(planPaste(currentID))

  return {
    busy,
    busyAction,
    canPaste: canPaste(disabled || busy || Boolean(pasteDisabledReason)),
    pasteDisabledReason,
    destinationRequest: destinationRef.current?.lifecycleKey === lifecycleKey ? destinationRequest : null,
    openDestination,
    closeDestination,
    submitDestination,
    pasteClipboard,
    dropItemsToFolder,
    dropItemsToCrumb,
  }
}
