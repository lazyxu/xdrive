import type { MediaGalleryQuery } from '../models'
import { xDriveMediaDayKey } from '../media-timezone'

export type XDriveGalleryAppliedFilterKey =
  | 'search' | 'asset_kind' | 'category' | 'cameras' | 'formats'
  | 'captured_from' | 'captured_to' | 'has_location' | 'favorite'
  | 'tag' | 'person' | 'person_identity' | 'place'

export type XDriveGalleryAppliedChip = {
  key: XDriveGalleryAppliedFilterKey
  label: string
  removable: boolean
}

const filterKeys: readonly XDriveGalleryAppliedFilterKey[] = [
  'search', 'asset_kind', 'category', 'cameras', 'formats',
  'captured_from', 'captured_to', 'has_location', 'favorite',
  'tag', 'person', 'person_identity', 'place',
]

/** Ignore sort, transient view anchors, pagination, folder scope and IANA zone. */
export function xDriveGalleryFilterSignature(query: MediaGalleryQuery = {}): string {
  return JSON.stringify(filterKeys.map((key) => {
    const value = query[key]
    return [key, Array.isArray(value) ? [...value].sort() : (value ?? null)]
  }))
}

export function xDriveGalleryAppliedChips(
  query: MediaGalleryQuery = {},
  options: {
    timeZone?: string
    locked?: readonly XDriveGalleryAppliedFilterKey[]
    placeLabel?: string
    personLabel?: string
  } = {},
): XDriveGalleryAppliedChip[] {
  const locked = new Set(options.locked ?? [])
  const chips: XDriveGalleryAppliedChip[] = []
  const add = (key: XDriveGalleryAppliedFilterKey, label: string) => {
    chips.push({ key, label, removable: !locked.has(key) })
  }
  if (query.search?.trim()) add('search', '搜索：' + query.search.trim())
  if (query.asset_kind) add('asset_kind', '资产：' + query.asset_kind)
  if (query.category) add('category', '分类：' + query.category)
  if (query.cameras?.length) add('cameras', '设备：' + query.cameras.join('、'))
  if (query.formats?.length) add('formats', '格式：' + query.formats.join('、'))
  const zone = options.timeZone || query.time_zone || 'UTC'
  if (query.captured_from) {
    const day = xDriveMediaDayKey(query.captured_from, zone)
    add('captured_from', '拍摄自：' + (day || query.captured_from))
  }
  if (query.captured_to) {
    const instant = new Date(query.captured_to)
    const lastMoment = Number.isFinite(instant.getTime())
      ? new Date(instant.getTime() - 1)
      : instant
    add('captured_to', '拍摄至：' + (xDriveMediaDayKey(lastMoment, zone) || query.captured_to))
  }
  if (query.has_location !== undefined) {
    add('has_location', query.has_location ? '有 GPS' : '无 GPS')
  }
  if (query.favorite !== undefined) {
    add('favorite', query.favorite ? '已收藏' : '未收藏')
  }
  if (query.tag) add('tag', '标签：' + query.tag)
  if (query.person) add('person', '人物：' + query.person)
  if (query.person_identity) add('person_identity', '人物：' + (options.personLabel || '已确认人物'))
  if (query.place) add('place', '地点：' + (options.placeLabel || query.place))
  return chips
}

const historyLimit = 8
const historyPrefix = 'xdrive.gallery.recent-searches.v1:'

/** History is optional, bounded and keyed by the authenticated account scope. */
export function xDriveGalleryRecentSearches(scope: string): string[] {
  if (!scope || typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(window.localStorage.getItem(historyPrefix + encodeURIComponent(scope)) || '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((x): x is string =>
      typeof x === 'string' && x.trim().length > 0 && [...x].length <= 200,
    ).slice(0, historyLimit)
  } catch {
    return []
  }
}

export function xDriveGalleryRememberSearch(scope: string, value: string): string[] {
  const text = value.trim()
  if (!scope || !text || [...text].length > 200) return xDriveGalleryRecentSearches(scope)
  const history = [text, ...xDriveGalleryRecentSearches(scope).filter(
    (previous) => previous.toLocaleLowerCase() !== text.toLocaleLowerCase(),
  )].slice(0, historyLimit)
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(historyPrefix + encodeURIComponent(scope), JSON.stringify(history))
    }
  } catch {
    // Private mode or disabled storage cannot block searching.
  }
  return history
}
