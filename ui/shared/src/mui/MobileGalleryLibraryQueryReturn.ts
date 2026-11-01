import type { MediaGalleryQuery } from '../models'

/**
 * Browser Mobile Gallery-only return hint. A Gallery data-source object is
 * created for one authenticated API/Owner and survives tab unmount/remount.
 * Weak ownership means logout/server changes cannot retain old API objects.
 * This cache never grants media access: the caller must first complete a
 * counted Owner Range; a new Gallery remount MUST request its own Range.
 */
const committedLibraryQueries = new WeakMap<object, {
  owner: string
  query: MediaGalleryQuery
}>()

/** Keep only ordinary photo-wall filters, never map/private scopes, album
 * membership, one-shot Range anchors, media bytes or transport credentials. */
function copyRestorableLibraryQuery(query: MediaGalleryQuery): MediaGalleryQuery {
  const next: MediaGalleryQuery = {}
  if (query.search !== undefined) next.search = query.search
  if (query.asset_kind !== undefined) next.asset_kind = query.asset_kind
  if (query.category !== undefined) next.category = query.category
  if (query.cameras !== undefined) next.cameras = [...query.cameras]
  if (query.formats !== undefined) next.formats = [...query.formats]
  if (query.captured_from !== undefined) next.captured_from = query.captured_from
  if (query.captured_to !== undefined) next.captured_to = query.captured_to
  if (query.has_location !== undefined) next.has_location = query.has_location
  if (query.favorite !== undefined) next.favorite = query.favorite
  if (query.tag !== undefined) next.tag = query.tag
  if (query.person !== undefined) next.person = query.person
  if (query.person_identity !== undefined) next.person_identity = query.person_identity
  return next
}

export function xDriveRememberMobileLibraryQuery(
  source: object,
  owner: string,
  acceptedQuery: MediaGalleryQuery,
): void {
  if (!owner) return
  committedLibraryQueries.set(source, {
    owner, query: copyRestorableLibraryQuery(acceptedQuery),
  })
}

/** Caller may use this once on a cold Gallery remount, not on every manual
 * Library tab tap. No snapshot can outlive a different Owner/Source pair. */
export function xDriveReadMobileLibraryQuery(
  source: object,
  owner: string,
): MediaGalleryQuery | null {
  if (!owner) return null
  const saved = committedLibraryQueries.get(source)
  return saved?.owner === owner ? copyRestorableLibraryQuery(saved.query) : null
}
