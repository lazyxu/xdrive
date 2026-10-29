import type {
  XDriveStorageVerificationRun,
  XDriveStorageVerificationRunPage,
} from './admin-management'

function canonicalRunID(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) return false
  // This is a uint64 identifier, not a JavaScript number. Lexical exactness
  // and BigInt bounds avoid precision loss after Number.MAX_SAFE_INTEGER.
  try {
    return BigInt(value) <= 18446744073709551615n
  } catch {
    return false
  }
}

function smallerID(a: string, b: string): boolean {
  return a.length !== b.length ? a.length < b.length : a < b
}

export function xDriveNormalizeStorageVerificationHistory(value: unknown):
  XDriveStorageVerificationRunPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Partial<XDriveStorageVerificationRunPage>
  if (v.protocol !== 'xdrive-storage-verification-history-v1' ||
      !Array.isArray(v.items) || v.items.length > 50) return null
  let previous = ''
  const rows: XDriveStorageVerificationRun[] = []
  for (const item of v.items) {
    if (!item || typeof item !== 'object' ||
        !canonicalRunID(item.run_id) ||
        (item.mode !== 'fast' && item.mode !== 'deep') ||
        !['success', 'issues', 'failed', 'partial', 'cancelled'].includes(item.state) ||
        typeof item.started_at !== 'string' ||
        typeof item.finished_at !== 'string') return null
    const start = Date.parse(item.started_at)
    const end = Date.parse(item.finished_at)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start ||
        (previous && !smallerID(item.run_id, previous))) return null
    previous = item.run_id
    rows.push({
      run_id: item.run_id, mode: item.mode, state: item.state,
      started_at: item.started_at, finished_at: item.finished_at,
    })
  }
  if (v.next_cursor !== undefined &&
      (!canonicalRunID(v.next_cursor) ||
        rows.length === 0 || v.next_cursor !== rows[rows.length - 1].run_id)) return null
  return {
    protocol: 'xdrive-storage-verification-history-v1',
    items: rows,
    ...(v.next_cursor ? { next_cursor: v.next_cursor } : {}),
  }
}

export function xDriveAppendStorageVerificationHistory(
  current: XDriveStorageVerificationRunPage,
  next: XDriveStorageVerificationRunPage,
): XDriveStorageVerificationRunPage | null {
  if (!current.next_cursor ||
      (next.items.length > 0 &&
        !smallerID(next.items[0].run_id, current.next_cursor))) return null
  return {
    protocol: 'xdrive-storage-verification-history-v1',
    items: [...current.items, ...next.items],
    ...(next.next_cursor ? { next_cursor: next.next_cursor } : {}),
  }
}
