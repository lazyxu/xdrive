import type { MediaTimelineGroupIndex } from '../models'

// The day input must not allocate thousands of DOM option elements. Day
// groups are ordered by start_index and date (ascending/descending), with
// an optional "unknown" group at either edge according to the sort contract.
function calendarDayOrdinal(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [year, month, day] = key.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(timestamp)) return null
  if (new Date(timestamp).toISOString().slice(0, 10) !== key) return null
  return Math.floor(timestamp / 86_400_000)
}

/** O(log groups), never walks the full media list or virtual slots. */
export function xDriveMediaGalleryTimelineGroupAtIndex(
  groups: readonly MediaTimelineGroupIndex[],
  index: number,
): MediaTimelineGroupIndex | null {
  if (!Number.isSafeInteger(index) || index < 0) return null
  let lower = 0
  let upper = groups.length
  while (lower < upper) {
    const mid = Math.floor((lower + upper) / 2)
    if (groups[mid].start_index <= index) lower = mid + 1
    else upper = mid
  }
  const group = lower > 0 ? groups[lower - 1] : undefined
  return group && group.item_count > 0 &&
    index >= group.start_index &&
    index < group.start_index + group.item_count ? group : null
}

/** Nearest actual indexed date; exact=false is a user-visible fallback. */
export function xDriveMediaGalleryTimelineNearestDay(
  groups: readonly MediaTimelineGroupIndex[],
  requestedDay: string,
): { group: MediaTimelineGroupIndex; exact: boolean } | null {
  const wanted = calendarDayOrdinal(requestedDay)
  if (wanted === null) return null
  const start = groups[0]?.key === 'unknown' ? 1 : 0
  const end = groups.length - (groups.at(-1)?.key === 'unknown' ? 1 : 0)
  if (start >= end) return null
  const first = calendarDayOrdinal(groups[start].key)
  const last = calendarDayOrdinal(groups[end - 1].key)
  if (first === null || last === null) return null
  const ascending = first <= last
  let lower = start
  let upper = end
  while (lower < upper) {
    const mid = Math.floor((lower + upper) / 2)
    const midDay = calendarDayOrdinal(groups[mid].key)
    if (midDay === null) return null
    if (ascending ? midDay < wanted : midDay > wanted) lower = mid + 1
    else upper = mid
  }
  let selected: MediaTimelineGroupIndex | null = null
  let selectedDelta = Number.POSITIVE_INFINITY
  let selectedDay = Number.POSITIVE_INFINITY
  for (const position of [lower - 1, lower]) {
    if (position < start || position >= end) continue
    const candidate = groups[position]
    const ordinal = calendarDayOrdinal(candidate.key)
    if (ordinal === null || candidate.item_count <= 0) continue
    const delta = Math.abs(ordinal - wanted)
    if (delta < selectedDelta || (delta === selectedDelta && ordinal < selectedDay)) {
      selected = candidate
      selectedDelta = delta
      selectedDay = ordinal
    }
  }
  return selected ? { group: selected, exact: selected.key === requestedDay } : null
}
