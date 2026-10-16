import type { XDriveSystemDependencyID, XDriveSystemDependenciesLocation } from './system-dependencies-navigation'

// UI-only capability inventory: a route being present is NOT proof that an
// old Server/Agent supports the endpoint, nor that a saved revision has taken
// effect. The actual API permissions and per-service probes remain authoritative.
export type XDriveSystemDependencyCapability = {
  configure: string
  enable: string
  verify: string
  history: string
  configTarget?: XDriveSystemDependenciesLocation
  verifyTarget?: XDriveSystemDependenciesLocation
  // Existing enable-management panel only; never host action or proof of effect.
  activationTarget?: XDriveSystemDependenciesLocation
  activationLabel?: string
}

// Include all 11 global dependencies and NO per-user Sync Folder / Sources.
// "启用" is about an actual service lifecycle, not saving desired config.
export const XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES: Record<
  XDriveSystemDependencyID, XDriveSystemDependencyCapability
> = {
  database: {
    configure: '连接池参数可修改',
    enable: '数据库启停由部署管理',
    verify: '当前实例连接和连接池修订',
    history: '连接池配置修订可查看',
    configTarget: { service: 'database', tab: 'config' },
    verifyTarget: { service: 'database', tab: 'verify' },
  },
  storage: {
    configure: '存储根目录和挂载由部署管理',
    enable: '不提供在线停用/迁移',
    verify: '手动刷新当前 Server 存储 Ready 探针；不证明文件读写或数据完整性',
    history: '暂无存储部署修订记录',
    verifyTarget: { service: 'storage', tab: 'verify' },
  },
  'background-worker': {
    configure: '扫描与并发调度可修改',
    enable: 'Worker 容器启停由部署管理',
    verify: '心跳及批次边界修订',
    history: '调度历史和回滚可用',
    configTarget: { service: 'background-worker', tab: 'config' },
    verifyTarget: { service: 'background-worker', tab: 'verify' },
  },
  caddy: {
    configure: 'HTTPS 期望和 AliDNS 可编辑',
    enable: '网关实际启停尚未开放',
    verify: '本机 TLS 证书/容器检测',
    history: 'HTTPS 期望修订可回滚',
    configTarget: { service: 'caddy', tab: 'config' },
    verifyTarget: { service: 'caddy', tab: 'verify' },
  },
  'media-worker': {
    configure: '启停目标及资源上限可修改',
    enable: '受限 Host Manager 可应用',
    verify: '宿主配额及 FFmpeg 探针',
    history: '已审计配置可回滚',
    configTarget: { service: 'media-worker', tab: 'config' },
    verifyTarget: { service: 'media-worker', tab: 'verify' },
    activationTarget: { service: 'media-worker', tab: 'config' },
    activationLabel: '管理受限启停与配置',
  },
  'photo-face': {
    configure: '共享宿主期望修订可编辑',
    enable: '只允许经审计安全启用',
    verify: '宿主回执及固定模型烟测',
    history: '宿主期望修订可回滚',
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-face', tab: 'verify' },
    activationTarget: { service: 'photo-face', tab: 'config' },
    activationLabel: '管理共享宿主安全启用',
  },
  'photo-smart': {
    configure: '共用 Photo Host 配置',
    enable: '无独立启停；共享宿主仅启用',
    verify: '分类与 OCR 固定模型烟测',
    history: '仅共享宿主修订可查',
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-smart', tab: 'verify' },
  },
  'photo-semantic': {
    configure: '共用 Photo Host 配置',
    enable: '无独立启停；共享宿主仅启用',
    verify: '语义文本/图像固定烟测',
    history: '仅共享宿主修订可查',
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-semantic', tab: 'verify' },
  },
  'photo-creative': {
    configure: '共用 Photo Host 配置',
    enable: '无独立启停；共享宿主仅启用',
    verify: '固定合成输入抠图烟测',
    history: '仅共享宿主修订可查',
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-creative', tab: 'verify' },
  },
  'baidu-map': {
    configure: 'Server AK 可加密修改',
    enable: '地图服务开关可编辑',
    verify: '按需实际取图验证',
    history: '无独立配置回滚页',
    configTarget: { service: 'baidu-map', tab: 'config' },
    verifyTarget: { service: 'baidu-map', tab: 'verify' },
    activationTarget: { service: 'baidu-map', tab: 'config' },
    activationLabel: '管理地图开关与 AK',
  },
  geonames: {
    configure: '匹配距离可编辑和热加载',
    enable: '数据挂载由部署管理',
    verify: '当前实例索引与修订',
    history: '距离修改和回滚可用',
    configTarget: { service: 'geonames', tab: 'config' },
    verifyTarget: { service: 'geonames', tab: 'verify' },
  },
}


// Quick links are not promises that a saved revision has taken effect.
// An old Server/Agent may report a service while its current bridge lacks the
// corresponding API. For a shared Photo Host target, BOTH the source service
// and the editable host service must be uniquely reported.
type XDriveSystemDependencyRuntimeMethod =
  | 'load' // Already authenticated GET /admin/services; bounded Ready probe.
  | 'loadPostgresPoolConfig' | 'savePostgresPoolConfig'
  | 'loadSourceWorkerConfig' | 'saveSourceWorkerConfig'
  | 'loadCaddyHTTPSConfig' | 'saveCaddyHTTPSConfig' | 'loadCaddyHTTPSPreflight'
  | 'loadMediaWorkerConfig' | 'saveMediaWorkerConfig' | 'applyMediaWorker'
  | 'loadPhotoHostConfig' | 'savePhotoHostConfig' | 'loadPhotoHostPreflight' | 'applyPhotoHost'
  | 'loadBaiduMapConfig' | 'saveBaiduMapConfig' | 'verifyBaiduMap'
  | 'loadGeoNamesConfig' | 'saveGeoNamesConfig'
