import type { Node } from './models'
import {
  xDriveFileExplorerSelectionActionDisabledReason,
  type XDriveFileExplorerSelectionItem,
} from './file-explorer-controller'

// The same FileExplorer operation limits apply in Wide Web, Compact Web/PWA
// and Desktop. Platform-specific download formats and native write support
// remain additional Host gates: never infer native permissions from this policy.
const MUTATING_SELECTION_ACTIONS = new Set([
  'copy', 'cut', 'delete', 'move-to', 'copy-to',
])

export type XDriveFileExplorerSelectionAdmissionInput<
  TNode extends Pick<Node, 'id'> & Partial<Pick<Node, 'revision'>>,
> = {
  action: string
  selected: readonly XDriveFileExplorerSelectionItem[]
  /** Whole logical selection, not just the currently materialized page. */
  selectedCount: number
  nodeByID: ReadonlyMap<number, TNode>
  /**
   * Browser download is bounded to 1000 entries. Desktop has additional
   * archive/folder capabilities and must opt in to a matching limit after
   * checking its own real Agent support.
   */
  downloadMaxItems?: number
}

/**
 * Host-neutral admission for a user-requested Files selection operation.
 * Fail closed on incomplete virtual selections or missing Node revisions;
 * only Host/Server/Agent can decide if a real mutation is authorized.
 */
export function xDriveFileExplorerSelectionAdmissionReason<
  TNode extends Pick<Node, 'id'> & Partial<Pick<Node, 'revision'>>,
>({
  action, selected, selectedCount, nodeByID, downloadMaxItems,
}: XDriveFileExplorerSelectionAdmissionInput<TNode>): string | null {
  const mutation = MUTATING_SELECTION_ACTIONS.has(action)
  const maxItems = mutation ? 200
    : action === 'manage-tags' ? 500
      : action === 'download' ? downloadMaxItems
        : undefined
  return xDriveFileExplorerSelectionActionDisabledReason({
    selected, selectedCount, nodeByID, maxItems, requireRevision: mutation,
  })
}

/**
 * One selected-row admission ticket for Browser Wide/Compact and Desktop.
 * Count *distinct logical node IDs*, not materialized/virtual rows. The
 * existing shared reason callback decides stale Owner/version/limit rejection;
 * the Host still supplies stronger native capability and Server authority.
 */
export function xDriveFileExplorerSelectionRequest<
  TItem extends XDriveFileExplorerSelectionItem,
  TAction extends string,
>(
  action: TAction,
  selected: readonly TItem[],
  getReason: (
    action: TAction,
    selected: readonly TItem[],
    count: number,
  ) => string | null,
): { allowed: boolean; reason: string | null; selectedCount: number } {
  const selectedCount = new Set(selected.map((item) => Number(item.id))).size
  const reason = getReason(action, selected, selectedCount)
  return { allowed: !reason, reason, selectedCount }
}
