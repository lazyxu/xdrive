/** Bounded, index-based inline tree projection for FileExplorer List.
 *
 * A directory contributes one logical range. Expanded directories insert
 * another logical range immediately after their row. No directory's entries
 * are materialized just to calculate its scroll geometry.
 */
export type XDriveFileExplorerInlineSource<TItem> = {
  ownerID: number
  itemCount: number
  itemAt: (index: number) => TItem | undefined
}

export type XDriveFileExplorerInlineExpansion<TItem> = XDriveFileExplorerInlineSource<TItem> & {
  parentID: number
  parentIndex: number
}

export type XDriveFileExplorerInlineSegment<TItem> = {
  ownerID: number
  itemAt: (index: number) => TItem | undefined
  sourceStart: number
  flatStart: number
  flatEnd: number
  depth: number
}

export type XDriveFileExplorerInlineLayout<TItem> = {
  itemCount: number
  segments: readonly XDriveFileExplorerInlineSegment<TItem>[]
}

export type XDriveFileExplorerInlineCell<TItem> = {
  ownerID: number
  sourceIndex: number
  depth: number
  item: TItem | undefined
}

export type XDriveFileExplorerInlineVisibleRange = {
  ownerID: number
  startIndex: number
  endIndex: number
}

function validCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** O(expanded branches), not O(root/child directory itemCount). */
export function xDriveFileExplorerInlineLayout<TItem>(
  root: XDriveFileExplorerInlineSource<TItem>,
  expansions: readonly XDriveFileExplorerInlineExpansion<TItem>[],
): XDriveFileExplorerInlineLayout<TItem> {
  const children = new Map<number, XDriveFileExplorerInlineExpansion<TItem>[]>()
  for (const branch of expansions) {
    if (!Number.isSafeInteger(branch.ownerID) || !Number.isSafeInteger(branch.parentID) ||
        !Number.isSafeInteger(branch.parentIndex) || branch.parentIndex < 0 ||
        branch.ownerID === root.ownerID) continue
    const siblings = children.get(branch.parentID) ?? []
    siblings.push(branch)
    children.set(branch.parentID, siblings)
  }
  for (const branches of children.values()) {
    branches.sort((a, b) => a.parentIndex - b.parentIndex)
  }

  const segments: XDriveFileExplorerInlineSegment<TItem>[] = []
  const ancestors = new Set<number>()
  let total = 0

  const append = (source: XDriveFileExplorerInlineSource<TItem>, depth: number) => {
    if (ancestors.has(source.ownerID) || depth > 64) return
    ancestors.add(source.ownerID)
    const count = validCount(source.itemCount)
    let cursor = 0
    const push = (start: number, end: number) => {
      if (end <= start) return
      const size = end - start
      if (!Number.isSafeInteger(total + size)) {
        throw new RangeError('FileExplorer inline tree exceeds safe logical index range.')
      }
      segments.push({
        ownerID: source.ownerID, itemAt: source.itemAt,
        sourceStart: start, flatStart: total, flatEnd: total + size, depth,
      })
      total += size
    }
    for (const branch of children.get(source.ownerID) ?? []) {
      if (branch.parentIndex < cursor || branch.parentIndex >= count ||
          ancestors.has(branch.ownerID)) continue
      push(cursor, branch.parentIndex + 1)
      append(branch, depth + 1)
      cursor = branch.parentIndex + 1
    }
    push(cursor, count)
    ancestors.delete(source.ownerID)
  }
  append(root, 0)
  return { itemCount: total, segments }
}

/** Binary search into run-length directory spans; unloaded rows remain placeholders. */
export function xDriveFileExplorerInlineCellAt<TItem>(
  layout: XDriveFileExplorerInlineLayout<TItem>,
  flatIndex: number,
): XDriveFileExplorerInlineCell<TItem> | undefined {
  if (!Number.isSafeInteger(flatIndex) || flatIndex < 0 || flatIndex >= layout.itemCount) return undefined
  let lo = 0
  let hi = layout.segments.length - 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const segment = layout.segments[mid]
    if (flatIndex < segment.flatStart) hi = mid - 1
    else if (flatIndex >= segment.flatEnd) lo = mid + 1
    else {
      const sourceIndex = segment.sourceStart + flatIndex - segment.flatStart
      return { ownerID: segment.ownerID, sourceIndex, depth: segment.depth,
        item: segment.itemAt(sourceIndex) }
    }
  }
  return undefined
}

/** Project only the visible flat interval to bounded source index intervals. */
export function xDriveFileExplorerInlineVisibleRanges<TItem>(
  layout: XDriveFileExplorerInlineLayout<TItem>,
  startIndex: number,
  endIndex: number,
): XDriveFileExplorerInlineVisibleRange[] {
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || layout.itemCount === 0) return []
  const start = Math.max(0, Math.trunc(startIndex))
  const end = Math.min(layout.itemCount - 1, Math.trunc(endIndex))
  if (end < start) return []
  const ranges: XDriveFileExplorerInlineVisibleRange[] = []
  for (const segment of layout.segments) {
    if (segment.flatEnd <= start) continue
    if (segment.flatStart > end) break
    const sourceStart = segment.sourceStart + Math.max(0, start - segment.flatStart)
    const sourceEnd = segment.sourceStart + Math.min(segment.flatEnd - 1, end) - segment.flatStart
    const previous = ranges[ranges.length - 1]
    if (previous && previous.ownerID === segment.ownerID && sourceStart === previous.endIndex + 1) {
      previous.endIndex = sourceEnd
    } else {
      ranges.push({ ownerID: segment.ownerID, startIndex: sourceStart, endIndex: sourceEnd })
    }
  }
  return ranges
}


/** Map authoritative Server root-group intervals into child-augmented flat
 * List indices. Expanded descendants remain in their parent root section.
 * This reads only O(expansion spans + group count), never itemAt(). */
export function xDriveFileExplorerInlineGroupIndex<TItem>(
  layout: XDriveFileExplorerInlineLayout<TItem>,
  rootOwnerID: number,
  groups: readonly { key: string; item_count: number; start_index: number }[],
  rootCount: number,
): Array<{ key: string; item_count: number; start_index: number }> | null {
  if (!Number.isSafeInteger(rootCount) || rootCount < 0) return null
  let expected = 0
  for (const group of groups) {
    if (!group.key.trim() || !Number.isSafeInteger(group.item_count) || group.item_count <= 0 ||
        !Number.isSafeInteger(group.start_index) || group.start_index !== expected) return null
    expected += group.item_count
  }
  if (expected !== rootCount) return null
  if (rootCount === 0) return []

  const rootSegments = layout.segments.filter(segment => segment.ownerID === rootOwnerID)
  let cursor = 0
  const flatForRootIndex = (rootIndex: number) => {
    if (rootIndex === rootCount) return layout.itemCount
    while (cursor < rootSegments.length) {
      const segment = rootSegments[cursor]
      const end = segment.sourceStart + segment.flatEnd - segment.flatStart
      if (rootIndex < segment.sourceStart) return null
      if (rootIndex < end) return segment.flatStart + rootIndex - segment.sourceStart
      cursor += 1
    }
    return null
  }
  const augmented = [] as Array<{ key: string; item_count: number; start_index: number }>
  for (const group of groups) {
    const start = flatForRootIndex(group.start_index)
    const end = flatForRootIndex(group.start_index + group.item_count)
    if (start === null || end === null || end <= start) return null
    augmented.push({ key: group.key, start_index: start, item_count: end - start })
  }
  return augmented
}
