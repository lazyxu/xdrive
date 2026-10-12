import type { XDriveServiceDependency } from './service-dependencies'

export type XDriveServiceOverviewSignal = {
  label: '配置' | '部署' | '健康' | '生效'
  value: string
  tone: 'positive' | 'negative' | 'attention' | 'neutral'
}

// Never turn legacy status='ready' or a saved desired revision into trusted
// installation/health/effect evidence. Missing axes on old Servers/Agents
// are explicitly unknown and must not increase the positive summary counts.
export function xDriveSystemDependenciesOverviewSummary(services: readonly XDriveServiceDependency[]) {
  const healthVerified = services.filter((item) => item.health_state === 'ready').length
  const healthFailed = services.filter((item) => item.health_state === 'failed').length
  const activationVerified = services.filter((item) => item.activation_state === 'verified').length
  return {
    reported: services.length,
    healthVerified,
    healthFailed,
    healthUnverified: services.length - healthVerified - healthFailed,
    activationUnverified: services.length - activationVerified,
    activationPending: services.filter((item) => item.activation_state === 'pending').length,
  }
}

// Missing fixed IDs are unverified, not healthy, failed or actually applied.
export function xDriveSystemDependenciesOverviewCoverage(
  services: readonly XDriveServiceDependency[], expectedServiceCount: number,
) {
  const observed = xDriveSystemDependenciesOverviewSummary(services)
  const unreported = Math.max(0, expectedServiceCount - observed.reported)
  return {
    ...observed,
    unreported,
    healthUnverified: observed.healthUnverified + unreported,
    activationUnverified: observed.activationUnverified + unreported,
  }
}

export function xDriveSystemDependencyOverviewSignals(
  service: XDriveServiceDependency,
): XDriveServiceOverviewSignal[] {
  const configuration = service.configuration_state === 'configured'
    ? '已配置' : service.configuration_state === 'unconfigured' ? '未配置' : '未确认'
  const installation = service.installation_state === 'observed'
    ? '已观测' : service.installation_state === 'external' ? '外部服务' : '未确认'

  const health = service.health_state === 'ready'
    ? '正常' : service.health_state === 'failed' ? '异常'
      : service.health_state === 'not-checked' ? '未检测' : '未确认'
  const activation = service.activation_state === 'verified'
    ? '已核验' : service.activation_state === 'local-effective' ? '本机读取'
      : service.activation_state === 'pending' ? '待生效'
        : service.activation_state === 'deployment-only' ? '需受控部署' : '未核验'

  return [
    { label: '配置', value: configuration,
      tone: service.configuration_state === 'unconfigured' ? 'attention' : 'neutral' },
    { label: '部署', value: installation, tone: 'neutral' },
    { label: '健康', value: health,
      tone: service.health_state === 'ready' ? 'positive'
        : service.health_state === 'failed' ? 'negative'
          : service.health_state === 'not-checked' ? 'attention' : 'neutral' },
    { label: '生效', value: activation,
      tone: service.activation_state === 'verified' ? 'positive'
        : service.activation_state === 'pending' ? 'attention' : 'neutral' },
  ]
}
