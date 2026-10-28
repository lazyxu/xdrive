/**
 * Pure, Host-neutral file hydration presentation. Desktop provides its
 * authenticated local Agent transfer snapshot; future Hosts may use this
 * only when they have real device-side availability evidence.
 *
 * No Agent IPC, URL, Owner ID, timer or durable transfer is created here.
 */
export type XDriveFileExplorerDeviceAvailability = {
  Syncing?: boolean
  Mode?: string
  InSync?: boolean
}
export type XDriveFileExplorerDeviceHydrationTransfer = {
  kind: string
  state: string
  path?: string
  bytes_total: number
  bytes_done: number
}

export function xDriveFileExplorerDeviceStatusLabel(
  state: XDriveFileExplorerDeviceAvailability,
  syncing = false,
): string {
  if (syncing || state.Syncing || state.Mode === 'syncing') return '正在同步'
  if (state.InSync) return '已同步'
  return '待同步'
}

/** Windows extended UNC/native path aliases must resolve to one local key. */
export function xDriveFileExplorerDeviceHydrationPathKey(value?: string): string {
  let normalized = (value ?? '').trim().replace(/\\/g, '/')
  if (normalized.toLowerCase().startsWith('//?/unc/')) {
    normalized = '//' + normalized.slice(8)
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice(4)
  }
  // UNC and POSIX roots are distinct identities. The original Desktop
  // implementation collapsed "//NAS/share" into "/nas/share", which could
  // attach a hydration transfer to an unrelated local path.
  if (normalized.startsWith('//')) {
    return '//' + normalized.slice(2).replace(/\/+/g, '/')
      .replace(/\/$/, '').toLowerCase()
  }
  if (/^[A-Za-z]:\/$/.test(normalized)) return normalized.toLowerCase()
  if (normalized === '/') return '/'
  return normalized.replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase()
}

/**
 * Preserve the first running hydration for a canonical path. The map contains
 * only transient progress and never schedules, cancels or mutates Agent jobs.
 */
export function xDriveFileExplorerDeviceHydrationProgress(
  transfers: readonly XDriveFileExplorerDeviceHydrationTransfer[],
): Map<string, number | null> {
  const byPath = new Map<string, number | null>()
  for (const transfer of transfers) {
    if (transfer.kind !== 'hydration' || transfer.state !== 'running') continue
    const key = xDriveFileExplorerDeviceHydrationPathKey(transfer.path)
    if (!key || byPath.has(key)) continue
    const total = Number.isFinite(transfer.bytes_total)
      ? Math.max(0, transfer.bytes_total) : 0
    const done = Number.isFinite(transfer.bytes_done)
      ? Math.max(0, transfer.bytes_done) : 0
    byPath.set(key, total > 0
      ? Math.max(0, Math.min(100, (done / total) * 100)) : null)
  }
  return byPath
}
