import { xDriveFileOperationTerminal } from '../file-operations'
import type { XDriveFileOperation } from '../file-operations'

export type MediaGalleryDeleteOperation = Pick<XDriveFileOperation, 'id' | 'status'>

// The Web REST and Desktop Agent adapters return the durable file-operation
// receipt, not proof that any Node has already moved to Trash.
export function xDriveMediaGalleryDeleteOperation(
  value: unknown,
): MediaGalleryDeleteOperation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { id, status } = value as { id?: unknown; status?: unknown }
  if (typeof id !== 'string' || !id.trim()) return undefined
  if (
    status !== 'queued' &&
    status !== 'running' &&
    status !== 'cancel_requested' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'cancelled'
  ) return undefined
  return { id, status }
}

// Consume only *our own* pending operation IDs, not all Task Center completions.
// A missing snapshot or cancel_requested is not terminal. All final states
// trigger an authoritative Cleanup read; no physical bytes are inferred here.
export function xDriveMediaGallerySettledDeleteIDs(
  pendingIDs: readonly string[],
  operations: readonly MediaGalleryDeleteOperation[],
): string[] {
  if (!pendingIDs.length || !operations.length) return []
  const byID = new Map(operations.map((operation) => [operation.id, operation.status]))
  return pendingIDs.filter((id) => xDriveFileOperationTerminal(byID.get(id) ?? ''))
}
