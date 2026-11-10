/** Shared, strictly visual photo-wall preferences for Gallery and Places.
 * Only a bounded four-number column map is persisted. Owner/Cell/Node,
 * tokens, signed URLs, media identities, and Viewer state never enter storage.
 */
export type XDriveGalleryPhotoWallScale = 'year' | 'month' | 'day' | 'all'
export type XDriveGalleryPhotoWallColumns =
  Record<XDriveGalleryPhotoWallScale, number>

export const XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY =
  'xdrive.gallery.mobile.columns.v1'
export const XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_DEFAULT:
  XDriveGalleryPhotoWallColumns = {
    year: 6, month: 5, day: 3, all: 3,
  }
export const XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MIN = 2
export const XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MAX = 10

const scales: readonly XDriveGalleryPhotoWallScale[] =
  ['year', 'month', 'day', 'all']
const changedEvent = 'xdrive-gallery-mobile-columns-changed'

function validScale(value: string): value is XDriveGalleryPhotoWallScale {
  return scales.some(scale => scale === value)
}

function boundedColumns(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MIN,
    Math.min(XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_MAX, Math.round(value)))
}

export function xDriveReadMobileGalleryColumns(): XDriveGalleryPhotoWallColumns {
  const fallback = { ...XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_DEFAULT }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY)
    if (!raw) return fallback
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback
    for (const scale of scales) {
      const n = boundedColumns(
        (saved as Partial<XDriveGalleryPhotoWallColumns>)[scale],
      )
      if (n !== null) fallback[scale] = n
    }
  } catch {
    // Browser privacy restrictions cannot prevent photo browsing.
  }
  return fallback
}

/** Merge only one visual scale. Never overwrite a sibling's newer preference
 * with an old Gallery or Places render snapshot. Same-document listeners must
 * also refresh (the native storage event is cross-document only).
 */
export function xDriveWriteMobileGalleryColumn(
  scale: XDriveGalleryPhotoWallScale, value: number,
): boolean {
  if (typeof window === 'undefined' || !validScale(scale)) return false
  const columns = boundedColumns(value)
  if (columns === null) return false
  const current = xDriveReadMobileGalleryColumns()
  if (current[scale] === columns) return true
  try {
    window.localStorage.setItem(
      XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY,
      JSON.stringify({ ...current, [scale]: columns }),
    )
    window.dispatchEvent(new Event(changedEvent))
    return true
  } catch {
    return false
  }
}

/** Scoped listener with cleanup for React StrictMode/remounts and cross-tab
 * storage updates. No media reads, Owner lookup, or network requests.
 */
export function xDriveObserveMobileGalleryColumns(
  onChange: (columns: XDriveGalleryPhotoWallColumns) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const changed = () => onChange(xDriveReadMobileGalleryColumns())
  const storageChanged = (event: StorageEvent) => {
    if (event.key === XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY ||
        event.key === null) changed()
  }
  window.addEventListener(changedEvent, changed)
  window.addEventListener('storage', storageChanged)
  return () => {
    window.removeEventListener(changedEvent, changed)
    window.removeEventListener('storage', storageChanged)
  }
}
