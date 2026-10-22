/**
 * P0-03 A3i-Msg1: pure protocol for a FUTURE independently hosted
 * cross-Origin Baidu map iframe. No SDK import, script insertion or
 * automatic activation. The existing same-document loader is NOT isolated.
 *
 * The untrusted child may suggest a camera or opaque cell activation, never
 * authorize a photo or obtain Owner credentials, images or node identity.
 */
export type XDriveBaiduIsolatedCamera = Readonly<{
  coordinate_space: 'bd09ll'
  latitude: number
  longitude: number
  zoom: number
}>
export type XDriveBaiduIsolatedBounds = Readonly<{ coordinate_space: 'bd09ll'; west: number; south: number; east: number; north: number }>
export type XDriveBaiduIsolatedCell = Readonly<{
  key: string
  latitude: number
  longitude: number
  count: number
}>
export type XDriveBaiduChildEvent =
  | Readonly<{ version: 1; generation: number; nonce: string; kind: 'ready' }>
  | Readonly<{ version: 1; generation: number; nonce: string; kind: 'cancel' }>
  | Readonly<{ version: 1; generation: number; nonce: string; kind: 'map-ready' | 'map-failed' }>
  | Readonly<{ version: 1; generation: number; nonce: string; kind: 'viewport'; bounds: XDriveBaiduIsolatedBounds }>
  | Readonly<{ version: 1; generation: number; nonce: string; kind: 'camera'; camera: XDriveBaiduIsolatedCamera }>
  | Readonly<{ version: 1; generation: number; nonce: string; kind: 'activate-cell'; key: string }>
export type XDriveBaiduParentCellsMessage = Readonly<{
  version: 1
  generation: number
  nonce: string
  kind: 'cells'
  cells: readonly XDriveBaiduIsolatedCell[]
}>
/** One-time return camera, never original WGS84 photo EXIF or Owner identity. */
export type XDriveBaiduParentCameraMessage = Readonly<{
  version: 1
  generation: number
  nonce: string
  kind: 'restore-camera'
  camera: XDriveBaiduIsolatedCamera
}>
export type XDriveBaiduIsolationBoundary = Readonly<{
  parentOrigin: string
  childOrigin: string
  childWindow: object
  generation: number
  nonce: string
}>
export type XDriveBaiduIsolatedMessageEvent = Readonly<{
  origin: string
  source: unknown
  data: unknown
}>

export const XDRIVE_BAIDU_ISOLATED_MESSAGE_VERSION = 1
export const XDRIVE_BAIDU_ISOLATED_MAX_CELLS = 64
export const XDRIVE_BAIDU_ISOLATED_CHILD_BYTES = 2048
export const XDRIVE_BAIDU_ISOLATED_PARENT_BYTES = 8192

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
  } catch { return false }
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const actual = Object.keys(value)
    return actual.length === keys.length && actual.every(k => keys.includes(k))
  } catch { return false }
}
function stringBudget(value: unknown, bytes: number): boolean {
  try {
    const wire = JSON.stringify(value)
    return typeof wire === 'string' && new TextEncoder().encode(wire).length <= bytes
  } catch { return false }
}
function validOrigin(origin: string): boolean {
  if (typeof origin !== 'string' || origin.length > 253 || !origin.startsWith('https://')) return false
  try {
    const url = new URL(origin)
    return url.origin === origin && url.protocol === 'https:' &&
      url.username === '' && url.password === '' && url.search === '' &&
      url.hash === '' && url.pathname === '/'
  } catch { return false }
}
function validNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32,64}$/.test(value)
}
function validKey(value: unknown): value is string {
  // The trusted parent must mint 128-bit random, session-only IDs. Do not
  // encode PhotoAsset/Node IDs, filenames or GPS source identifiers in keys.
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
}
function boundsValid(value: unknown): value is XDriveBaiduIsolatedBounds {
  if (!record(value) || !exactKeys(value, ['coordinate_space','west','south','east','north'])) return false
  return value.coordinate_space === 'bd09ll' &&
    [value.west,value.south,value.east,value.north].every(v => typeof v === 'number' && Number.isFinite(v)) &&
    (value.west as number) >= -180 && (value.west as number) <= 180 &&
    (value.east as number) >= -180 && (value.east as number) <= 180 &&
    (value.south as number) >= -85 && (value.north as number) <= 85 &&
    (value.south as number) < (value.north as number) && value.west !== value.east
}
function cameraValid(value: unknown): value is XDriveBaiduIsolatedCamera {
  if (!record(value) || !exactKeys(value,
      ['coordinate_space', 'latitude', 'longitude', 'zoom'])) return false
  return value.coordinate_space === 'bd09ll' &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) &&
    value.latitude >= -85 && value.latitude <= 85 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) &&
    value.longitude >= -180 && value.longitude <= 180 &&
    typeof value.zoom === 'number' && Number.isInteger(value.zoom) &&
    value.zoom >= 3 && value.zoom <= 18
}

/** Disallow a same-Origin "sandbox" that would still expose Gallery DOM.
 * This validates only the origin-pair contract: actual iframe/CSP/Cookie
 * separation requires independent browser/security tests before activation. */
