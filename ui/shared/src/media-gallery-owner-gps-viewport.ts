import type { MediaPlaceFacet, MediaPlacesMapOverview, MediaPlacesViewportBounds } from './models'

/** Host-neutral WGS84 viewport geometry for the bounded non-SDK fallback.
 * This is a distribution overview, NOT a fake map tile/projection provider. */
export const xDriveOwnerGPSWorld: MediaPlacesViewportBounds = {
  west: -180, south: -90, east: 180, north: 90,
}
const finite = (n: number) => Number.isFinite(n)
export function xDriveOwnerGPSBoundsValid(b: MediaPlacesViewportBounds): boolean {
  return [b.west, b.south, b.east, b.north].every(finite) &&
    b.west >= -180 && b.west < b.east && b.east <= 180 &&
    b.south >= -90 && b.south < b.north && b.north <= 90
}
function clampAxis(center: number, span: number, lo: number, hi: number): [number, number] {
  const actual = Math.min(hi - lo, Math.max(0.005, span))
  const first = Math.min(hi - actual, Math.max(lo, center - actual / 2))
  return [first, first + actual]
}
/** Zoom into a *real* sample, never invent a synthetic GPS coordinate. */
export function xDriveOwnerGPSZoom(
  b: MediaPlacesViewportBounds, latitude: number, longitude: number, factor = 0.35,
): MediaPlacesViewportBounds | null {
  if (!xDriveOwnerGPSBoundsValid(b) || !finite(latitude) || !finite(longitude) ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
    !finite(factor) || factor <= 0 || factor >= 1) return null
  const [south, north] = clampAxis(latitude, (b.north - b.south) * factor, -90, 90)
  const [west, east] = clampAxis(longitude, (b.east - b.west) * factor, -180, 180)
  return { west, south, east, north }
}
/** Dragging right moves content right, so the geographic viewport shifts west. */
export function xDriveOwnerGPSPan(
  b: MediaPlacesViewportBounds, dx: number, dy: number,
): MediaPlacesViewportBounds | null {
  if (!xDriveOwnerGPSBoundsValid(b) || !finite(dx) || !finite(dy) ||
    Math.abs(dx) > 2 || Math.abs(dy) > 2) return null
  const latSpan = b.north - b.south, lonSpan = b.east - b.west
  const [south, north] = clampAxis(
    (b.south + b.north) / 2 + dy * latSpan, latSpan, -90, 90)
  const [west, east] = clampAxis(
    (b.west + b.east) / 2 - dx * lonSpan, lonSpan, -180, 180)
  return { west, south, east, north }
}
export function xDriveOwnerGPSPoint(
  b: MediaPlacesViewportBounds, latitude: number, longitude: number,
): { x: number; y: number } | null {
  if (!xDriveOwnerGPSBoundsValid(b) || !finite(latitude) || !finite(longitude) ||
    latitude < b.south || latitude > b.north ||
    longitude < b.west || longitude > b.east) return null
  return {
    x: (longitude - b.west) / (b.east - b.west),
    y: (b.north - latitude) / (b.north - b.south),
  }
}
export function xDriveOwnerGPSCanOpenPlace(
  page: MediaPlacesMapOverview, candidate: MediaPlaceFacet,
): boolean {
  return !page.aggregated && candidate.coordinate_kind === 'grid_cell_center' &&
    /^place:(0|-?[1-9][0-9]*):(0|-?[1-9][0-9]*)$/.test(candidate.id) &&
    page.items.some(item => item.id === candidate.id &&
      item.item_count === candidate.item_count &&
      item.sample_latitude === candidate.sample_latitude &&
      item.sample_longitude === candidate.sample_longitude)
}
