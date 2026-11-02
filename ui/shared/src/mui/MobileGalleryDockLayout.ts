/**
 * Gallery-local floating controls sit immediately above the actual Browser
 * five-slot tab bar. The Web shell may add safe-area padding or switch to a
 * 44px landscape tab bar; its measured viewport top is authoritative.
 *
 * Without a Web shell (e.g. isolated Desktop map guest), retain a safe-area
 * aware local dock, never invent a global navigation bar.
 */
export const XDRIVE_MOBILE_GALLERY_DOCK_HEIGHT = 48
export const XDRIVE_MOBILE_GALLERY_NAV_INSET =
  'var(--xdrive-mobile-five-slot-inset, env(safe-area-inset-bottom, 0px))'

export function xDriveMobileGalleryDockBottom(extraPx = 0): string {
  return extraPx > 0
    ? `calc(${XDRIVE_MOBILE_GALLERY_NAV_INSET} + ${extraPx}px)`
    : XDRIVE_MOBILE_GALLERY_NAV_INSET
}

/** Convert the global tab bar's real viewport position into a safe CSS inset. */
export function xDriveMobileGalleryGlobalInset(navTop: number, viewportHeight: number): string {
  if (!Number.isFinite(navTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0)
    return '0px'
  return Math.max(0, Math.min(Math.ceil(viewportHeight), Math.ceil(viewportHeight - navTop))) + 'px'
}
