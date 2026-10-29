import {
  xDriveOwnerPhotoFocusSignalActive, xDriveValidBaiduOwnerPhotoFocus,
} from './media-gallery-baidu-photo-focus'
import {
  xDriveValidBaiduNativeCameraSnapshot,
} from './media-gallery-baidu-native-camera-session'
import { xDriveBaiduMapPhotoScopeKey } from './media-gallery-baidu-map-photo-scope'
import type {
  XDriveBaiduNativeCameraSnapshot,
} from './media-gallery-baidu-native-camera-session'
import type {
  XDriveBaiduMapPhotoScope,
} from './media-gallery-baidu-map-photo-scope'

/** Trusted Gallery Parent ONLY. No raw photo GPS, media bytes or Provider SDK
 * state may enter this cross-async Owner focus decision. */
export type XDrivePhotoFocusIdentity = Readonly<{
  nodeID: number
  revision: number
}>
export type XDrivePhotoFocusOwnerState = Readonly<{
  ownerScope: string
  photoScope: XDriveBaiduMapPhotoScope
}>
export type XDrivePhotoFocusRead = (
  nodeID: number, revision: number, signal: AbortSignal,
) => Promise<unknown>

export type XDrivePhotoFocusCameraResult =
  | Readonly<{ kind: 'ready'; camera: XDriveBaiduNativeCameraSnapshot }>
  | Readonly<{ kind: 'stale' | 'invalid' | 'unavailable' }>

const invalidScopeKey = 'invalid-bd09-map-scope'
const focusZoom = 16

function currentOwnerScope(
  captured: XDrivePhotoFocusOwnerState, capturedKey: string,
  readCurrent: () => XDrivePhotoFocusOwnerState | null,
): boolean {
  try {
    const active = readCurrent()
    return active?.ownerScope === captured.ownerScope &&
      xDriveBaiduMapPhotoScopeKey(active.photoScope) === capturedKey
  } catch {
    // Safari storage, stale authenticated Host ports, and torn-down React
    // sessions must NEVER silently revert to a global or prior Owner map.
    return false
  }
}

/**
 * Turn a fresh, signed Server-derived BD-09 photo focus into a native camera
 * HINT for the trusted React Parent, never a Gallery membership grant.
 *
 * Call only after the original Gallery has admitted its precise Owner/album
 * filter scope. Require a live, caller-owned AbortSignal. Check the same Owner
 * and exact reviewed Gallery scope both BEFORE and AFTER awaiting the Server;
 * a logout, same-route change, or a new photo Viewer cannot apply stale focus.
 *
 * The UI must still re-fetch signed /cells for the resulting camera and
 * reauthorize /cell-items before displaying a photo. No original WGS84,
 * Node/Owner ID, credentials or signed media URL enters the returned camera.
 */
export async function xDriveResolveBaiduOwnerPhotoFocusCamera(
  selection: XDrivePhotoFocusIdentity,
  owner: XDrivePhotoFocusOwnerState,
  read: XDrivePhotoFocusRead,
  readCurrent: () => XDrivePhotoFocusOwnerState | null,
  signal: AbortSignal,
  previousCamera?: XDriveBaiduNativeCameraSnapshot | null,
): Promise<XDrivePhotoFocusCameraResult> {
  if (!selection || !Number.isSafeInteger(selection.nodeID) ||
      selection.nodeID < 1 || !Number.isSafeInteger(selection.revision) ||
      selection.revision < 1 || !owner ||
      typeof owner.ownerScope !== 'string' ||
      !owner.ownerScope || owner.ownerScope.length > 1024 ||
      typeof read !== 'function' || typeof readCurrent !== 'function')
    return { kind: 'invalid' }
  if (!xDriveOwnerPhotoFocusSignalActive(signal))
    return { kind: 'stale' }
  const scopeKey = xDriveBaiduMapPhotoScopeKey(owner.photoScope)
  if (scopeKey === invalidScopeKey)
    return { kind: 'invalid' }
  if (!currentOwnerScope(owner, scopeKey, readCurrent))
    return { kind: 'stale' }

  let answer: unknown
  try {
    answer = await read(selection.nodeID, selection.revision, signal)
  } catch {
    // Do not claim that a real failed/denied Server request succeeded, do not
    // fall back to the prior map camera or a fabricated GPS position.
    return { kind: xDriveOwnerPhotoFocusSignalActive(signal) &&
      currentOwnerScope(owner, scopeKey, readCurrent) ? 'unavailable' : 'stale' }
  }
  if (!xDriveOwnerPhotoFocusSignalActive(signal) ||
      !currentOwnerScope(owner, scopeKey, readCurrent))
    return { kind: 'stale' }
  if (!xDriveValidBaiduOwnerPhotoFocus(
    answer, selection.nodeID, selection.revision))
    return { kind: 'invalid' }

  // Photo-detail zoom must not zoom OUT from an already-valid close-up.
  // A valid but polar BD-09 position may still be outside the SDK's reviewed
  // camera bounds (±85): reject it instead of reinterpreting WGS84.
  const previous = previousCamera &&
    xDriveValidBaiduNativeCameraSnapshot(previousCamera)
      ? previousCamera : null
  const camera: XDriveBaiduNativeCameraSnapshot = {
    coordinate_space: 'bd09ll',
    latitude: answer.latitude,
    longitude: answer.longitude,
    zoom: Math.max(focusZoom, previous?.zoom ?? focusZoom),
  }
  if (!xDriveValidBaiduNativeCameraSnapshot(camera))
    return { kind: 'invalid' }
  return { kind: 'ready', camera }
}
