import type { MediaPlacesViewportBounds } from './models'

/** One optional, opt-in HTTPS tile source; replaceable centrally. Web browsers
 * own HTTP caching/referer, and only tiles intersecting the user's live map
 * viewport are ever mounted. Never prefetch or proxy a GPS photo coordinate. */
export const XDRIVE_GPS_OSM_TILE_ORIGIN = 'https://tile.openstreetmap.org'
export const XDRIVE_GPS_OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright'

const MAX_LAT = 85.05112878
const MAX_ZOOM = 17
const MAX_TILE_REQUESTS = 32
const TILE_PIXELS = 256
const finite = (value: number): boolean => Number.isFinite(value)
const radians = (lat: number): number => lat * Math.PI / 180
const clamp = (v: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, v))

function mercatorY(latitude: number): number {
  const rad = radians(clamp(latitude, -MAX_LAT, MAX_LAT))
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2
}
function latitudeFromMercatorY(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * clamp(y, 0, 1)))) * 180 / Math.PI
}
const longitudeX = (longitude: number): number => (longitude + 180) / 360

export type XDriveGPSTile = {
  z: number
  x: number
  y: number
  left: number
  top: number
  size: number
  url: string
}

export type XDriveGPSTilePlan = {
  width: number
  height: number
  scale: number
  centerX: number
  centerY: number
  zoom: number
  tiles: XDriveGPSTile[]
}

function validBounds(bounds: MediaPlacesViewportBounds): boolean {
  return !!bounds && [bounds.west,bounds.east,bounds.south,bounds.north].every(finite) &&
    bounds.west >= -180 && bounds.east <= 180 &&
    bounds.south >= -90 && bounds.north <= 90 &&
    bounds.west < bounds.east && bounds.south < bounds.north
}

export function xDriveOwnerGPSBasemapPlan(
  bounds: MediaPlacesViewportBounds, width: number, height: number,
): XDriveGPSTilePlan | null {
  if (!validBounds(bounds) || !finite(width) || !finite(height) ||
      width < 1 || height < 1 || width > 8192 || height > 8192) return null
  const westX = longitudeX(bounds.west)
  const eastX = longitudeX(bounds.east)
  const northY = mercatorY(bounds.north)
  const southY = mercatorY(bounds.south)
  const spanX = eastX - westX
  const spanY = southY - northY
  if (!(spanX > 0) || !(spanY > 0)) return null
  // A uniform Web Mercator pixel scale is shared by tiles AND photo pins.
  // The WGS84 geographic bounding rectangle is fitted into the live viewport.
  const scale = Math.min(
    TILE_PIXELS * 2 ** MAX_ZOOM,
    Math.min(width / spanX, height / spanY),
  )
  if (!finite(scale) || scale <= 0) return null
  const centerX = (westX + eastX) / 2
  const centerY = (northY + southY) / 2
  let zoom = clamp(Math.floor(Math.log2(scale / TILE_PIXELS)), 0, MAX_ZOOM)
  const visible = (z: number): XDriveGPSTile[] => {
    const number = 2 ** z
    const size = scale / number
    const originX = centerX * scale - width / 2
    const originY = centerY * scale - height / 2
    const fromX = Math.floor(originX / size)
    const toX = Math.floor((originX + width - 0.001) / size)
    const fromY = Math.max(0, Math.floor(originY / size))
    const toY = Math.min(number - 1, Math.floor((originY + height - 0.001) / size))
    const results: XDriveGPSTile[] = []
    // Always finite. The fallback zoom below keeps the list within budget.
    for (let y = fromY; y <= toY; y++) {
      for (let x = fromX; x <= toX; x++) {
        const wrappedX = ((x % number) + number) % number
        results.push({
          z, x: wrappedX, y,
          left: x * size - originX,
          top: y * size - originY,
          size,
          url: XDRIVE_GPS_OSM_TILE_ORIGIN + '/' + z + '/' + wrappedX + '/' + y + '.png',
        })
        if (results.length > MAX_TILE_REQUESTS) return results
      }
    }
    return results
  }
  let tiles = visible(zoom)
  // Use coarser server tiles stretched locally on an unusually large screen:
  // do NOT request 100+ community-funded tiles just to fill a 4K viewport.
  while (tiles.length > MAX_TILE_REQUESTS && zoom > 0) {
    zoom--
    tiles = visible(zoom)
  }
  return {width,height,scale,centerX,centerY,zoom,
    tiles: tiles.slice(0, MAX_TILE_REQUESTS)}
}

/** Never estimate marker locations from unverified map-region IDs or guessed
 * Baidu BD-09. This projection uses ONLY the signed Owner WGS84 coordinates. */
export function xDriveOwnerGPSTilePoint(
  bounds: MediaPlacesViewportBounds, plan: XDriveGPSTilePlan,
  latitude: number, longitude: number,
): {x:number;y:number} | null {
  if (!validBounds(bounds) || !finite(latitude) || !finite(longitude) ||
      // EPSG:3857 has no defined pole imagery; never pin valid polar GPS
      // photos onto a fictitious +/-85-degree tile edge. The unchanged
      // WGS84-only map still displays them when the basemap is disabled.
      latitude < -MAX_LAT || latitude > MAX_LAT ||
      latitude < bounds.south || latitude > bounds.north ||
      longitude < bounds.west || longitude > bounds.east) return null
  return {
    x: (plan.width / 2 + (longitudeX(longitude) - plan.centerX) * plan.scale) / plan.width,
    y: (plan.height / 2 + (mercatorY(latitude) - plan.centerY) * plan.scale) / plan.height,
  }
}

/** Dragging the optional tile basemap changes the SAME Owner WGS84 camera.
 * Use Mercator latitude rather than a linear-degree approximation. */
export function xDriveOwnerGPSTilePan(
  bounds: MediaPlacesViewportBounds, dx: number, dy: number,
): MediaPlacesViewportBounds | null {
  if (!validBounds(bounds) || !finite(dx) || !finite(dy)) return null
  const spanX = (bounds.east - bounds.west) / 360
  const spanY = mercatorY(bounds.south) - mercatorY(bounds.north)
  const westX = clamp(longitudeX(bounds.west) - dx * spanX, 0, 1 - spanX)
  const northY = clamp(mercatorY(bounds.north) - dy * spanY, 0, 1 - spanY)
  const result = {
    west: westX * 360 - 180,
    east: (westX + spanX) * 360 - 180,
    north: latitudeFromMercatorY(northY),
    south: latitudeFromMercatorY(northY + spanY),
  }
  return validBounds(result) ? result : null
}

export function xDriveOwnerGPSTileZoom(
  bounds: MediaPlacesViewportBounds, factor: number,
): MediaPlacesViewportBounds | null {
  if (!validBounds(bounds) || !finite(factor) || factor <= 0) return null
  const centerX = (longitudeX(bounds.west) + longitudeX(bounds.east)) / 2
  const centerY = (mercatorY(bounds.north) + mercatorY(bounds.south)) / 2
  const spanX = Math.min(1, Math.max(1e-9, (bounds.east - bounds.west) / 360 * factor))
  const spanY = Math.min(1, Math.max(1e-9,
    (mercatorY(bounds.south) - mercatorY(bounds.north)) * factor))
  const westX = clamp(centerX - spanX / 2, 0, 1 - spanX)
  const northY = clamp(centerY - spanY / 2, 0, 1 - spanY)
  const result = {
    west: westX * 360 - 180,
    east: (westX + spanX) * 360 - 180,
    north: latitudeFromMercatorY(northY),
    south: latitudeFromMercatorY(northY + spanY),
  }
  return validBounds(result) ? result : null
}
