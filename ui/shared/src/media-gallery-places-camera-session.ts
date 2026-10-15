/** Ephemeral, scope-isolated Gallery Places camera return.
 * No localStorage, URL, Service Worker or photo-media cache. */
export interface XDrivePlacesCameraPosition {
  latitude: number
  longitude: number
  zoom: number
}
export interface XDrivePlacesViewportCamera extends XDrivePlacesCameraPosition {
  viewportOffset: number
}
export interface XDrivePlacesCameraSnapshot extends XDrivePlacesViewportCamera {
  placesPageOffset: number
  focusPlaceID?: string
}
export function xDriveValidPlacesCameraPosition(value: unknown): value is XDrivePlacesCameraPosition {
  if (typeof value !== 'object' || value === null) return false
  const camera = value as Partial<XDrivePlacesCameraPosition>
  return typeof camera.latitude === 'number' && Number.isFinite(camera.latitude) &&
    camera.latitude >= -85 && camera.latitude <= 85 &&
    typeof camera.longitude === 'number' && Number.isFinite(camera.longitude) &&
    camera.longitude >= -180 && camera.longitude <= 180 &&
    typeof camera.zoom === 'number' && Number.isInteger(camera.zoom) &&
    camera.zoom >= 3 && camera.zoom <= 18
}
export function xDriveValidPlacesCameraSnapshot(value: unknown): value is XDrivePlacesCameraSnapshot {
  if (!xDriveValidPlacesCameraPosition(value)) return false
  const state = value as Partial<XDrivePlacesCameraSnapshot>
  return typeof state.viewportOffset === 'number' && Number.isSafeInteger(state.viewportOffset) &&
    state.viewportOffset >= 0 && state.viewportOffset <= 10_000_000 &&
    typeof state.placesPageOffset === 'number' && Number.isSafeInteger(state.placesPageOffset) &&
    state.placesPageOffset >= 0 && state.placesPageOffset <= 10_000_000 &&
    (state.focusPlaceID === undefined ||
      (typeof state.focusPlaceID === 'string' && state.focusPlaceID.startsWith('place:') &&
        state.focusPlaceID.length <= 128))
}
const maxSessions = 8
export const XDRIVE_PLACES_CAMERA_TTL_MS = 10 * 60 * 1000
const sessions = new Map<string, { state: XDrivePlacesCameraSnapshot; seen: number }>()
function validScope(scope: string) {
  return typeof scope === 'string' && scope.length > 0 && scope.length <= 1024
}
function sweep(now: number) {
  for (const [scope, entry] of sessions) {
    if (entry.seen > now || now - entry.seen >= XDRIVE_PLACES_CAMERA_TTL_MS) sessions.delete(scope)
  }
}
export function xDriveReadPlacesCamera(scope: string, now = Date.now()) {
  if (!validScope(scope) || !Number.isFinite(now)) return undefined
  sweep(now)
  const entry = sessions.get(scope)
  if (!entry || !xDriveValidPlacesCameraSnapshot(entry.state)) return undefined
  sessions.delete(scope)
  sessions.set(scope, entry)
  return { ...entry.state }
}
export function xDriveRememberPlacesCamera(
  scope: string, snapshot: XDrivePlacesCameraSnapshot, now = Date.now(),
) {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0 ||
      !xDriveValidPlacesCameraSnapshot(snapshot)) return false
  sweep(now)
  sessions.delete(scope)
  sessions.set(scope, { state: { ...snapshot }, seen: now })
  while (sessions.size > maxSessions) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}
export function xDriveClearPlacesCamera(scope: string) {
  if (validScope(scope)) sessions.delete(scope)
}
