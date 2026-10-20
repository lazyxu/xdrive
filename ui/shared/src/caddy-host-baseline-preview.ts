import type { XDriveCaddyHTTPSConfig, XDriveCaddyHTTPSPreflight } from './service-dependencies'
import { hasPersistedCaddyIntent } from './caddy-reconciliation'

export type CaddyHostLocalComparison = 'matched-local' | 'mismatch-local' | 'unverified'
export type CaddyHostBaselineReadOnlyPreview = {
  readonly_mode: true
  can_adopt: false
  desired_revision: number | null
  domain_comparison: CaddyHostLocalComparison
  lan_comparison: CaddyHostLocalComparison
  ingress_change_risk: string
  blockers: string[]
}

function safeLocalComparison(value: unknown): CaddyHostLocalComparison {
  return value === 'matched-local' || value === 'mismatch-local'
    ? value : 'unverified'
}

// This preview does not derive a live Host identity from saved DB targets,
// does not expose AliDNS credentials, and can NEVER grant a mutation.
export function assessCaddyHostBaselineReadOnly(
  config: XDriveCaddyHTTPSConfig | null | undefined,
  preflight: XDriveCaddyHTTPSPreflight | null | undefined,
): CaddyHostBaselineReadOnlyPreview {
  const blockers: string[] = []
  const persisted = hasPersistedCaddyIntent(config)
  if (!config || !persisted) blockers.push('未取得有效的已保存管理修订；修订 #0 的部署提示不是 DB 目标。')
  if (!preflight) blockers.push('尚未执行管理员手动只读预检。')
  const sameRevision = persisted && !!preflight &&
    Number.isSafeInteger(preflight.desired_revision) &&
    preflight.desired_revision === config.revision &&
    preflight.revision_snapshot_consistent === true
  if (preflight && !sameRevision) blockers.push('HTTPS/AliDNS 快照修订不一致或缺少一致性证据；请重新读取。')

  const observed = sameRevision && config?.host_observed === true &&
    preflight?.host_observed === true && preflight.host_ingress_ready === true
  if (preflight && !observed) blockers.push('缺少本次目标修订对应的可信宿主本机观测与入口健康证据。')
  if (config?.host_apply_pending) blockers.push('存在待协调 Host Pending，不能采纳新基线。')
  if (preflight && preflight.host_instance_generation !== 'same-instance-local') {
    blockers.push('未取得固定 Caddy 容器同一实例代际证据。')
  }
  if (preflight && preflight.host_live_config_state !== 'observed-local') {
    blockers.push('尚未取得可信、非空的 Caddy 运行配置观测。')
  }
  const localDomain = observed && preflight?.host_local_tls_verified === true &&
    config?.desired_enabled === true
      ? safeLocalComparison(preflight.desired_domain_local_match) : 'unverified'
  const localLAN = observed && preflight?.host_lan_local_tls_verified === true &&
    typeof config?.desired_lan_enabled === 'boolean' &&
    typeof config?.desired_lan_ip === 'string'
      ? safeLocalComparison(preflight.desired_lan_local_match) : 'unverified'
  if (preflight && localDomain === 'unverified' && localLAN === 'unverified') {
    blockers.push('尚无可与已保存目标对照的可信本机 HTTPS 入口证据。')
  }
  if (preflight && preflight.apply_supported !== false) {
    blockers.push('预检响应不满足 Caddy 受限只读合同。')
  }

  // Even an entirely positive local read is insufficient for adopting a DB
  // baseline: no signed host identity, explicit administrator confirmation,
  // revision CAS plus audit, or immutable applied receipt is implemented here.
  blockers.push('采纳写入尚未开放：缺少独立可信授权、管理员确认、数据库 CAS 与事务审计。')
  return {
    readonly_mode: true,
    can_adopt: false,
    desired_revision: persisted ? config.revision : null,
    domain_comparison: localDomain,
    lan_comparison: localLAN,
    ingress_change_risk: observed && typeof preflight?.ingress_change_risk === 'string'
      ? preflight.ingress_change_risk : 'unverified',
    blockers,
  }
}
