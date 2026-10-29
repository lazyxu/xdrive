/** Exact authenticated Owner Photo Info -> BD-09 camera HINT.
 *
 * This module has no SDK/provider dependency and no credential/token/GPS
 * state. The returned position is NOT proof that a map cell or thumbnail
 * remains authorized: the trusted Gallery Parent must recheck current signed
 * /cells and its original Owner membership before it presents photographs.
 */
export type XDriveBaiduOwnerPhotoFocus = Readonly<{
  coordinate_space: 'bd09ll'
  index_scope: 'owner_gps_auto_index'
  node_id: number
  node_revision: number
  latitude: number
  longitude: number
}>

const MAX_ID = Number.MAX_SAFE_INTEGER
const positiveID = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_ID

/** Only selected current Node identity may enter a URL. */
export function xDriveBaiduOwnerPhotoFocusParams(
  nodeID: unknown, revision: unknown,
): URLSearchParams | null {
  if (!positiveID(nodeID) || !positiveID(revision)) return null
  return new URLSearchParams({
    node_id: String(nodeID),
    node_revision: String(revision),
  })
}

/** WebKit may not implement throwIfAborted(). Unreadable status fails closed. */
export function xDriveOwnerPhotoFocusSignalActive(
  signal?: AbortSignal | null,
): boolean {
  try { return signal?.aborted === false }
  catch { return false }
}

/** Fail closed for every additional or missing field, including raw WGS84,
 * Owner IDs, provider URLs, EXIF and private capability/session keys. */
export function xDriveValidBaiduOwnerPhotoFocus(
  raw: unknown, nodeID: number, revision: number,
): raw is XDriveBaiduOwnerPhotoFocus {
  if (!positiveID(nodeID) || !positiveID(revision) ||
      !raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const record = raw as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 6 ||
      keys.some(key => ![
        'coordinate_space', 'index_scope', 'node_id', 'node_revision',
        'latitude', 'longitude',
      ].includes(key))) return false
  return record.coordinate_space === 'bd09ll' &&
    record.index_scope === 'owner_gps_auto_index' &&
    record.node_id === nodeID && record.node_revision === revision &&
    typeof record.latitude === 'number' && Number.isFinite(record.latitude) &&
    record.latitude >= -90 && record.latitude <= 90 &&
    typeof record.longitude === 'number' && Number.isFinite(record.longitude) &&
    record.longitude >= -180 && record.longitude <= 180
}
