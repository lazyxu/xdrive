/**
 * Ephemeral Owner-scoped native Baidu camera return.
 * BD-09LL is NOT the original WGS84 photo GPS or a WGS84 viewport.
 * Never serialize into URLs, persistent storage, Service Workers or map SDK data.
 */
export interface XDriveBaiduNativeCameraSnapshot {
  coordinate_space: 'bd09ll'
  latitude: number
  longitude: number
  zoom: number
}

const maxSessions = 8
export const XDRIVE_BAIDU_NATIVE_CAMERA_TTL_MS = 10 * 60 * 1000
const sessions = new Map<string, { camera: XDriveBaiduNativeCameraSnapshot; seen: number }>()

export function xDriveValidBaiduNativeCameraSnapshot(
  value: unknown,
): value is XDriveBaiduNativeCameraSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const camera = value as Partial<XDriveBaiduNativeCameraSnapshot>
  return camera.coordinate_space === 'bd09ll' &&
    typeof camera.latitude === 'number' && Number.isFinite(camera.latitude) &&
    camera.latitude >= -85 && camera.latitude <= 85 &&
    typeof camera.longitude === 'number' && Number.isFinite(camera.longitude) &&
    camera.longitude >= -180 && camera.longitude <= 180 &&
    typeof camera.zoom === 'number' && Number.isInteger(camera.zoom) &&
    camera.zoom >= 3 && camera.zoom <= 18
}

function validScope(scope: string): boolean {
  return typeof scope === 'string' && scope.length > 0 && scope.length <= 1024
}

function sweep(now: number) {
  for (const [scope, entry] of sessions) {
    if (entry.seen > now || now - entry.seen >= XDRIVE_BAIDU_NATIVE_CAMERA_TTL_MS) {
      sessions.delete(scope)
    }
  }
}

function clone(camera: XDriveBaiduNativeCameraSnapshot): XDriveBaiduNativeCameraSnapshot {
  // Allowlist only four primitive fields; never preserve SDK extras.
  return { coordinate_space: 'bd09ll', latitude: camera.latitude,
    longitude: camera.longitude, zoom: camera.zoom }
}

export function xDriveReadBaiduNativeCamera(
  scope: string, now = Date.now(),
): XDriveBaiduNativeCameraSnapshot | undefined {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0) return undefined
  sweep(now)
  const entry = sessions.get(scope)
  if (!entry || !xDriveValidBaiduNativeCameraSnapshot(entry.camera)) return undefined
  sessions.delete(scope)
  sessions.set(scope, entry)
  return clone(entry.camera)
}

export function xDriveRememberBaiduNativeCamera(
  scope: string, camera: XDriveBaiduNativeCameraSnapshot, now = Date.now(),
): boolean {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0 ||
      !xDriveValidBaiduNativeCameraSnapshot(camera)) return false
  sweep(now)
  sessions.delete(scope)
  sessions.set(scope, { camera: clone(camera), seen: now })
  while (sessions.size > maxSessions) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}

export function xDriveClearBaiduNativeCamera(scope: string): void {
  if (validScope(scope)) sessions.delete(scope)
}

/** Read BMap.getCenter/getZoom only as typed BD-09 camera state. */
export function xDriveCaptureBaiduNativeCamera(map: unknown): XDriveBaiduNativeCameraSnapshot | null {
  if (!map || typeof map !== 'object') return null
  try {
    const candidate = map as {
      getCenter?: () => { lng?: unknown; lat?: unknown }
      getZoom?: () => unknown
    }
    if (typeof candidate.getCenter !== 'function' ||
        typeof candidate.getZoom !== 'function') return null
    const point = candidate.getCenter()
    const camera = { coordinate_space: 'bd09ll' as const,
      longitude: point?.lng, latitude: point?.lat, zoom: candidate.getZoom() }
    return xDriveValidBaiduNativeCameraSnapshot(camera) ? clone(camera) : null
  } catch {
    return null
  }
}
