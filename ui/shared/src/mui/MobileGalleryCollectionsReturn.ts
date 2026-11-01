/**
 * Presentation-only Library/Collections selection for Web Mobile tab reentry.
 * The same live authenticated Gallery source survives ordinary bottom-tab
 * unmount/remount; WeakMap does not persist media, coordinates or credentials.
 * A source/Owner/section mismatch must use the ordinary Library default.
 */
const galleryCollectionsReturn = new WeakMap<object, {
  ownerScope: string
  selected: boolean
}>()

export function xDriveRememberMobileGalleryCollectionsReturn(
  source: object,
  ownerScope: string,
  section: string | undefined,
  selected: boolean,
): void {
  if (!ownerScope) return
  galleryCollectionsReturn.set(source, {
    ownerScope, selected: section === 'library' && selected,
  })
}

export function xDriveReadMobileGalleryCollectionsReturn(
  source: object,
  ownerScope: string,
  section: string | undefined,
): boolean {
  if (!ownerScope || (section && section !== 'library')) return false
  const saved = galleryCollectionsReturn.get(source)
  return saved?.ownerScope === ownerScope && saved.selected === true
}
