import { useState } from 'react'
import {
  xDriveFileExplorerCanPaste,
  xDriveFileExplorerClipboardFromItems,
  xDriveFileExplorerClipboardOperationPlan,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerClipboard,
  XDriveFileExplorerClipboardMode,
  XDriveFileExplorerOperationNode,
  XDriveFileExplorerSelectionItem,
} from '../file-explorer-controller'

export function useXDriveFileExplorerClipboard<
  TNode extends XDriveFileExplorerOperationNode,
>({
  nodeByID,
}: {
  nodeByID: ReadonlyMap<number, TNode>
}) {
  const [clipboard, setClipboard] = useState<XDriveFileExplorerClipboard<TNode> | null>(null)

  const setFromItems = (
    mode: XDriveFileExplorerClipboardMode,
    selected: XDriveFileExplorerSelectionItem[],
  ) => {
    setClipboard((current) => (
      xDriveFileExplorerClipboardFromItems(mode, selected, nodeByID) ?? current
    ))
  }

  const copyItems = (selected: XDriveFileExplorerSelectionItem[]) => {
    setFromItems('copy', selected)
  }

  const cutItems = (selected: XDriveFileExplorerSelectionItem[]) => {
    setFromItems('cut', selected)
  }

  const planPaste = (targetParentID: number) => {
    if (!clipboard?.nodes.length) return null
    return xDriveFileExplorerClipboardOperationPlan(
      clipboard.mode,
      clipboard.nodes,
      targetParentID,
    )
  }

  const completePaste = (plan: { clearClipboard: boolean }) => {
    if (plan.clearClipboard) setClipboard(null)
  }

  const clearClipboard = () => {
    setClipboard(null)
  }

  return {
    copyItems,
    cutItems,
    planPaste,
    completePaste,
    clearClipboard,
    canPaste: (busy: boolean) => xDriveFileExplorerCanPaste(clipboard, busy),
  }
}
