import type {
  XDriveFileExplorerGroupBy,
  XDriveFileExplorerGroupIndex,
} from '../file-explorer-grouping'
import { xDriveFileExplorerGroupLabel } from '../file-explorer-grouping'

export type XDriveFileExplorerGroupLayoutEntry = {
  key: string
  label: string
  startIndex: number
  itemCount: number
  top: number
  headerHeight: number
  itemsTop: number
  rowCount: number
  itemsHeight: number
  height: number
}

export type XDriveFileExplorerGroupLayout = {
  groups: readonly XDriveFileExplorerGroupLayoutEntry[]
  totalHeight: number
  itemCount: number
  columns: number
  rowHeight: number
  rowGap: number
  padding: number
  groupHeaderHeight: number
  groupGap: number
}

export type XDriveFileExplorerVisibleGroupSegment = {
  group: XDriveFileExplorerGroupLayoutEntry
  headerVisible: boolean
  startIndex: number
  endIndex: number
  startRow: number
  endRow: number
  itemsTop: number
}

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function positiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : fallback
}

export function xDriveFileExplorerGroupIndexValid(
  groups: readonly XDriveFileExplorerGroupIndex[],
  itemCount: number,
) {
  const count = nonNegativeInteger(itemCount)
  if (count === 0) return groups.length === 0
  if (groups.length === 0) return false
  let expectedStart = 0
  for (const group of groups) {
    const groupCount = nonNegativeInteger(group.item_count)
    const start = nonNegativeInteger(group.start_index)
    if (!group.key.trim() || groupCount <= 0 || start !== expectedStart) return false
    expectedStart += groupCount
  }
  return expectedStart === count
}

export function xDriveCreateFileExplorerGroupLayout({
  groups,
  groupBy,
  itemCount,
  columns = 1,
  rowHeight,
  rowGap = 0,
  padding = 0,
  groupHeaderHeight = 30,
  groupGap = 8,
}: {
  groups: readonly XDriveFileExplorerGroupIndex[]
  groupBy: XDriveFileExplorerGroupBy
  itemCount: number
  columns?: number
  rowHeight: number
  rowGap?: number
  padding?: number
  groupHeaderHeight?: number
  groupGap?: number
}): XDriveFileExplorerGroupLayout | null {
  const count = nonNegativeInteger(itemCount)
  if (
    groupBy === 'none' ||
    !xDriveFileExplorerGroupIndexValid(groups, count)
  ) return null

  const columnCount = positiveInteger(columns, 1)
  const row = positiveInteger(rowHeight, 1)
  const gap = nonNegativeInteger(rowGap)
  const pad = nonNegativeInteger(padding)
  const header = positiveInteger(groupHeaderHeight, 30)
  const sectionGap = nonNegativeInteger(groupGap)
  const entries: XDriveFileExplorerGroupLayoutEntry[] = []
  let top = pad

  for (const group of groups) {
    const groupCount = nonNegativeInteger(group.item_count)
    const rowCount = Math.ceil(groupCount / columnCount)
    const itemsHeight = rowCount <= 0
      ? 0
      : rowCount * row + Math.max(0, rowCount - 1) * gap
    const height = header + itemsHeight + sectionGap
    entries.push({
      key: group.key,
      label: xDriveFileExplorerGroupLabel(groupBy, group.key),
      startIndex: nonNegativeInteger(group.start_index),
      itemCount: groupCount,
      top,
      headerHeight: header,
      itemsTop: top + header,
      rowCount,
      itemsHeight,
      height,
    })
    top += height
  }

  return {
    groups: entries,
    totalHeight: Math.max(pad * 2, top + pad - sectionGap),
    itemCount: count,
    columns: columnCount,
    rowHeight: row,
    rowGap: gap,
    padding: pad,
    groupHeaderHeight: header,
    groupGap: sectionGap,
  }
}

export function xDriveFileExplorerGroupForIndex(
  layout: XDriveFileExplorerGroupLayout,
  index: number,
) {
  const target = nonNegativeInteger(index)
  let low = 0
  let high = layout.groups.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const group = layout.groups[mid]
    if (target < group.startIndex) {
      high = mid - 1
      continue
    }
    if (target >= group.startIndex + group.itemCount) {
      low = mid + 1
      continue
    }
    return group
  }
  return null
}

export function xDriveFileExplorerGroupedItemTop(
  layout: XDriveFileExplorerGroupLayout,
  index: number,
) {
  const group = xDriveFileExplorerGroupForIndex(layout, index)
  if (!group) return null
  const offset = Math.max(0, index - group.startIndex)
  const row = Math.floor(offset / layout.columns)
  return group.itemsTop + row * (layout.rowHeight + layout.rowGap)
}

export function xDriveFileExplorerVisibleGroupSegments(
  layout: XDriveFileExplorerGroupLayout,
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): XDriveFileExplorerVisibleGroupSegment[] {
  const top = Math.max(0, scrollTop - Math.max(0, overscanPx))
  const bottom = Math.max(top, scrollTop + Math.max(1, viewportHeight) + Math.max(0, overscanPx))
  const rowStep = layout.rowHeight + layout.rowGap
  const segments: XDriveFileExplorerVisibleGroupSegment[] = []

  for (const group of layout.groups) {
    const groupBottom = group.top + group.height
    if (groupBottom < top) continue
    if (group.top > bottom) break

    const headerBottom = group.top + group.headerHeight
    const headerVisible = headerBottom >= top && group.top <= bottom
    const itemsBottom = group.itemsTop + group.itemsHeight
    if (group.itemCount <= 0 || itemsBottom < top || group.itemsTop > bottom) {
      if (headerVisible) {
        segments.push({
          group,
          headerVisible: true,
          startIndex: group.startIndex,
          endIndex: group.startIndex,
          startRow: 0,
          endRow: 0,
          itemsTop: group.itemsTop,
        })
      }
      continue
    }

    const firstRow = Math.max(
      0,
      Math.min(
        group.rowCount - 1,
        Math.floor(Math.max(0, top - group.itemsTop) / rowStep),
      ),
    )
    const lastRow = Math.max(
      firstRow,
      Math.min(
        group.rowCount - 1,
        Math.floor(Math.max(0, bottom - group.itemsTop - 0.001) / rowStep),
      ),
    )
    const startIndex = group.startIndex + firstRow * layout.columns
    const endIndex = Math.min(
      group.startIndex + group.itemCount,
      group.startIndex + (lastRow + 1) * layout.columns,
    )
    segments.push({
      group,
      headerVisible,
      startIndex,
      endIndex,
      startRow: firstRow,
      endRow: lastRow + 1,
      itemsTop: group.itemsTop + firstRow * rowStep,
    })
  }

  return segments
}
