import { useEffect, useState } from 'react'
import { Box, Button, Chip, Paper, Stack, Tab, Tabs, Typography } from '@mui/material'
import type { XDriveServiceDependency, XDriveCaddyHTTPSConfig } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'

// Only layout and verified read-only evidence; no Host/Docker/ACME/DNS Apply.
type CaddyPort = XDriveCaddyHTTPSPort & XDriveCaddyAliDNSPort & XDriveCaddyPreflightPort
type CaddyScreen = 'overview' | 'config' | 'history'
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
  // The legacy ?tab=verify deep link opens Overview with evidence exposed.
  const screen: CaddyScreen = activeTab === 'config' ? 'config'
    : activeTab === 'history' ? 'history' : 'overview'
  const [showEvidence, setShowEvidence] = useState(false)
  const evidenceOpen = showEvidence || activeTab === 'verify'
  const [visitedConfig, setVisitedConfig] = useState(screen === 'config')
  const [configRevision, setConfigRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  // Never render the prior Server/account's sensitive Host/desired state.
  const config = snapshot?.source === source ? snapshot.config : null
  const readFailed = snapshot?.source === source && snapshot.failed

  useEffect(() => {
    if (screen === 'config') setVisitedConfig(true)
  }, [screen])

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

  const hostObserved = config?.host_observed === true
  const domainVerified = (hostObserved && config.host_tls_state === 'verified') ||
    service.caddy_local_domain_https_state === 'verified'
  const lanVerified = hostObserved && config?.host_lan_configured === true &&
    config.host_lan_tls_state === 'verified'
  // Older Server/Agent DTOs may not report LAN desired fields at all.
  // Missing target evidence is UNKNOWN, not a confirmed runtime drift.
  const hasKnownLANTarget = typeof config?.desired_lan_enabled === 'boolean' &&
    typeof config?.desired_lan_ip === 'string'
  const lanMismatch = lanVerified && hasKnownLANTarget && Boolean(config?.host_lan_ip) && (
    config?.desired_lan_enabled === false || config?.desired_lan_ip !== config?.host_lan_ip
  )
  const healthy = service.installation_state === 'observed' &&
    service.health_state === 'ready' && service.local_tls_state === 'verified'
  // A legacy inventory "unavailable" may mean missing trusted Host evidence,
  // not an observed gateway failure. Only explicit health failure is negative.
  const bad = service.health_state === 'failed'
  const primary = healthy ? '网关运行正常' : bad ? '网关检查异常' : '网关状态尚未完整确认'
  const summary = domainVerified && lanVerified
    ? '本机公网域名及局域网 IP HTTPS 分别验证通过'
    : '运行状态与 HTTPS 证书验证需分别核对'

  return (
    <Box data-xdrive-caddy-v1-detail sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
      <Tabs value={screen} variant="fullWidth"
        aria-label="Caddy 管理页面" data-xdrive-caddy-v1-navigation
        onChange={(_event, next: CaddyScreen) => {
          onTabChange(next === 'overview' ? 'status' : next)
        }}
        sx={{ minHeight: 44, borderBottom: 1, borderColor: 'divider', mb: 2,
          '& .MuiTab-root': { minHeight: 44, px: 1 } }}>
        <Tab value="overview" label="概览" id="caddy-v1-tab-overview" aria-controls="caddy-v1-overview" />
        <Tab value="config" label="配置" id="caddy-v1-tab-config" aria-controls="caddy-v1-config" />
        <Tab value="history" label="历史" id="caddy-v1-tab-history" aria-controls="caddy-v1-history" />
      </Tabs>
      {hasUnsavedEdits && screen !== 'config' && (
        <Typography variant="caption" data-xdrive-caddy-v1-preserved-draft
          color="warning.main" sx={{ display: 'block', mb: 1 }}>
          配置页有未保存的草稿；切换本服务页面不会丢失，离开服务前会要求确认。
        </Typography>
      )}

      <Box id="caddy-v1-overview" role="tabpanel"
        aria-labelledby="caddy-v1-tab-overview"
        hidden={screen !== 'overview'} sx={{ display: screen === 'overview' ? 'block' : 'none' }}>
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
              <Button size="small" variant="outlined" onClick={onRefreshStatus}
                disabled={refreshing} aria-busy={refreshing || undefined}>
                重新检测
              </Button>
            </Stack>
          </Paper>

          <Box sx={{ display: 'grid', gridTemplateColumns: {
            xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))',
          }, gap: 1.5 }} data-xdrive-caddy-v1-ingresses>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700}>公网域名 HTTPS</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                {config?.desired_domain ? config.desired_domain : '未取得已保存目标域名'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                上述域名为数据库管理目标；实际容器配置和目标修订需独立核验
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }} color={domainVerified ? 'success.main' : 'text.secondary'}>
                {domainVerified ? 'Server 本机 TLS 验证通过' : '本机 TLS 尚无可靠成功证据'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                外网及内网实际连接分别验收；此处未证明公网可达
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700}>局域网 IP HTTPS</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                {config?.host_lan_configured && config.host_lan_ip
                  ? config.host_lan_ip : '未取得可信局域网部署身份'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                私网 IP 为备用入口；服务器本机验证不代表当前设备信任 Caddy Local CA
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }} color={lanVerified ? 'success.main' : 'text.secondary'}>
                {lanVerified ? '本机 Local CA 与 IP TLS 已验证' : '本机局域网 TLS 尚未验证'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                不能要求用户忽略证书警告输入管理密码
              </Typography>
            </Paper>
          </Box>

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

          <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
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
              </Stack>
            )}
          </Paper>
          {readFailed && (
            <Typography variant="caption" color="text.secondary" data-xdrive-caddy-v1-config-read-failed>
              本次未能读取管理目标；不代表原有 Caddy 已停止。
              <Button size="small" onClick={() => setConfigRevision((value) => value + 1)}>重试读取</Button>
            </Typography>
          )}
        </Stack>
      </Box>

      {/* Keep the editor mounted after first visit so normal in-service tab
          navigation and browser back/forward never discard an unsaved draft. */}
      {(visitedConfig || screen === 'config') && (
        <Box id="caddy-v1-config" role="tabpanel" aria-labelledby="caddy-v1-tab-config"
          hidden={screen !== 'config'} sx={{ display: screen === 'config' ? 'block' : 'none' }}>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              此页保存的是管理员目标配置，和运行中的 Caddy、证书及实际生效回执独立。
            </Typography>
            <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={0}
              onDirtyChange={onHTTPSDirtyChange} onConfigurationChanged={changed} />
            <XDriveCaddyAliDNSPanel source={source} refreshID={0}
              active={screen === 'config'}
              onDirtyChange={onAliDNSDirtyChange} onConfigurationChanged={changed} />
          </Stack>
        </Box>
      )}

      {screen === 'history' && (
        <Box id="caddy-v1-history" role="tabpanel" aria-labelledby="caddy-v1-tab-history">
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
