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

// Fixed, instance-wide services only. Older or malformed Server responses
// must not import per-user Source/同步文件夹 records into the admin workspace.
const groupByService: Record<XDriveSystemDependencyID, 'core' | 'media' | 'intelligence' | 'location'> = {
  database: 'core',
  storage: 'core',
  'background-worker': 'core',
  caddy: 'core',
  'media-worker': 'media',
  'photo-face': 'intelligence',
  'photo-smart': 'intelligence',
  'photo-semantic': 'intelligence',
  'photo-creative': 'intelligence',
  'baidu-map': 'location',
  geonames: 'location',
}

// Missing-service labels are from a fixed allowlist, never an old Server response.
const missingServiceLabels: Record<XDriveSystemDependencyID, string> = {
  database: 'PostgreSQL',
  storage: '文件存储',
  'background-worker': '后台 Worker',
  caddy: 'Caddy / HTTPS 网关',
  'media-worker': 'FFmpeg Media Worker',
  'photo-face': '人脸检测与人物聚类',
  'photo-smart': '动物／物体识别与 OCR',
  'photo-semantic': '图片语义搜索',
  'photo-creative': '照片创作处理',
  'baidu-map': '百度地图 Server API',
  geonames: 'GeoNames 离线地名',
}

export function xDriveVisibleSystemDependencies<T extends { id: string; group: string }>(
  services: readonly T[],
): T[] {
  const recognized = new Map<string, T>()
  const ambiguous = new Set<string>()
  for (const item of services) {
    if (!validServiceIDs.has(item.id) ||
        item.group !== groupByService[item.id as XDriveSystemDependencyID] ||
        ambiguous.has(item.id)) continue
    if (recognized.has(item.id)) {
      // Two entries claiming the same global service cannot be distinguished
      // safely. Hide both, rather than displaying an arbitrary first status.
      recognized.delete(item.id)
      ambiguous.add(item.id)
      continue
    }
    recognized.set(item.id, item)
  }
  return XDRIVE_SYSTEM_DEPENDENCY_IDS.flatMap((id) => {
    const item = recognized.get(id)
    return item ? [item] : []
  })
}

// Missing entries are independent display-only records, NOT synthesized service
// status/capabilities. Invalid, duplicate and user-source rows stay excluded.
export function xDriveSystemDependenciesOverviewEntries<T extends { id: string; group: string }>(
  services: readonly T[],
) {
  const visible = xDriveVisibleSystemDependencies(services)
  const byID = new Map<string, T>(visible.map((item) => [item.id, item]))
  return XDRIVE_SYSTEM_DEPENDENCY_IDS.map((id) => ({
    id,
    group: groupByService[id],
    label: missingServiceLabels[id],
    service: byID.get(id) ?? null,
  }))
}

// A fixed ID absent from the allowlisted inventory is unreported, not an
// implicit healthy service or permission to show configuration controls.
export function xDriveSystemDependencySelectionMissing(
  selectedID: string,
  visibleServices: readonly { id: string }[],
): boolean {
  return validServiceIDs.has(selectedID) &&
    !visibleServices.some((item) => item.id === selectedID)
}

// In-app route changes and Desktop workspace changes share the same exit
// policy. Opening another browser tab never leaves the existing editor.
export function xDriveSystemDependenciesNeedsExitConfirmation(
  currentApp: string, nextApp: string, hasUnsavedEdits: boolean, newTab = false,
): boolean {
  return currentApp === 'admin-services' &&
    nextApp !== 'admin-services' && hasUnsavedEdits && !newTab
}
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
