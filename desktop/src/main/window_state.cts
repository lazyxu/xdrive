export type DesktopWindowState = {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export type DesktopWorkArea = {
  x: number
  y: number
  width: number
  height: number
}

function finiteInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

export function parseDesktopWindowState(value: unknown): DesktopWindowState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Partial<DesktopWindowState>
  const x = finiteInteger(input.x)
  const y = finiteInteger(input.y)
  const width = finiteInteger(input.width)
  const height = finiteInteger(input.height)
  if (x === null || y === null || width === null || height === null || width < 320 || height < 240) return undefined
  return { x, y, width, height, maximized: input.maximized === true }
}

function intersectionArea(a: DesktopWorkArea, b: DesktopWorkArea) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

export function restoreDesktopWindowBounds(
  saved: DesktopWindowState | undefined,
  workAreas: DesktopWorkArea[],
  primary: DesktopWorkArea,
  defaults = { width: 1120, height: 760 },
) {
  if (saved) {
    const savedBounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    const visible = workAreas.some((area) => intersectionArea(savedBounds, area) >= 64 * 64)
    if (visible) return savedBounds
  }

  const width = Math.min(defaults.width, primary.width)
  const height = Math.min(defaults.height, primary.height)
  return {
    x: primary.x + Math.max(0, Math.floor((primary.width - width) / 2)),
    y: primary.y + Math.max(0, Math.floor((primary.height - height) / 2)),
    width,
    height,
  }
}
