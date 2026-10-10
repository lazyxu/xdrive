import type { MediaTimelineGroupIndex } from '../models'
import {
  XDRIVE_MEDIA_GALLERY_GRID_GAP,
  XDRIVE_MEDIA_GALLERY_MIN_TILE_WIDTH,
  xDriveMediaGalleryGridMetrics,
} from './MediaGalleryVirtualGrid'

export const XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_HEIGHT = 32
export const XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP = 8
export const XDRIVE_MEDIA_GALLERY_TIMELINE_GROUP_GAP = 20
export const XDRIVE_MEDIA_GALLERY_TIMELINE_OVERSCAN_ROWS = 2

export type XDriveMediaGalleryTimelineLayoutGroup = {
  key: string
  label: string
  itemCount: number
  startIndex: number
  top: number
  height: number
  headerHeight: number
  itemsTop: number
  itemsHeight: number
  rowCount: number
}

export type XDriveMediaGalleryTimelineLayout = {
  columns: number
  columnWidth: number
  rowStep: number
  totalHeight: number
  groups: XDriveMediaGalleryTimelineLayoutGroup[]
}

export type XDriveMediaGalleryTimelineSegment = {
  groupIndex: number
  startRow: number
  endRow: number
  startIndex: number
  endIndex: number
}

export type XDriveMediaGalleryTimelineWindow = {
  startIndex: number
  endIndex: number
  segments: XDriveMediaGalleryTimelineSegment[]
}

function nonNegative(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

export function xDriveMediaGalleryTimelineGroupLabel(key: string) {
  if (key === 'unknown') return '日期未知'
  const year = /^(\d{4})$/.exec(key)
  if (year) return `${Number(year[1])}年`
  const month = /^(\d{4})-(\d{2})$/.exec(key)
  if (month) return `${Number(month[1])}年${Number(month[2])}月`
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (day) {
    return `${Number(day[1])}年${Number(day[2])}月${Number(day[3])}日`
  }
  return key
}

export function xDriveMediaGalleryTimelineLayout({
  width,
  groups,
  minColumnWidth = XDRIVE_MEDIA_GALLERY_MIN_TILE_WIDTH,
  minColumns,
  baselineColumns,
  referenceColumnWidth,
}: {
  width: number
  groups: readonly MediaTimelineGroupIndex[]
  minColumnWidth?: number
  minColumns?: number
  baselineColumns?: number
  referenceColumnWidth?: number
}): XDriveMediaGalleryTimelineLayout {
  const grid = xDriveMediaGalleryGridMetrics({
    width,
    itemCount: 1,
    minColumnWidth,
    minColumns,
    baselineColumns,
    referenceColumnWidth,
  })
  const layoutGroups: XDriveMediaGalleryTimelineLayoutGroup[] = []
  let top = 0

  for (const group of groups) {
    const itemCount = nonNegativeInteger(group.item_count)
    if (itemCount === 0) continue
    const startIndex = nonNegativeInteger(group.start_index)
    const rowCount = Math.ceil(itemCount / grid.columns)
    const itemsTop = top +
      XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_HEIGHT +
      XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP
    const itemsHeight = rowCount > 0
      ? rowCount * grid.columnWidth +
        Math.max(0, rowCount - 1) * XDRIVE_MEDIA_GALLERY_GRID_GAP
      : 0
    const height =
      XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_HEIGHT +
      XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_GAP +
      itemsHeight

    layoutGroups.push({
      key: group.key,
      label: xDriveMediaGalleryTimelineGroupLabel(group.key),
      itemCount,
      startIndex,
      top,
      height,
      headerHeight: XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_HEIGHT,
      itemsTop,
      itemsHeight,
      rowCount,
    })
    top += height + XDRIVE_MEDIA_GALLERY_TIMELINE_GROUP_GAP
  }

  return {
    columns: grid.columns,
    columnWidth: grid.columnWidth,
    rowStep: grid.rowStep,
    totalHeight: layoutGroups.length > 0
      ? Math.max(0, top - XDRIVE_MEDIA_GALLERY_TIMELINE_GROUP_GAP)
      : 0,
    groups: layoutGroups,
  }
}

export function xDriveMediaGalleryTimelineWindow({
  layout,
  visibleTop,
  visibleBottom,
  overscanRows = XDRIVE_MEDIA_GALLERY_TIMELINE_OVERSCAN_ROWS,
}: {
  layout: XDriveMediaGalleryTimelineLayout
  visibleTop: number
  visibleBottom: number
  overscanRows?: number
}): XDriveMediaGalleryTimelineWindow {
  if (layout.groups.length === 0) {
    return { startIndex: 0, endIndex: 0, segments: [] }
  }

  const top = nonNegative(Math.min(visibleTop, visibleBottom))
  const bottom = Math.max(top, nonNegative(Math.max(visibleTop, visibleBottom)))
  const overscan = nonNegativeInteger(overscanRows) * layout.rowStep
  const retainedTop = Math.max(0, top - overscan)
  const retainedBottom = Math.min(layout.totalHeight, bottom + overscan)
  const segments: XDriveMediaGalleryTimelineSegment[] = []
  let startIndex = Number.POSITIVE_INFINITY
  let endIndex = 0

  let low = 0
  let high = layout.groups.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const group = layout.groups[middle]
    if (group.top + group.height < retainedTop) low = middle + 1
    else high = middle
  }

  for (
    let groupIndex = low;
    groupIndex < layout.groups.length;
    groupIndex += 1
  ) {
    const group = layout.groups[groupIndex]
    if (group.top > retainedBottom) break

    let startRow = 0
    let endRow = 0
    const itemsBottom = group.itemsTop + group.itemsHeight
    if (
      group.itemsHeight > 0 &&
      retainedBottom > group.itemsTop &&
      retainedTop < itemsBottom
    ) {
      const localTop = Math.max(0, retainedTop - group.itemsTop)
      const localBottom = Math.max(
        localTop,
        Math.min(group.itemsHeight, retainedBottom - group.itemsTop),
      )
      const firstVisibleRow = Math.min(
        group.rowCount - 1,
        Math.max(0, Math.floor(localTop / layout.rowStep)),
      )
      const lastVisibleRow = Math.min(
        group.rowCount - 1,
        Math.max(
          firstVisibleRow,
          Math.ceil(localBottom / layout.rowStep) - 1,
        ),
      )
      startRow = firstVisibleRow
      endRow = lastVisibleRow + 1
    }

    const segmentStart = Math.min(
      group.startIndex + group.itemCount,
      group.startIndex + startRow * layout.columns,
    )
    const segmentEnd = endRow > startRow
      ? Math.min(
          group.startIndex + group.itemCount,
          group.startIndex + endRow * layout.columns,
        )
      : segmentStart

    if (segmentEnd > segmentStart) {
      startIndex = Math.min(startIndex, segmentStart)
      endIndex = Math.max(endIndex, segmentEnd)
    }
    segments.push({
      groupIndex,
      startRow,
      endRow,
      startIndex: segmentStart,
      endIndex: segmentEnd,
    })
  }

  return {
    startIndex: Number.isFinite(startIndex) ? startIndex : 0,
    endIndex,
    segments,
  }
}

export function xDriveMediaGalleryTimelineIndexVisible(
  index: number,
  window: XDriveMediaGalleryTimelineWindow,
) {
  return window.segments.some((segment) => (
    index >= segment.startIndex && index < segment.endIndex
  ))
}
