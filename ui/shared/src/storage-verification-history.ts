import type {
  XDriveStorageVerificationRun,
  XDriveStorageVerificationRunPage,
  XDriveStorageVerificationRunDetail,
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

/** Canonical decimal uint64; pass unchanged from the trusted history index. */
export function xDriveValidStorageVerificationRunID(value: unknown): value is string {
  return canonicalRunID(value)
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

/** Historical reports are optional. Reject forged/unsafe counters rather than
 * converting malformed evidence into an apparently clean integrity result. */
export function xDriveNormalizeStorageVerificationDetail(
  value: unknown,
  expected: XDriveStorageVerificationRun,
): XDriveStorageVerificationRunDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<XDriveStorageVerificationRunDetail>
  if (raw.protocol !== 'xdrive-storage-verification-detail-v1' || !raw.run) return null
  const page = xDriveNormalizeStorageVerificationHistory({
    protocol: 'xdrive-storage-verification-history-v1',
    items: [raw.run],
  })
  const run = page?.items[0]
  if (!run || run.run_id !== expected.run_id || run.mode !== expected.mode ||
      run.state !== expected.state || run.started_at !== expected.started_at ||
      run.finished_at !== expected.finished_at) return null
  const evidence = raw.evidence
  if (evidence !== undefined) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
        evidence.protocol !== 'xdrive-storage-integrity-evidence-v1' ||
        evidence.mode !== run.mode) return null
    const numericFields = [
      'referenced_files', 'referenced_versions', 'physical_objects', 'unique_reference_keys',
      'hashed_objects', 'hashed_bytes', 'missing_objects', 'size_mismatches',
      'duplicate_references', 'reference_drifts', 'orphan_objects', 'hash_mismatches',
      'issue_count',
    ] as const
    const data = evidence as unknown as Record<string, unknown>
    if (Object.keys(data).some(key =>
      key !== 'protocol' && key !== 'mode' && !(numericFields as readonly string[]).includes(key))) return null
    for (const key of numericFields) {
      const amount = data[key]
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null
    }
    const issueSum = evidence.missing_objects + evidence.size_mismatches +
      evidence.duplicate_references + evidence.reference_drifts +
      evidence.orphan_objects + evidence.hash_mismatches
    if (!Number.isSafeInteger(issueSum) || issueSum !== evidence.issue_count ||
        (run.mode === 'fast' && (evidence.hashed_objects !== 0 ||
          evidence.hashed_bytes !== 0 || evidence.hash_mismatches !== 0))) return null
  }
  return {
    protocol: 'xdrive-storage-verification-detail-v1',
    run,
    ...(evidence ? { evidence } : {}),
  }
}
