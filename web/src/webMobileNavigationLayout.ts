/** The 900px breakpoint is only a responsive fallback for desktop windows.
 * Web Mobile/PWA on a phone or tablet keeps its five fixed destinations in
 * both orientations, even with a CSS viewport wider than 900px.
 */
export const XDRIVE_WEB_NARROW_QUERY = '(max-width:899.95px)'
export const XDRIVE_WEB_TOUCH_ONLY_QUERY = '(pointer: coarse) and (hover: none)'

export type XDriveWebNavigationDevice = {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  touchOnly?: boolean
}

/** Layout selection only: never use browser device hints for authorization. */
export function xDriveWebCompactNavigation(
  narrowViewport: boolean,
  device: XDriveWebNavigationDevice,
): boolean {
  if (narrowViewport) return true

  const agent = device.userAgent ?? ''
  const platform = device.platform ?? ''
  const touchPoints = device.maxTouchPoints ?? 0

  // Device identity must survive portrait/landscape and external mouse use.
  if (/\b(Android|iPhone|iPad|iPod|Windows Phone|Silk|Kindle)\b/i.test(agent) ||
      /^iPad$/i.test(platform)) return true

  // Recent iPadOS Safari can request desktop sites and advertise MacIntel /
  // Macintosh. Real Macs do not expose iPad-style multi-touch screen points.
  if ((platform === 'MacIntel' || /\bMacintosh\b/i.test(agent)) &&
      touchPoints > 1) return true

  // Fallback for touch-only tablets with desktop-like user agents. Do NOT
  // classify normal Windows touch laptops by maxTouchPoints alone.
  return device.touchOnly === true
}

/** Cold-start route and live shell must use the same platform decision. */
export function xDriveWebBrowserCompactNavigation(): boolean {
  const matches = (query: string): boolean => {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
    } catch {
      // Optional media getters may be denied by Safari privacy modes.
      return false
    }
  }
  let device: XDriveWebNavigationDevice = { touchOnly: matches(XDRIVE_WEB_TOUCH_ONLY_QUERY) }
  try {
    const nav = window.navigator
    device = {
      ...device,
      userAgent: nav.userAgent,
      platform: nav.platform,
      maxTouchPoints: nav.maxTouchPoints,
    }
  } catch {
    // Preserve responsive fallback if Navigator access is denied.
  }
  return xDriveWebCompactNavigation(matches(XDRIVE_WEB_NARROW_QUERY), device)
}
