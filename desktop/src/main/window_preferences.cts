export type DesktopWindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopAppearance = 'system' | 'light' | 'dark'

export type DesktopPreferences = {
  appearance: DesktopAppearance
  start_at_login: boolean
  close_to_tray: boolean
  close_behavior_prompted: boolean
  window_bounds?: DesktopWindowBounds
  window_maximized: boolean
}

export function defaultDesktopPreferences(): DesktopPreferences {
  return {
    appearance: 'system',
    start_at_login: true,
    close_to_tray: true,
    close_behavior_prompted: false,
    window_maximized: false,
  }
}

function validBounds(value: unknown): DesktopWindowBounds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<DesktopWindowBounds>
  if (
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    (candidate.width || 0) < 900 ||
    (candidate.height || 0) < 600
  ) {
    return undefined
  }
  return {
    x: Math.round(candidate.x as number),
    y: Math.round(candidate.y as number),
    width: Math.round(candidate.width as number),
    height: Math.round(candidate.height as number),
  }
}

export function normalizeDesktopPreferences(value: unknown): DesktopPreferences {
  const defaults = defaultDesktopPreferences()
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<DesktopPreferences>
  return {
    appearance: candidate.appearance === 'light' || candidate.appearance === 'dark' || candidate.appearance === 'system'
      ? candidate.appearance
      : defaults.appearance,
    start_at_login: typeof candidate.start_at_login === 'boolean' ? candidate.start_at_login : defaults.start_at_login,
    close_to_tray: typeof candidate.close_to_tray === 'boolean' ? candidate.close_to_tray : defaults.close_to_tray,
    close_behavior_prompted: typeof candidate.close_behavior_prompted === 'boolean'
      ? candidate.close_behavior_prompted
      : defaults.close_behavior_prompted,
    window_bounds: validBounds(candidate.window_bounds),
    window_maximized: typeof candidate.window_maximized === 'boolean'
      ? candidate.window_maximized
      : defaults.window_maximized,
  }
}

export function resolveWindowBounds(
  saved: DesktopWindowBounds | undefined,
  workAreas: DesktopWindowBounds[],
): DesktopWindowBounds | undefined {
  if (!saved || workAreas.length === 0) return undefined
  let best: { area: DesktopWindowBounds; overlap: number } | null = null
  for (const area of workAreas) {
    const left = Math.max(saved.x, area.x)
    const top = Math.max(saved.y, area.y)
    const right = Math.min(saved.x + saved.width, area.x + area.width)
    const bottom = Math.min(saved.y + saved.height, area.y + area.height)
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top)
    if (!best || overlap > best.overlap) best = { area, overlap }
  }
  if (!best || best.overlap < 120 * 80) return undefined

  const width = Math.max(900, Math.min(saved.width, best.area.width))
  const height = Math.max(600, Math.min(saved.height, best.area.height))
  return {
    x: Math.max(best.area.x, Math.min(saved.x, best.area.x + best.area.width - width)),
    y: Math.max(best.area.y, Math.min(saved.y, best.area.y + best.area.height - height)),
    width,
    height,
  }
}
