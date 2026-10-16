/** Map camera navigation ONLY. The Baidu Server-authorized PNG is the sole
 * image provider; no local basemap or marker projection is rendered here. */
export type XDriveBaiduMapCameraCenter = { latitude: number; longitude: number }

const maxMapLatitude = 85
const radians = Math.PI / 180
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const mercatorY = (lat: number) => {
  const sine = Math.sin(clamp(lat, -maxMapLatitude, maxMapLatitude) * radians)
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)
}
const invertY = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / radians

/** One user-triggered camera step, with WGS84 center and dateline wrapping.
 * Step deltas approximate viewport pixels, never map content pixel positions. */
export function xDriveBaiduStaticStepCenter(
  center: XDriveBaiduMapCameraCenter,
  zoom: number,
  eastPixels: number,
  southPixels: number,
): XDriveBaiduMapCameraCenter {
  if (![center.latitude, center.longitude, zoom, eastPixels, southPixels].every(Number.isFinite) ||
      Math.abs(center.latitude) > 85 || Math.abs(center.longitude) > 180 ||
      zoom < 3 || zoom > 18) return center
  const worldPixels = 256 * Math.pow(2, zoom)
  const x = ((((center.longitude + 180) / 360 + eastPixels / worldPixels) % 1) + 1) % 1
  const y = clamp(mercatorY(center.latitude) + southPixels / worldPixels,
    mercatorY(maxMapLatitude), mercatorY(-maxMapLatitude))
  return {
    latitude: clamp(invertY(y), -maxMapLatitude, maxMapLatitude),
    longitude: x * 360 - 180,
  }
}

/** Approximate WGS84 bbox for the static Baidu camera, NOT a pixel-accurate
 * JSAPI4 / BD-09 map overlay. Server filters true original WGS84 GPS. */
export type XDriveBaiduMapViewportBounds = {
  west: number
  south: number
  east: number
  north: number
}

export function xDriveBaiduStaticViewportBounds(
  center: XDriveBaiduMapCameraCenter,
  zoom: number,
  widthPixels = 480,
  heightPixels = 280,
): XDriveBaiduMapViewportBounds | null {
  if (![center.latitude, center.longitude, zoom, widthPixels, heightPixels].every(Number.isFinite) ||
      Math.abs(center.latitude) > maxMapLatitude || Math.abs(center.longitude) > 180 ||
      zoom < 3 || zoom > 18 || widthPixels <= 0 || heightPixels <= 0) return null
  const worldPixels = 256 * Math.pow(2, zoom)
  if (widthPixels >= worldPixels) return null
  const fraction = (x: number) => ((x % 1) + 1) % 1
  const x = (center.longitude + 180) / 360
  const y = mercatorY(center.latitude)
  const halfWidth = widthPixels / (2 * worldPixels)
  const halfHeight = heightPixels / (2 * worldPixels)
  const minY = mercatorY(maxMapLatitude)
  const maxY = mercatorY(-maxMapLatitude)
  return {
    west: fraction(x - halfWidth) * 360 - 180,
    east: fraction(x + halfWidth) * 360 - 180,
    north: clamp(invertY(clamp(y - halfHeight, minY, maxY)), -maxMapLatitude, maxMapLatitude),
    south: clamp(invertY(clamp(y + halfHeight, minY, maxY)), -maxMapLatitude, maxMapLatitude),
  }
}


/** Discrete gesture zoom for the shared, Server-authorized Static Map fallback.
 * This is NOT JSAPI4 continuous map/pinch projection. Keep one PNG request
 * only when a completed two-finger gesture changes integer camera zoom. */
export function xDriveBaiduStaticPinchZoom(
  zoom: number, initialDistance: number, finalDistance: number,
): number {
  if (!Number.isInteger(zoom) || zoom < 3 || zoom > 18 ||
      !Number.isFinite(initialDistance) || !Number.isFinite(finalDistance) ||
      initialDistance < 20 || finalDistance <= 0) return zoom
  const steps = Math.max(-3, Math.min(3, Math.round(Math.log2(finalDistance / initialDistance))))
  return Math.max(3, Math.min(18, zoom + steps))
}

/** Coordinates of the finger centroid relative to the logical 480x280
 * Server Static PNG camera, NOT Baidu JSAPI4 BD-09 screen projection. */
export type XDriveBaiduStaticGestureFocus = {
  eastPixels: number
  southPixels: number
}

/** Preserve the approximate geographic point beneath moving pinch fingers
 * when committing a discrete zoom. Moving two fingers together also pans.
 * Never use this approximation for BD-09 markers or authorized GPS identity. */
export function xDriveBaiduStaticFocusCenter(
  center: XDriveBaiduMapCameraCenter,
  zoom: number,
  nextZoom: number,
  initial: XDriveBaiduStaticGestureFocus,
  final: XDriveBaiduStaticGestureFocus,
): XDriveBaiduMapCameraCenter {
  if (!center || !initial || !final || !Number.isInteger(zoom) ||
      !Number.isInteger(nextZoom) || zoom < 3 || zoom > 18 ||
      nextZoom < 3 || nextZoom > 18 ||
      ![initial.eastPixels, initial.southPixels,
        final.eastPixels, final.southPixels].every(Number.isFinite) ||
      [initial.eastPixels, final.eastPixels].some(v => Math.abs(v) > 480) ||
      [initial.southPixels, final.southPixels].some(v => Math.abs(v) > 280)) {
    return center
  }
  if (zoom === nextZoom && initial.eastPixels === final.eastPixels &&
      initial.southPixels === final.southPixels) return center
  // Old-point screen coordinate: C_old + initial/W_old.
  // New-point screen coordinate: C_new + final/W_new.
  // Solve C_new = C_old + initial/W_old - final/W_new.
  const factor = Math.pow(2, zoom - nextZoom)
  return xDriveBaiduStaticStepCenter(center, zoom,
    initial.eastPixels - final.eastPixels * factor,
    initial.southPixels - final.southPixels * factor)
}
