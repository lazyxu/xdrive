export const XDRIVE_FILE_EXPLORER_MEDIA_DETAILS_BATCH_LIMIT = 200

export type XDriveFileExplorerMediaDetailsRef = {
  id: number
  revision: number
}

export type XDriveFileExplorerMediaDetails = XDriveFileExplorerMediaDetailsRef & {
  width?: number
  height?: number
  duration_ms?: number
}

export function xDriveFileExplorerMediaDetailsKey(
  value: XDriveFileExplorerMediaDetailsRef,
) {
  return `${value.id}:${value.revision}`
}

export function xDriveFileExplorerMediaDetailsRefs(
  items: readonly {
    id: string | number
    kind: 'dir' | 'file'
    revision?: string | number
  }[],
): XDriveFileExplorerMediaDetailsRef[] {
  const refs: XDriveFileExplorerMediaDetailsRef[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'file') continue
    const id = Number(item.id)
    const revision = Number(item.revision)
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isSafeInteger(revision) ||
      revision <= 0
    ) continue
    const ref = { id, revision }
    const key = xDriveFileExplorerMediaDetailsKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}
