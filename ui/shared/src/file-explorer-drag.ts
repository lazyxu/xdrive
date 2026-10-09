export const XDRIVE_FILE_EXPLORER_DRAG_MIME =
  'application/x-xdrive-fileexplorer'

export type XDriveFileExplorerDragID = string | number

export function xDriveFileExplorerEncodeDragItems(
  items: readonly { id: XDriveFileExplorerDragID }[],
) {
  return JSON.stringify({
    version: 1,
    ids: items.map((item) => item.id),
  })
}

export function xDriveFileExplorerDecodeDragIDs(
  value: string,
): XDriveFileExplorerDragID[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown
      ids?: unknown
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.ids)) return []
    const out: XDriveFileExplorerDragID[] = []
    const seen = new Set<string>()
    for (const raw of parsed.ids.slice(0, 10_000)) {
      if (
        !(
          (typeof raw === 'number' && Number.isSafeInteger(raw)) ||
          (typeof raw === 'string' && raw.length > 0)
        )
      ) continue
      const key = typeof raw === 'number' ? `n:${raw}` : `s:${raw}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(raw)
    }
    return out
  } catch {
    return []
  }
}
