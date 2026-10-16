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
    verify: '仅检查当前存储就绪',
    history: '暂无存储部署修订记录',
    verifyTarget: { service: 'storage', tab: 'status' },
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
  },
  'photo-face': {
    configure: '共享宿主期望修订可编辑',
    enable: '只允许经审计安全启用',
    verify: '宿主回执及固定模型烟测',
    history: '宿主期望修订可回滚',
    configTarget: { service: 'photo-face', tab: 'config' },
    verifyTarget: { service: 'photo-face', tab: 'verify' },
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
