import { useEffect, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServiceDependency, XDriveCaddyHTTPSConfig } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { hasPersistedCaddyIntent, caddyLANLocalMatch } from '../caddy-reconciliation'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'
import { XDriveCaddyHostBaselinePreviewPanel } from './CaddyHostBaselinePreviewPanel'

// Only layout and verified read-only evidence; no Host/Docker/ACME/DNS Apply.
type CaddyPort = XDriveCaddyHTTPSPort & XDriveCaddyAliDNSPort & XDriveCaddyPreflightPort
type ConfigSnapshot = { source: CaddyPort; config: XDriveCaddyHTTPSConfig | null; failed: boolean }

export function XDriveCaddyDetailV1({
  source, service, checkedAt, activeTab, refreshing, hasUnsavedEdits,
  onTabChange, onRefreshStatus, onHTTPSDirtyChange, onAliDNSDirtyChange,
  onConfigurationChanged, evidenceRevision,
}: {
  source: CaddyPort
  service: XDriveServiceDependency
  checkedAt: string
  activeTab: XDriveSystemDependencyTab
  refreshing: boolean
  hasUnsavedEdits: boolean
  onTabChange: (tab: 'status' | 'config' | 'history') => void
  onRefreshStatus: () => void
  onHTTPSDirtyChange: (changed: boolean) => void
  onAliDNSDirtyChange: (changed: boolean) => void
  onConfigurationChanged: () => void
  evidenceRevision: number
}) {
  // Existing deep links map to anchors/disclosures on one continuously mounted page.
  const [showEvidence, setShowEvidence] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const evidenceOpen = showEvidence || activeTab === 'verify'
  const historyOpen = showHistory || activeTab === 'history'
  const [configRevision, setConfigRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  // Never render the prior Server/account's sensitive Host/desired state.
  const config = snapshot?.source === source ? snapshot.config : null
  const readFailed = snapshot?.source === source && snapshot.failed

  useEffect(() => {
    const anchor = activeTab === 'verify' ? 'caddy-v1-evidence'
      : activeTab === 'config' ? 'caddy-v1-config'
      : activeTab === 'history' ? 'caddy-v1-history' : ''
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [activeTab])

  useEffect(() => {
    let alive = true
    if (!source.loadCaddyHTTPSConfig) return
    void source.loadCaddyHTTPSConfig().then((value) => {
      if (alive) setSnapshot({ source, config: value, failed: false })
    }).catch(() => {
      if (alive) setSnapshot({ source, config: null, failed: true })
    })
    return () => { alive = false }
  }, [source, configRevision])

  const changed = () => {
    setConfigRevision((value) => value + 1)
    onConfigurationChanged() // Invalidate previously read HTTPS preflight evidence.
  }

  // A revision #0 GET contains unsaved deployment hints. Only a persisted
  // positive revision can be compared with independently verified Host TLS.
  const hasSavedDesired = hasPersistedCaddyIntent(config)
  const hostObserved = config?.host_observed === true
  const hostDomainVerified = hostObserved && config?.host_https_configured === true &&
    config.host_tls_state === 'verified'
  const independentDomainVerified = service.caddy_local_domain_https_state === 'verified'
  const domainVerified = hostDomainVerified || independentDomainVerified
  const lanVerified = hostObserved && config?.host_lan_configured === true &&
    config.host_lan_tls_state === 'verified'
  const lanMatch = caddyLANLocalMatch(config)
  const lanMismatch = lanMatch === 'mismatch-local'
  const healthy = service.installation_state === 'observed' &&
    service.health_state === 'ready' && service.local_tls_state === 'verified'
  // A legacy inventory "unavailable" may mean missing trusted Host evidence,
  // not an observed gateway failure. Only explicit health failure is negative.
  const bad = service.health_state === 'failed'
  const primary = healthy ? '网关运行正常' : bad ? '网关检查异常' : '网关状态尚未完整确认'
  const summary = hostDomainVerified && lanVerified
    ? '可信 Host 已分别验证域名与局域网 IP 的本机 TLS'
    : independentDomainVerified
      ? '内部域名 HTTPS 已验证，不代表宿主健康或公网可达'
      : '运行状态与 HTTPS 证书验证需分别核对'

  return (
    <Box data-xdrive-caddy-v1-detail data-xdrive-caddy-single-page="true" sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
      <Box id="caddy-v1-overview" sx={{ scrollMarginTop: 72 }}>
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
            <Stack direction="row" justifyContent="space-between"
              alignItems="flex-start" gap={1} flexWrap="wrap">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" fontWeight={700}
                  data-xdrive-caddy-v1-primary-status>{primary}</Typography>
                <Typography variant="body2" color="text.secondary">{summary}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {checkedAt ? '服务状态检查：' + checkedAt : '服务状态尚未采样'}
                </Typography>
              </Box>
              <Button size="small" variant="outlined"
                onClick={() => {
                  if (hasUnsavedEdits) return
                  setConfigRevision((value) => value + 1)
                  onRefreshStatus()
                }}
                disabled={refreshing || hasUnsavedEdits} aria-busy={refreshing || undefined}>
                重新检测
              </Button>
            </Stack>
            <Box data-xdrive-caddy-v1-ingresses data-xdrive-caddy-v1-reconciliation sx={{
              display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' },
              gap: 1.5, mt: 1.5, minWidth: 0,
            }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">网关运行</Typography>
                <Typography variant="body2" data-xdrive-caddy-v1-runtime-axis>
                  {healthy ? '可信 Host 运行和本机 TLS 已验证' : bad ? 'Host 检查明确失败' : '宿主运行未确认'}
                </Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">配置生效</Typography>
                <Typography variant="body2" data-xdrive-caddy-v1-applied-axis>
                  尚无绑定管理双修订的可信 Applied Receipt · 生效未确认
                </Typography>
                <Typography variant="caption" color="text.secondary" data-xdrive-caddy-v1-desired-axis>
                  {hasSavedDesired ? '管理目标已保存，运行另验' : '数据库目标未确认'}
                </Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">公网域名 HTTPS</Typography>
                <Typography variant="body2" data-xdrive-caddy-v1-domain-evidence-source
                  color={domainVerified ? 'success.main' : 'text.secondary'}>
                  {hostDomainVerified ? '可信 Host 本机域名 TLS 已验证'
                    : independentDomainVerified ? '仅内部 caddy:443 域名 TLS 已验证' : '本机域名 TLS 未确认'}
                </Typography>
                <Typography variant="caption" color="text.secondary">公网实际可达：未验证</Typography>
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">局域网 IP HTTPS</Typography>
                <Typography variant="body2" data-xdrive-caddy-v1-saved-lan-target
                  color={lanVerified ? 'success.main' : 'text.secondary'}>
                  {lanVerified ? '本机 IP SAN / Local CA TLS 已验证' : '本机 IP TLS 未确认'}
                </Typography>
                <Typography variant="caption" color="text.secondary">当前设备信任 Caddy Local CA：未验证</Typography>
              </Box>
            </Box>
          </Paper>

          {lanMismatch && (
            <Paper variant="outlined" data-xdrive-caddy-v1-runtime-desired-drift
              role="status" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography variant="subtitle2" fontWeight={700}>运行与目标配置存在差异</Typography>
              <Typography variant="body2" color="text.secondary">
                可信宿主已验证局域网 IP HTTPS，但数据库保存的目标关闭或 IP 不一致。
                请在配置页核对修订来源；此提示不会自动启用开关或应用 Caddy。
              </Typography>
            </Paper>
          )}

          {readFailed && (
            <Typography variant="caption" color="text.secondary" data-xdrive-caddy-v1-config-read-failed>
              本次未能读取管理目标；不代表原有 Caddy 已停止。
              <Button size="small" onClick={() => setConfigRevision((value) => value + 1)}>重试读取</Button>
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Direct edit always stays mounted across evidence/history changes and browser navigation. */}
      <Box id="caddy-v1-config" data-xdrive-caddy-v1-config sx={{ scrollMarginTop: 72 }}>
          <Stack spacing={1.5}>
            <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={0} inlineEdit
              onDirtyChange={onHTTPSDirtyChange} onConfigurationChanged={changed} />
            <XDriveCaddyAliDNSPanel source={source} refreshID={0}
              active={!historyOpen && !evidenceOpen}
              onDirtyChange={onAliDNSDirtyChange} onConfigurationChanged={changed} />
            <Typography variant="caption" color="text.secondary" data-xdrive-caddy-v1-deploy-gate>
              保存配置仅创建管理目标，实际部署需要另行确认。目前独立 Rescue、签名 Host Manager、
              进程外 watchdog、可信应用回执尚未齐备，所以不开放重新部署。
            </Typography>
          </Stack>
        </Box>

          <Paper variant="outlined" id="caddy-v1-evidence"
            sx={{ p: { xs: 1.5, sm: 2 }, mt: 1.5, borderRadius: 2, scrollMarginTop: 72 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700}>检测详情与安全检查</Typography>
                <Typography variant="caption" color="text.secondary">
                  仅核对独立证据；实际配置应用及公网登录需要单独验收
                </Typography>
              </Box>
              <Button size="small" aria-expanded={evidenceOpen}
                data-xdrive-caddy-v1-evidence-toggle
                onClick={() => {
                  // A legacy ?tab=verify deep link forces evidence open. Closing
                  // it must also leave that link state, not toggle an inert flag.
                  if (activeTab === 'verify') {
                    setShowEvidence(false)
                    onTabChange('status')
                  } else {
                    setShowEvidence((show) => !show)
                  }
                }}>
                {evidenceOpen ? '收起' : '查看'}
              </Button>
            </Stack>
            {evidenceOpen && (
              <Stack spacing={1.5} sx={{ mt: 1.5 }} data-xdrive-caddy-v1-technical-evidence>
                <Typography variant="body2">
                  宿主观测：{service.installation_state === 'observed' ? '已观测' : '未确认'}
                  {' · '}健康：{service.health_state === 'ready' ? '正常'
                    : service.health_state === 'failed' ? '异常' : '未确认'}
                </Typography>
                <Typography variant="body2">
                  内部 HTTP：{service.caddy_internal_http_state === 'reachable' ? '有有效 Ready 响应'
                    : '未取得成功证据'}
                  {' · '}独立内部域名 HTTPS：{service.caddy_local_domain_https_state === 'verified'
                    ? '证书与 Ready 校验成功' : '未验证'}
                </Typography>
                {service.caddy_host_witness_reason && (
                  <Typography variant="caption" color="text.secondary"
                    data-xdrive-caddy-v1-host-blocker>
                    Host Control 观测受阻：{service.caddy_host_witness_reason}；可在可信宿主运行 xdrive-server doctor。
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  HTTPS 默认宿主端口为 8443，Caddy 容器内部使用 443；运行实例以真实部署为准。
                  以上均不证明 WAN 可达、全部终端 CA 信任或管理目标已应用。
                </Typography>
                <XDriveCaddyPreflightPanel source={source} refreshID={evidenceRevision} />
                <XDriveCaddyHostBaselinePreviewPanel source={source} config={config}
                  active={true} evidenceRevision={evidenceRevision}
                  hasUnsavedEdits={hasUnsavedEdits} />
              </Stack>
            )}
          </Paper>

      <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5, borderRadius: 2 }}
        data-xdrive-caddy-v1-history-toggle-owner>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Typography variant="subtitle2" fontWeight={700}>配置历史</Typography>
          <Button size="small" aria-expanded={historyOpen}
            data-xdrive-caddy-v1-history-toggle
            onClick={() => {
              if (activeTab === 'history') {
                setShowHistory(false)
                onTabChange('status')
              } else setShowHistory((old) => !old)
            }}>{historyOpen ? '收起' : '查看'}</Button>
        </Stack>
      </Paper>
      {historyOpen && (
        <Box id="caddy-v1-history" sx={{ scrollMarginTop: 72 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            历史只按需读取；恢复仅创建新的审计目标修订，不重启或应用当前网关。
          </Typography>
          {hasUnsavedEdits && (
            <Typography variant="body2" color="warning.main"
              data-xdrive-caddy-v1-history-draft-fence sx={{ mb: 1 }}>
              当前配置有未保存的草稿。请先保存或放弃编辑，再恢复历史目标修订。
            </Typography>
          )}
          <Box component="fieldset" disabled={hasUnsavedEdits}
            sx={{ p: 0, m: 0, border: 0, minWidth: 0, width: '100%' }}>
            <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={0}
              section="history" onConfigurationChanged={changed} />
          </Box>
        </Box>
      )}
    </Box>
  )
}