export type XDriveSystemDependencyRuntimePort =
  Partial<Record<XDriveSystemDependencyRuntimeMethod, unknown>>
export type XDriveSystemDependencyRuntimeRow = {
  id: string
  config_mode?: string
  apply_mode?: string
  status?: string
}

const configPortRequirements: Record<XDriveSystemDependencyID, readonly XDriveSystemDependencyRuntimeMethod[]> = {
  database: ['loadPostgresPoolConfig', 'savePostgresPoolConfig'],
  storage: [],
  'background-worker': ['loadSourceWorkerConfig', 'saveSourceWorkerConfig'],
  caddy: ['loadCaddyHTTPSConfig', 'saveCaddyHTTPSConfig'],
  'media-worker': ['loadMediaWorkerConfig', 'saveMediaWorkerConfig'],
  'photo-face': ['loadPhotoHostConfig', 'savePhotoHostConfig'],
  'photo-smart': ['loadPhotoHostConfig', 'savePhotoHostConfig'],
  'photo-semantic': ['loadPhotoHostConfig', 'savePhotoHostConfig'],
  'photo-creative': ['loadPhotoHostConfig', 'savePhotoHostConfig'],
  'baidu-map': ['loadBaiduMapConfig', 'saveBaiduMapConfig'],
  geonames: ['loadGeoNamesConfig', 'saveGeoNamesConfig'],
}
const verifyPortRequirements: Record<XDriveSystemDependencyID, readonly XDriveSystemDependencyRuntimeMethod[]> = {
  database: ['load', 'loadPostgresPoolConfig'],
  storage: ['load'], // A fresh admin inventory invokes Store.Ready(ctx).
  'background-worker': ['load', 'loadSourceWorkerConfig'],
  caddy: ['loadCaddyHTTPSPreflight'],
  'media-worker': ['load', 'loadMediaWorkerConfig'],
  'photo-face': ['loadPhotoHostPreflight'],
  'photo-smart': ['loadPhotoHostPreflight'],
  'photo-semantic': ['loadPhotoHostPreflight'],
  'photo-creative': ['loadPhotoHostPreflight'],
  'baidu-map': ['verifyBaiduMap'],
  geonames: ['loadGeoNamesConfig'],
}

// These links navigate to existing config panels, never run host changes.
const activationPortRequirements: Partial<
  Record<XDriveSystemDependencyID, readonly XDriveSystemDependencyRuntimeMethod[]>
> = {
  'baidu-map': ['loadBaiduMapConfig', 'saveBaiduMapConfig'],
  'media-worker': ['loadMediaWorkerConfig', 'saveMediaWorkerConfig', 'applyMediaWorker'],
  'photo-face': ['loadPhotoHostConfig', 'savePhotoHostConfig', 'loadPhotoHostPreflight', 'applyPhotoHost'],
}
const activationApplyMode: Partial<Record<XDriveSystemDependencyID, string>> = {
  'baidu-map': 'immediate',
  'media-worker': 'controlled-restart',
  'photo-face': 'controlled-restart',
}
const reportedConfigModes = new Set(['in-app', 'deployment'])
const reportedApplyModes = new Set([
  'immediate', 'task-boundary', 'manual-reload', 'controlled-restart', 'not-available',
])

/**
 * Resolve optional navigation actions from *current* allowlisted inventory
 * and the current Web/Desktop bridge, never the static capability table alone.
 * This does not assert the Server will accept an action or that it took effect.
 */
export function xDriveSystemDependencyAvailableTargets(
  id: XDriveSystemDependencyID,
  services: readonly XDriveSystemDependencyRuntimeRow[],
  port: XDriveSystemDependencyRuntimePort,
): {
  configTarget?: XDriveSystemDependenciesLocation
  verifyTarget?: XDriveSystemDependenciesLocation
  activationTarget?: XDriveSystemDependenciesLocation
} {
  const capability = XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES[id]
  const reported = (target: string) => {
    const matching = services.filter((service) => service.id === target)
    if (matching.length !== 1) return null
    const service = matching[0]
    return service && reportedConfigModes.has(service.config_mode ?? '') &&
      reportedApplyModes.has(service.apply_mode ?? '') && service.status !== 'planned'
      ? service : null
  }
  // The selected service itself must be reported unambiguously and support a
  // known lifecycle contract, even when its config lives in the shared host.
  if (!reported(id)) return {}
  const hasMethods = (methods: readonly XDriveSystemDependencyRuntimeMethod[]) =>
    methods.every((method) => typeof port[method] === 'function')
  const configOwner = capability.configTarget ? reported(capability.configTarget.service ?? '') : null
  const configTarget = configOwner?.config_mode === 'in-app' &&
    hasMethods(configPortRequirements[id]) ? capability.configTarget : undefined
  const verifyOwner = capability.verifyTarget ? reported(capability.verifyTarget.service ?? '') : null
  const verifyTarget = verifyOwner && hasMethods(verifyPortRequirements[id])
    ? capability.verifyTarget : undefined
  // This checks only navigation to an existing bounded settings panel. The
  // server still enforces permissions and requires a separate real apply proof.
  const activationOwner = capability.activationTarget
    ? reported(capability.activationTarget.service ?? '') : null
  const requiredActivationMethods = activationPortRequirements[id]
  const activationTarget = activationOwner?.config_mode === 'in-app' &&
    activationOwner.apply_mode === activationApplyMode[id] &&
    requiredActivationMethods != null && hasMethods(requiredActivationMethods) &&
    configTarget ? capability.activationTarget : undefined
  if (!configTarget && !verifyTarget) return {}
  return activationTarget ? { configTarget, verifyTarget, activationTarget }
    : { configTarget, verifyTarget }
}
