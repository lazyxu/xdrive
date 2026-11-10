/** One visual-only crop/contain policy for Gallery and signed Places.
 * Framing never changes logical photo indices, grids, signed ranges or
 * Owner/Cell/Node access; browser storage contains appearance settings only.
 */
export type XDriveMediaGalleryFraming = 'crop' | 'contain'

export const XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY =
  'xdrive.gallery.view-preferences.v1'
const framingEvent = 'xdrive-gallery-photo-wall-framing-changed'
const scales = ['all', 'year', 'month', 'day'] as const

function parsePreferences(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(
      XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function xDriveMediaGalleryReadFraming(): XDriveMediaGalleryFraming {
  return parsePreferences().aspectMode === 'contain' ? 'contain' : 'crop'
}

/** Replace ONLY framing; retain the existing Gallery's time-scale and density
 * preferences. Never copy unrelated fields (e.g. injected Node/Owner IDs).
 * The original v1 storage key and its older entries remain compatible.
 */
export function xDriveMediaGalleryWriteFraming(
  framing: XDriveMediaGalleryFraming,
): boolean {
  if (typeof window === 'undefined' ||
      (framing !== 'crop' && framing !== 'contain')) return false
  try {
    const current = parsePreferences()
    if ((current.aspectMode === 'contain' ? 'contain' : 'crop') === framing) {
      return true
    }
    const cleaned: Record<string, unknown> = {}
    if (typeof current.timeScale === 'string' &&
        scales.some(scale => scale === current.timeScale)) {
      cleaned.timeScale = current.timeScale
    }
    const storedDensity = current.densityByScale
    if (storedDensity && typeof storedDensity === 'object' &&
        !Array.isArray(storedDensity)) {
      const oldDensity = storedDensity as Record<string, unknown>
      const density: Record<string, number> = {}
      for (const scale of scales) {
        const value = oldDensity[scale]
        if (typeof value === 'number' && Number.isFinite(value) &&
            value >= 96 && value <= 240) density[scale] = value
      }
      cleaned.densityByScale = density
    }
    window.localStorage.setItem(
      XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY,
      JSON.stringify({...cleaned, aspectMode: framing}),
    )
    // The native storage event does not fire in the same document.
    window.dispatchEvent(new Event(framingEvent))
    return true
  } catch {
    return false
  }
}

/** Live same-document Gallery <-> Places synchronization plus cross-tab
 * storage updates. StrictMode unmount removes both listeners.
 */
export function xDriveMediaGalleryObserveFraming(
  onChange: (framing: XDriveMediaGalleryFraming) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const changed = () => onChange(xDriveMediaGalleryReadFraming())
  const onStorage = (event: StorageEvent) => {
    if (event.key === XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY ||
        event.key === null) changed()
  }
  window.addEventListener(framingEvent, changed)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(framingEvent, changed)
    window.removeEventListener('storage', onStorage)
  }
}

/** Do not resize the square virtual tiles: only change decoded image
 * fitting and the exact same loading-progress mask. No re-download or
 * fresh Owner request is needed when the user switches appearance.
 */
export function xDriveMediaGalleryFramingStyles(mode: XDriveMediaGalleryFraming) {
  const fit: 'contain' | 'cover' = mode === 'contain' ? 'contain' : 'cover'
  return {
    '& [data-xdrive-media-tile] img': {
      objectFit: fit,
      transformOrigin: 'center',
    },
    '& [data-xdrive-media-tile] [data-xdrive-media-loading-progress]': {
      maskSize: fit,
      WebkitMaskSize: fit,
    },
  }
}
