import type { MediaAlbum } from '../models'

export type MediaAlbumSortOrder = 'manual' | 'name' | 'recent' | 'count'
export type MediaAlbumOrganizePreferences = {
  sort: MediaAlbumSortOrder
  pinned: string[]
  order: string[]
}

const DEFAULTS: MediaAlbumOrganizePreferences = {
  sort: 'name',
  pinned: [],
  order: [],
}
const KEY = 'xdrive.gallery.album-organization.v1'
/** One account-scoped signal for both Web layouts.
 * Storage events cover other tabs; local listeners cover writes in this tab.
 * Neither creates a media controller nor persists redundant state. */
const albumPreferenceListeners = new Map<string, Set<() => void>>()

export function subscribeMediaAlbumPreferences(
  accountScope: string, notify: () => void,
): () => void {
  if (!accountScope) return () => undefined
  let listeners = albumPreferenceListeners.get(accountScope)
  if (!listeners) {
    listeners = new Set()
    albumPreferenceListeners.set(accountScope, listeners)
  }
  listeners.add(notify)
  const host = typeof window !== 'undefined' ? window : undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== mediaAlbumPreferencesKey(accountScope)) return
    // Cross-tab storage events never fire in the writing document.
    notify()
  }
  host?.addEventListener?.('storage', onStorage)
  return () => {
    listeners?.delete(notify)
    if (!listeners?.size) albumPreferenceListeners.delete(accountScope)
    host?.removeEventListener?.('storage', onStorage)
  }
}

export function mediaAlbumPreferencesKey(accountScope: string) {
  return `${KEY}:${encodeURIComponent(accountScope)}`
}

function validIDs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => (
    typeof id === 'string' && id.length > 0 && id.length <= 512
  )))].slice(0, 5000)
}

export function normalizeMediaAlbumPreferences(value: unknown): MediaAlbumOrganizePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULTS, pinned: [], order: [] }
  const input = value as Partial<MediaAlbumOrganizePreferences>
  const sort: MediaAlbumSortOrder = (
    input.sort === 'manual' || input.sort === 'name' ||
    input.sort === 'recent' || input.sort === 'count'
  ) ? input.sort : 'name'
  return { sort, pinned: validIDs(input.pinned), order: validIDs(input.order) }
}

export function readMediaAlbumPreferences(accountScope: string): MediaAlbumOrganizePreferences {
  if (!accountScope || typeof window === 'undefined') return normalizeMediaAlbumPreferences(null)
  try {
    return normalizeMediaAlbumPreferences(
      JSON.parse(window.localStorage.getItem(mediaAlbumPreferencesKey(accountScope)) ?? 'null'),
    )
  } catch {
    return normalizeMediaAlbumPreferences(null)
  }
}

export function writeMediaAlbumPreferences(accountScope: string, value: MediaAlbumOrganizePreferences) {
  if (!accountScope || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      mediaAlbumPreferencesKey(accountScope),
      JSON.stringify(normalizeMediaAlbumPreferences(value)),
    )
  } catch {
    // Gallery remains interactive even without local storage.
    return
  }
  // Storage event does not fire in the writing tab: publish after commit.
  for (const notify of [...(albumPreferenceListeners.get(accountScope) ?? [])]) notify()
}

export function sortedMediaAlbums(
  albums: readonly MediaAlbum[],
  preferences: MediaAlbumOrganizePreferences,
  filter = '',
): { pinned: MediaAlbum[]; other: MediaAlbum[] } {
  const query = filter.trim().toLocaleLowerCase()
  const matches = albums.filter((album) => album.name.toLocaleLowerCase().includes(query))
  const pinOrder = new Map(preferences.pinned.map((id, index) => [id, index]))
  const manualOrder = new Map(preferences.order.map((id, index) => [id, index]))
  const baseIndex = new Map(albums.map((album, index) => [album.id, index]))
  const pinned: MediaAlbum[] = []
  const other: MediaAlbum[] = []
  for (const album of matches) {
    if (pinOrder.has(album.id)) pinned.push(album)
    else other.push(album)
  }
  pinned.sort((a, b) =>
    (pinOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
    (pinOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
  other.sort((a, b) => {
    let comparison = 0
    if (preferences.sort === 'manual') {
      comparison = (manualOrder.get(a.id) ?? (preferences.order.length + (baseIndex.get(a.id) ?? 0))) -
        (manualOrder.get(b.id) ?? (preferences.order.length + (baseIndex.get(b.id) ?? 0)))
    } else if (preferences.sort === 'count') {
      comparison = b.item_count - a.item_count
    } else if (preferences.sort === 'recent') {
      comparison = (Date.parse(b.updated_at ?? '') || 0) - (Date.parse(a.updated_at ?? '') || 0)
    } else {
      comparison = a.name.localeCompare(b.name, 'zh-CN')
    }
    return comparison || a.id.localeCompare(b.id)
  })
  return { pinned, other }
}

export function changeAlbumPin(
  albums: readonly MediaAlbum[],
  preferences: MediaAlbumOrganizePreferences,
  id: string,
): MediaAlbumOrganizePreferences {
  if (!albums.some((a) => a.id === id)) return preferences
  const pinned = preferences.pinned.includes(id)
    ? preferences.pinned.filter((other) => other !== id)
    : [...preferences.pinned.filter((existing) => albums.some((a) => a.id === existing)), id]
  return { ...preferences, pinned }
}

export function moveAlbum(
  albums: readonly MediaAlbum[],
  preferences: MediaAlbumOrganizePreferences,
  albumID: string,
  step: -1 | 1,
): MediaAlbumOrganizePreferences {
  const isPinned = preferences.pinned.includes(albumID)
  const visible = sortedMediaAlbums(albums, preferences)
  const group = isPinned ? visible.pinned : visible.other
  const order = group.map((album) => album.id)
  const index = order.indexOf(albumID)
  if (index < 0 || index + step < 0 || index + step >= order.length) return preferences
  ;[order[index], order[index + step]] = [order[index + step], order[index]]
  if (isPinned) return { ...preferences, pinned: order }
  return { ...preferences, sort: 'manual', order }
}
