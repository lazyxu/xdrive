/** Owner-scoped place-list/selection return only, never map geometry.
 * Actual native map camera lives in its separate ephemeral BD-09LL session. */
export interface XDrivePlacesReturnSnapshot {
  placesPageOffset: number
  focusPlaceID?: string
}
export function xDriveValidPlacesReturnSnapshot(value: unknown): value is XDrivePlacesReturnSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<XDrivePlacesReturnSnapshot>
  if (!Object.keys(state).every(key => key === 'placesPageOffset' || key === 'focusPlaceID')) return false
  return typeof state.placesPageOffset === 'number' && Number.isSafeInteger(state.placesPageOffset) &&
    state.placesPageOffset >= 0 && state.placesPageOffset <= 10_000_000 &&
    (state.focusPlaceID === undefined ||
      (typeof state.focusPlaceID === 'string' && state.focusPlaceID.startsWith('place:') &&
       state.focusPlaceID.length <= 128))
}
const maxSessions = 8
export const XDRIVE_PLACES_RETURN_TTL_MS = 10 * 60 * 1000
const sessions = new Map<string, { state: XDrivePlacesReturnSnapshot; seen: number }>()
function validScope(scope: string) {
  return typeof scope === 'string' && scope.length > 0 && scope.length <= 1024
}
function sweep(now: number) {
  for (const [scope, entry] of sessions) {
    if (entry.seen > now || now - entry.seen >= XDRIVE_PLACES_RETURN_TTL_MS) sessions.delete(scope)
  }
}
function clone(state: XDrivePlacesReturnSnapshot): XDrivePlacesReturnSnapshot {
  return { placesPageOffset: state.placesPageOffset,
    ...(state.focusPlaceID ? { focusPlaceID: state.focusPlaceID } : {}) }
}
export function xDriveReadPlacesReturn(scope: string, now = Date.now()) {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0) return undefined
  sweep(now)
  const entry = sessions.get(scope)
  if (!entry || !xDriveValidPlacesReturnSnapshot(entry.state)) return undefined
  sessions.delete(scope)
  sessions.set(scope, entry)
  return clone(entry.state)
}
export function xDriveRememberPlacesReturn(
  scope: string, snapshot: XDrivePlacesReturnSnapshot, now = Date.now(),
) {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0 ||
      !xDriveValidPlacesReturnSnapshot(snapshot)) return false
  sweep(now)
  sessions.delete(scope)
  sessions.set(scope, { state: clone(snapshot), seen: now })
  while (sessions.size > maxSessions) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}
export function xDriveClearPlacesReturn(scope: string) {
  if (validScope(scope)) sessions.delete(scope)
}
