import { useEffect, useRef, useState } from 'react'
import {
  xDriveFileExplorerCanPaste,
  xDriveFileExplorerClipboardFromItems,
  xDriveFileExplorerClipboardOperationPlan,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerClipboard,
  XDriveFileExplorerClipboardMode,
  XDriveFileExplorerCopyMoveOperation,
  XDriveFileExplorerOperationNode,
  XDriveFileExplorerSelectionItem,
} from '../file-explorer-controller'

export function useXDriveFileExplorerClipboard<
  TNode extends XDriveFileExplorerOperationNode,
>({
  lifecycleKey = '',
  nodeByID,
}: {
  lifecycleKey?: string
  nodeByID: ReadonlyMap<number, TNode>
}) {
  const [clipboard, setClipboard] = useState<XDriveFileExplorerClipboard<TNode> | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    setClipboard(null)
    return () => {
      generationRef.current += 1
    }
  }, [lifecycleKey])

  const setFromItems = (
    mode: XDriveFileExplorerClipboardMode,
    selected: XDriveFileExplorerSelectionItem[],
  ) => {
    const next = xDriveFileExplorerClipboardFromItems(mode, selected, nodeByID)
    if (!next) return
    generationRef.current += 1
    setClipboard(next)
  }

  const copyItems = (selected: XDriveFileExplorerSelectionItem[]) => {
    setFromItems('copy', selected)
  }

  const cutItems = (selected: XDriveFileExplorerSelectionItem[]) => {
    setFromItems('cut', selected)
  }

  // Recents/Favorites can own an authoritative node even when its directory
  // page is not mounted. Preserve that verified node/revision in this same
  // session-owned clipboard; do not depend on the active directory projection.
  const copyNodes = (nodes: readonly TNode[]) => {
    if (!nodes.length) return
    generationRef.current += 1
    setClipboard({ mode: 'copy', nodes: [...nodes] })
  }

  const planPaste = (
    targetParentID: number,
    operationOverride?: XDriveFileExplorerCopyMoveOperation,
  ) => {
    if (!clipboard?.nodes.length) return null
    const plan = xDriveFileExplorerClipboardOperationPlan(
      clipboard.mode,
      clipboard.nodes,
      targetParentID,
      operationOverride,
    )
    if (plan.count === 0) return null
    return {
      ...plan,
      clipboardGeneration: generationRef.current,
    }
  }

  const completePaste = (plan: {
    clearClipboard: boolean
    clipboardGeneration: number
  }) => {
    if (
      !plan.clearClipboard ||
      plan.clipboardGeneration !== generationRef.current
    ) return
    generationRef.current += 1
    setClipboard(null)
  }

  const clearClipboard = () => {
    generationRef.current += 1
    setClipboard(null)
  }

  return {
    copyItems,
    cutItems,
    copyNodes,
    planPaste,
    completePaste,
    clearClipboard,
    canPaste: (busy: boolean) => xDriveFileExplorerCanPaste(clipboard, busy),
  }
}
