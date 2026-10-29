/**
 * Host-neutral disposable availability read for a Files workspace. The Host
 * provides a real authenticated read port; this helper neither holds credentials
 * nor manufactures local-device permissions for other platforms.
 *
 * All results are scoped to one Owner/page generation by isCurrent. The
 * caller owns that generation and MUST retire it on account, root or route
 * changes. User-owned transfers and backups are never part of this lifecycle.
 */
export type XDriveFileExplorerHostAvailabilityRequest = Readonly<{
  nodeID: number
  path: string
}>

export type XDriveFileExplorerHostAvailabilityItem<TState> = Readonly<{
  path: string
  availability?: TState
  error?: string
}>

export type XDriveFileExplorerHostAvailabilityBatch<TState> =
  | Readonly<{ ok: true; data: { items: readonly XDriveFileExplorerHostAvailabilityItem<TState>[] } }>
  | Readonly<{ ok: false; error: { code?: string } }>

export type XDriveFileExplorerHostAvailabilityEntry<TState> = Readonly<{
  path: string
  state?: TState
  error?: string
}>

export type XDriveFileExplorerHostAvailabilityOutcome<TState> =
  | Readonly<{
    kind: 'complete'
    byID: Map<number, XDriveFileExplorerHostAvailabilityEntry<TState>>
  }>
  | Readonly<{ kind: 'error'; code?: string }>

export const XDRIVE_FILE_EXPLORER_HOST_AVAILABILITY_BATCH_LIMIT = 2048

/**
 * Returns null for retired reads, an error for failed/unreadable Host responses,
 * or only verified rows for the current requested IDs. No status is synthesized
 * when a Host returns an absent row; the UI retains an unknown badge.
 */
export async function xDriveReadFileExplorerHostAvailability<TState>({
  requests, readBatch, isCurrent,
}: {
  requests: readonly XDriveFileExplorerHostAvailabilityRequest[]
  readBatch: (paths: string[]) => Promise<XDriveFileExplorerHostAvailabilityBatch<TState>>
  isCurrent: () => boolean
}): Promise<XDriveFileExplorerHostAvailabilityOutcome<TState> | null> {
  if (!isCurrent()) return null
  // FileExplorer item IDs may originate in projections; never coerce a string
  // or unsafe number into a real Server Node identity.
  const byID = new Map<number, string>()
  for (const request of requests) {
    if (Number.isSafeInteger(request.nodeID) && request.nodeID > 0 &&
        typeof request.path === 'string' && request.path.length > 0) {
      byID.set(request.nodeID, request.path)
    }
  }
  const paths = [...new Set(byID.values())]
  const responseByPath = new Map<string, XDriveFileExplorerHostAvailabilityItem<TState>>()
  for (let offset = 0; offset < paths.length; offset += XDRIVE_FILE_EXPLORER_HOST_AVAILABILITY_BATCH_LIMIT) {
    if (!isCurrent()) return null
    try {
      const batchPaths = paths.slice(offset, offset + XDRIVE_FILE_EXPLORER_HOST_AVAILABILITY_BATCH_LIMIT)
      const result = await readBatch(batchPaths)
      if (!isCurrent()) return null
      if (!result.ok) return { kind: 'error', code: result.error.code }
      if (!Array.isArray(result.data?.items)) return { kind: 'error' }
      const allowed = new Set(batchPaths)
      for (const item of result.data.items) {
        if (!item || typeof item.path !== 'string' || !allowed.has(item.path) ||
            responseByPath.has(item.path)) continue
        if (item.availability != null || typeof item.error === 'string') {
          responseByPath.set(item.path, item)
        }
      }
    } catch {
      if (!isCurrent()) return null
      // Never expose a rejected Electron/Host error containing a private path.
      return { kind: 'error' }
    }
  }
  if (!isCurrent()) return null
  const resolved = new Map<number, XDriveFileExplorerHostAvailabilityEntry<TState>>()
  for (const [nodeID, path] of byID) {
    const row = responseByPath.get(path)
    if (row?.availability != null) resolved.set(nodeID, { path, state: row.availability })
    else if (typeof row?.error === 'string') resolved.set(nodeID, { path, error: row.error })
  }
  return { kind: 'complete', byID: resolved }
}
