/**
 * Server/account Viewer quality contract. This policy does not persist data,
 * authorize requests or load images. The Server must enforce admin maximum.
 */
export type XDriveViewerQualityPreset = 'economy' | 'balanced' | 'high'
export const XDRIVE_VIEWER_QUALITY_DEFAULT: XDriveViewerQualityPreset = 'high'
export const XDRIVE_VIEWER_QUALITY_OPTIONS: readonly {
  value: XDriveViewerQualityPreset
  label: string
  maxEdge: number
}[] = [
  { value: 'economy', label: '省流量', maxEdge: 1280 },
  { value: 'balanced', label: '均衡', maxEdge: 2048 },
  { value: 'high', label: '高清', maxEdge: 4096 },
]
const rank: Record<XDriveViewerQualityPreset, number> = {
  economy: 1, balanced: 2, high: 3,
}
export function xDriveParseViewerQualityPreset(value: unknown): XDriveViewerQualityPreset {
  if (value == null || value === '') return XDRIVE_VIEWER_QUALITY_DEFAULT
  if (value === 'economy' || value === 'balanced' || value === 'high') return value
  throw new Error('Invalid Viewer quality preset')
}
export type XDriveViewerQualitySelection = {
  requested: XDriveViewerQualityPreset
  effective: XDriveViewerQualityPreset
  adminMaximum: XDriveViewerQualityPreset
  capped: boolean
}
export function xDriveResolveViewerQuality(
  accountPreference: unknown,
  deviceOverride: unknown,
  adminMaximum: unknown,
): XDriveViewerQualitySelection {
  const account = xDriveParseViewerQualityPreset(accountPreference)
  const maximum = xDriveParseViewerQualityPreset(adminMaximum)
  const requested = deviceOverride == null || deviceOverride === ''
    ? account : xDriveParseViewerQualityPreset(deviceOverride)
  const capped = rank[requested] > rank[maximum]
  return { requested, effective: capped ? maximum : requested,
    adminMaximum: maximum, capped }
}
/**
 * Key the foreground attempt by Server, Owner, source and selected tier.
 * Changing quality must cancel the old attempt, not clear disk caches.
 */
export function xDriveViewerQualityRequestIdentity(
  serverIdentity: string, ownerIdentity: string, nodeID: number,
  revision: number, sourceSHA: string, quality: XDriveViewerQualityPreset,
): string {
  if (!serverIdentity || !ownerIdentity || !Number.isSafeInteger(nodeID) ||
      nodeID <= 0 || !Number.isSafeInteger(revision) || revision <= 0 ||
      !/^[a-f0-9]{64}$/i.test(sourceSHA) || !rank[quality]) {
    throw new Error('Invalid Viewer request identity')
  }
  return JSON.stringify([serverIdentity, ownerIdentity, nodeID, revision,
    sourceSHA.toLowerCase(), quality])
}
