// Shared Web / Mobile Web / Desktop navigation contract for the administrator
// System Dependencies workspace. This is presentation state, not an API path.
export const XDRIVE_SYSTEM_DEPENDENCY_IDS = [
  'database', 'storage', 'background-worker', 'caddy',
  'media-worker', 'photo-face', 'photo-smart', 'photo-semantic',
  'photo-creative', 'baidu-map', 'geonames',
] as const

export type XDriveSystemDependencyID = typeof XDRIVE_SYSTEM_DEPENDENCY_IDS[number]
export type XDriveSystemDependencyTab = 'status' | 'config' | 'verify' | 'history'
export type XDriveSystemDependenciesLocation = {
  service?: XDriveSystemDependencyID
  policy?: 'photo-auto'
  tab?: XDriveSystemDependencyTab
}

const validServiceIDs = new Set<string>(XDRIVE_SYSTEM_DEPENDENCY_IDS)
const validTabs = new Set<string>(['status', 'config', 'verify', 'history'])

export function xDriveNormalizeSystemDependenciesLocation(value: {
  service?: string | null
  policy?: string | null
  tab?: string | null
} | null | undefined): XDriveSystemDependenciesLocation {
  if (!value) return {}
  const tab = validTabs.has(value.tab ?? '') ? value.tab as XDriveSystemDependencyTab : undefined
  // An explicit photo-auto policy target is independent of the eleven services.
  if (value.policy === 'photo-auto' && !value.service) {
    return { policy: 'photo-auto', tab: tab ?? 'config' }
  }
  if (value.service && validServiceIDs.has(value.service)) {
    return { service: value.service as XDriveSystemDependencyID, tab: tab ?? 'status' }
  }
  return {}
}

export function xDriveSystemDependenciesLocationKey(value: XDriveSystemDependenciesLocation) {
  const normalized = xDriveNormalizeSystemDependenciesLocation(value)
  return normalized.policy ? `policy:${normalized.policy}:${normalized.tab}`
    : normalized.service ? `service:${normalized.service}:${normalized.tab}`
      : 'overview'
}
