export type XDriveFileExplorerAvailabilityKind =
  | 'local'
  | 'always-local'
  | 'online-only'
  | 'cloud'
  | 'mixed'
  | 'syncing'
  | 'error'

export type XDriveFileExplorerAvailability = {
  kind: XDriveFileExplorerAvailabilityKind
  label: string
  title: string
  progress?: number
}

export type XDriveFileExplorerAvailabilitySnapshot = {
  mode?: string
  pinned?: boolean
  onlineOnly?: boolean
  availableOffline?: boolean
  mixed?: boolean
  syncing?: boolean
  progress?: number
}

const availabilityPresentation: Record<
  XDriveFileExplorerAvailabilityKind,
  Pick<XDriveFileExplorerAvailability, 'label' | 'title'>
> = {
  local: { label: '本地可用', title: '当前设备可离线使用' },
  'always-local': { label: '始终保留在此设备上', title: '始终保留在此设备上' },
  'online-only': { label: '仅联机', title: '仅联机，需要时从云端下载' },
  cloud: { label: '云端', title: '当前仅在云端完整可用' },
  mixed: { label: '混合 · 部分内容已在本地', title: '混合 · 部分内容已在本地' },
  syncing: { label: '正在同步', title: '正在与云端同步' },
  error: { label: '状态异常', title: '无法读取当前设备的可用性状态' },
}

export function xDriveFileExplorerAvailability(
  kind: XDriveFileExplorerAvailabilityKind,
  progress?: number,
): XDriveFileExplorerAvailability {
  const presentation = availabilityPresentation[kind]
  return {
    kind,
    ...presentation,
    ...(typeof progress === 'number' && Number.isFinite(progress)
      ? { progress: Math.max(0, Math.min(100, progress)) }
      : {}),
  }
}

export function xDriveFileExplorerAvailabilityFromSnapshot(
  state: XDriveFileExplorerAvailabilitySnapshot,
): XDriveFileExplorerAvailability {
  const mode = state.mode?.trim().toLowerCase() ?? ''
  if (state.syncing || mode === 'syncing') return xDriveFileExplorerAvailability('syncing', state.progress)
  if (state.mixed || mode === 'mixed') return xDriveFileExplorerAvailability('mixed')
  if (state.pinned || mode === 'always-local') return xDriveFileExplorerAvailability('always-local')
  if (state.onlineOnly || mode === 'online-only') return xDriveFileExplorerAvailability('online-only')
  if (mode === 'cloud' || state.availableOffline === false) return xDriveFileExplorerAvailability('cloud')
  return xDriveFileExplorerAvailability('local')
}

export function xDriveFileExplorerAvailabilityError() {
  return xDriveFileExplorerAvailability('error')
}
