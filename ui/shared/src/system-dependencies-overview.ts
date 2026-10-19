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
  // A healthy existing Caddy deployment is observed even when it has NO
  // administrator-saved desired revision. Never call that a completed Apply.
  const activation = service.id === 'caddy' &&
    service.installation_state === 'observed' &&
    service.activation_state === 'deployment-only'
    ? '宿主已观测' : service.activation_state === 'verified'
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

// Display-only main state. Four independent backend evidence axes remain
// authoritative in Status detail, never in a synthetic "applied" state.
export type XDriveDashboardState = 'healthy' | 'failed' | 'attention' | 'disabled' | 'unknown'
export type XDriveDashboardFilter = 'all' | 'healthy' | 'attention' | 'disabled' | 'unknown'
export type XDriveDashboardAssessment = { state: XDriveDashboardState; label: string; summary: string }

export function xDriveDashboardAssessment(service: XDriveServiceDependency | null): XDriveDashboardAssessment {
  if (!service) return { state: 'unknown', label: '未报告', summary: 'Server/Agent 未提供可信服务状态' }
  // A genuine failed probe wins over old status flags. Legacy unavailable
  // alone cannot prove an error, and legacy ready alone cannot prove health.
  if (service.health_state === 'failed') return {
    state: 'failed', label: '健康异常', summary: '健康探针失败，请查看服务详情',
  }
  if (service.status === 'disabled') return {
    state: 'disabled', label: '未启用', summary: '当前服务未启用',
  }
  if (service.status === 'planned') return {
    state: 'disabled', label: '尚未接入', summary: '该能力当前尚未接入',
  }
  if (service.activation_state === 'pending') return {
    state: 'attention', label: '待生效', summary: '目标修订尚未确认生效',
  }
  if (service.configuration_state === 'unconfigured') return {
    state: 'attention', label: '待配置', summary: '当前服务缺少配置',
  }
  if (service.status === 'ready' && service.health_state === 'ready') return {
    state: 'healthy', label: '健康正常',
    summary: service.activation_state === 'verified'
      ? '健康检查通过 · 修订核验范围见详情'
      : '健康检查通过 · 生效仍需独立核对',
  }
  if (service.health_state === 'not-checked') return {
    state: 'attention', label: '待检测', summary: '尚无本次健康检测结果',
  }
  return { state: 'unknown', label: '状态未知', summary: '尚无可信健康证据' }
}

export function xDriveDashboardCounts(entries: readonly {service: XDriveServiceDependency | null}[]) {
  const counts = { total: entries.length, healthy: 0, failed: 0, attention: 0, disabled: 0, unknown: 0 }
  for (const entry of entries) counts[xDriveDashboardAssessment(entry.service).state]++
  return counts
}

export function xDriveDashboardMatches(state: XDriveDashboardState, filter: XDriveDashboardFilter) {
  return filter === 'all' || (filter === 'attention'
    ? state === 'attention' || state === 'failed' : state === filter)
}