export function xDriveValidBaiduIsolatedBoundary(
  value: unknown,
): value is XDriveBaiduIsolationBoundary {
  if (!record(value) || !exactKeys(value,
      ['parentOrigin', 'childOrigin', 'childWindow', 'generation', 'nonce'])) return false
  return validOrigin(value.parentOrigin as string) &&
    validOrigin(value.childOrigin as string) &&
    value.parentOrigin !== value.childOrigin &&
    !!value.childWindow && (typeof value.childWindow === 'object' ||
      typeof value.childWindow === 'function') &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) > 0 &&
    (value.generation as number) <= Number.MAX_SAFE_INTEGER &&
    validNonce(value.nonce)
}

/** Every accepted event must match BOTH a particular iframe WindowProxy and
 * an exact cross-Origin HTTPS source, the active generation and random nonce.
 * This is a parser, NOT authorization for map data or media access. */
export function xDriveParseBaiduIsolatedChildEvent(
  event: XDriveBaiduIsolatedMessageEvent,
  boundary: XDriveBaiduIsolationBoundary,
): XDriveBaiduChildEvent | null {
  if (!xDriveValidBaiduIsolatedBoundary(boundary) || !event ||
      event.origin !== boundary.childOrigin ||
      event.source !== boundary.childWindow ||
      !record(event.data) ||
      !stringBudget(event.data, XDRIVE_BAIDU_ISOLATED_CHILD_BYTES)) return null
  const data = event.data
  if (data.version !== 1 || data.generation !== boundary.generation ||
      data.nonce !== boundary.nonce) return null
  switch (data.kind) {
    case 'ready':
    case 'map-ready':
    case 'map-failed':
    case 'cancel':
      if (!exactKeys(data, ['version', 'generation', 'nonce', 'kind'])) return null
      return { version: 1, generation: boundary.generation,
        nonce: boundary.nonce, kind: data.kind }
    case 'viewport':
      if (!exactKeys(data, ['version','generation','nonce','kind','bounds']) ||
          !boundsValid(data.bounds)) return null
      return { version: 1, generation: boundary.generation, nonce: boundary.nonce,
        kind: 'viewport', bounds: { ...data.bounds } }
    case 'camera':
      if (!exactKeys(data, ['version', 'generation', 'nonce', 'kind', 'camera']) ||
          !cameraValid(data.camera)) return null
      return { version: 1, generation: boundary.generation, nonce: boundary.nonce,
        kind: 'camera',
        camera: { coordinate_space: 'bd09ll',
          latitude: data.camera.latitude, longitude: data.camera.longitude,
          zoom: data.camera.zoom } }
    case 'activate-cell':
      if (!exactKeys(data, ['version', 'generation', 'nonce', 'kind', 'key']) ||
          !validKey(data.key)) return null
      return { version: 1, generation: boundary.generation,
        nonce: boundary.nonce, kind: 'activate-cell', key: data.key }
    default: return null
  }
}

/** Whitelist outbound permitted map data only: max 64 already explicitly
 * consented anonymized representative points. No Owner/asset/revision/URL,
 * JWT, Browser AK, Cookie, original photo pixels or metadata fields. */
export function xDriveCreateBaiduIsolatedCellsMessage(
  boundary: XDriveBaiduIsolationBoundary,
  proposed: readonly unknown[],
): XDriveBaiduParentCellsMessage | null {
  if (!xDriveValidBaiduIsolatedBoundary(boundary) ||
      !Array.isArray(proposed) || proposed.length > XDRIVE_BAIDU_ISOLATED_MAX_CELLS) return null
  const keys = new Set<string>()
  const cells: XDriveBaiduIsolatedCell[] = []
  for (const candidate of proposed) {
    if (!record(candidate) || !exactKeys(candidate,
        ['key', 'latitude', 'longitude', 'count']) ||
        !validKey(candidate.key) || keys.has(candidate.key) ||
        typeof candidate.latitude !== 'number' || !Number.isFinite(candidate.latitude) ||
        candidate.latitude < -85 || candidate.latitude > 85 ||
        typeof candidate.longitude !== 'number' || !Number.isFinite(candidate.longitude) ||
        candidate.longitude < -180 || candidate.longitude > 180 ||
        typeof candidate.count !== 'number' || !Number.isSafeInteger(candidate.count) ||
        candidate.count < 1 || candidate.count > 100_000_000) return null
    keys.add(candidate.key)
    cells.push({
      key: candidate.key, latitude: candidate.latitude,
      longitude: candidate.longitude, count: candidate.count,
    })
  }
  const message: XDriveBaiduParentCellsMessage = {
    version: 1, generation: boundary.generation, nonce: boundary.nonce,
    kind: 'cells', cells,
  }
  return stringBudget(message, XDRIVE_BAIDU_ISOLATED_PARENT_BYTES) ? message : null
}

/** Validated BD-09 return hint only: no JWT/Owner/photo/EXIF fields. */
export function xDriveCreateBaiduIsolatedCameraMessage(
  boundary: XDriveBaiduIsolationBoundary,
  camera: unknown,
): XDriveBaiduParentCameraMessage | null {
  try {
    if (!xDriveValidBaiduIsolatedBoundary(boundary) || !cameraValid(camera)) return null
    const message: XDriveBaiduParentCameraMessage = {
      version: 1, generation: boundary.generation, nonce: boundary.nonce,
      kind: 'restore-camera',
      camera: {
        coordinate_space: 'bd09ll', latitude: camera.latitude,
        longitude: camera.longitude, zoom: camera.zoom,
      },
    }
    return stringBudget(message, XDRIVE_BAIDU_ISOLATED_PARENT_BYTES) ? message : null
  } catch { return null }
}
