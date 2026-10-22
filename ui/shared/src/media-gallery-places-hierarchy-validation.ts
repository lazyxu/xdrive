import type { MediaPlaceHierarchyPage, MediaPlaceHierarchyRequest } from './models'

const HIERARCHY_WINDOW_LIMIT = 48
const GEO_COUNTRY = /^[A-Z]{2}$/
const GEO_REGION = /^[A-Z0-9_-]{1,16}$/
const GEO_CITY = /^[1-9][0-9]*$/

/** Reject untrusted or mismatched Facet identities before photo-wall navigation. */
export function xDriveValidMediaPlaceHierarchyID(
  value: unknown, level: MediaPlaceHierarchyRequest['level'],
): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split(':')
  if (level === 'country') return parts.length === 2 &&
    parts[0] === 'country' && GEO_COUNTRY.test(parts[1])
  if (level === 'region') return parts.length === 3 &&
    parts[0] === 'region' && GEO_COUNTRY.test(parts[1]) && GEO_REGION.test(parts[2])
  if (level !== 'city' || parts.length !== 4 || parts[0] !== 'city' ||
      !GEO_COUNTRY.test(parts[1]) || !GEO_REGION.test(parts[2]) ||
      !GEO_CITY.test(parts[3])) return false
  const id = Number(parts[3])
  return Number.isSafeInteger(id) && id > 0 && String(id) === parts[3]
}

export function xDriveValidMediaPlaceHierarchyPage(
  value: unknown, request: MediaPlaceHierarchyRequest,
): value is MediaPlaceHierarchyPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const page = value as Partial<MediaPlaceHierarchyPage>
  const limit = request.limit ?? HIERARCHY_WINDOW_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      page.level !== request.level ||
      typeof page.available !== 'boolean' ||
      typeof page.has_more !== 'boolean' ||
      !Array.isArray(page.items) || page.items.length > Math.min(limit, HIERARCHY_WINDOW_LIMIT) ||
      (page.dataset_version !== undefined &&
        (typeof page.dataset_version !== 'string' || page.dataset_version.length > 128))) return false
  if (!page.available) {
    return page.items.length === 0 && !page.has_more &&
      !page.next_cursor
  }
  if (!page.dataset_version) return false
  if (page.has_more && (page.items.length === 0 ||
      page.next_cursor !== page.items[page.items.length - 1]?.id)) return false
  if (!page.has_more && page.next_cursor) return false
  if (request.cursor && !xDriveValidMediaPlaceHierarchyID(request.cursor, request.level)) return false
  const seen = new Set<string>()
  for (const item of page.items) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() ||
        item.name.length > 256 || item.name.includes('\u0000') ||
        !xDriveValidMediaPlaceHierarchyID(item.id, request.level) ||
        !Number.isSafeInteger(item.photo_count) || item.photo_count < 1 ||
        typeof item.match_kind !== 'string' || !item.match_kind ||
        seen.has(item.id)) return false
    const parts = item.id.split(':')
    if (request.country && parts[1] !== request.country) return false
    if (request.region && parts[2] !== request.region) return false
    if (item.cover_node_id !== undefined &&
        (!Number.isSafeInteger(item.cover_node_id) || item.cover_node_id < 1)) return false
    seen.add(item.id)
  }
  return true
}
