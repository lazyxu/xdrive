import { useEffect, useRef, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServiceDependency, XDriveCaddyHTTPSConfig } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { hasPersistedCaddyIntent, caddyLANLocalMatch } from '../caddy-reconciliation'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort, type XDriveCaddyHTTPSAtomicDraft } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort, type XDriveCaddyAliDNSAtomicDraft } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'
import { XDriveCaddyHostBaselinePreviewPanel } from './CaddyHostBaselinePreviewPanel'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'

// Only PostgreSQL desired state is saved. No Host/Docker/ACME/DNS Apply.
type AtomicDesiredSave = {
  https_revision: number
  alidns_revision: number
  https?: { enabled: boolean; domain: string; lan_enabled: boolean; lan_ip: string }
  alidns?: { action: 'replace' | 'clear'; access_key_id?: string; access_key_secret?: string }
}
type AtomicDesiredResult = {
  https_revision: number
  alidns_revision: number
  saved: boolean
  host_applied: boolean
  apply_supported: boolean
}
type CaddyPort = XDriveCaddyHTTPSPort & XDriveCaddyAliDNSPort & XDriveCaddyPreflightPort & {
  saveCaddyConfiguration?: (input: AtomicDesiredSave) => Promise<AtomicDesiredResult>
}
type ConfigSnapshot = { source: CaddyPort; config: XDriveCaddyHTTPSConfig | null; failed: boolean }

// Never surface raw Server, Agent, proxy or transport error text in the
// administrator UI: it may contain host paths, endpoints or credentials.
function safeCaddyAtomicSaveError(error: unknown): string {
  const detail = error != null && typeof error === 'object'
    ? error as { status?: unknown; message?: unknown } : null
  const message = typeof detail?.message === 'string' ? detail.message : ''
  if (message === '原子保存响应不能确认完整双修订；请重新读取目标，勿视为已应用。') {
    return message // Our own fixed, non-sensitive response-contract failure.
  }
  const direct = typeof detail?.status === 'number' && Number.isInteger(detail.status) &&
    detail.status >= 400 && detail.status <= 599 ? detail.status : null
  const found = /(?:^|\b)(?:HTTP(?:Error)?|status(?: code)?|response status)\s*[:=]?\s*(400|401|403|404|409|422|429|500|501|502|503|504)\b/i.exec(message)
  const status = direct ?? (found ? Number(found[1]) : null)
  switch (status) {
    case 400:
    case 422: return '配置校验未通过；请检查 HTTPS 域名、私网 IPv4 和 AliDNS 凭据格式。未执行网关部署。'
    case 401: return '登录会话失效；草稿仍在本页，请重新验证身份后核对保存结果。'
    case 403: return '当前账号无权保存管理员 Caddy 配置；草稿未自动提交。'
    case 404:
    case 501: return '当前 Server 或 Desktop Agent 不支持联合原子保存；请升级兼容版本，不能分两次保存。'
    case 409: return 'HTTPS 或 AliDNS 目标修订已变化，或 Host 有待处理申请。草稿已保留；请核对后再操作。'
    case 429: return '原子保存被限流；请稍后核对当前双修订再提交。'
    default: return '原子保存结果尚未得到可信确认，可能已提交。草稿已保留；请先核对当前双修订，勿盲目重试。'
  }
}

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
  const [httpsDraft, setHTTPSDraft] = useState<XDriveCaddyHTTPSAtomicDraft | null>(null)
  const [aliDraft, setAliDraft] = useState<XDriveCaddyAliDNSAtomicDraft | null>(null)
  const [atomicRefreshID, setAtomicRefreshID] = useState(0)
  const [savingAtomic, setSavingAtomic] = useState(false)
  const [confirmAtomic, setConfirmAtomic] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [atomicError, setAtomicError] = useState('')
  const [atomicNotice, setAtomicNotice] = useState('')
  const saveEpoch = useRef(0)
  const savePendingRef = useRef(false)
  useEffect(() => {
    savePendingRef.current = false
    ++saveEpoch.current // Invalidates response from previous Server/account.
    setHTTPSDraft(null)
    setAliDraft(null)
    setSavingAtomic(false)
    setConfirmAtomic(false)
    setConfirmDiscard(false)
    setAtomicError('')
    setAtomicNotice('')
  }, [source])
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

  // A single atomic transaction replaces the two older standalone Save paths.
  // The two independent GETs are revision-fenced by the Server; neither is
  // evidence that Caddy has actually applied a desired revision.
  const https = httpsDraft?.source === source ? httpsDraft : null
  const ali = aliDraft?.source === source ? aliDraft : null
  const safeRevision = (v: number) => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER
  const readyRevisions = !!https && !!ali && safeRevision(https.revision) && safeRevision(ali.revision)
  const dirtyAtomic = !!https?.changed || (ali?.action !== undefined && ali.action !== 'keep')
  const readyAtomic = readyRevisions && !!https?.ready && !!ali?.ready &&
    !(https?.host_pending || ali?.host_pending) &&
    (!https?.changed || !!https.valid) &&
    (ali?.action === 'keep' || !!ali?.valid)
  const canSaveAtomic = !!source.saveCaddyConfiguration && readyAtomic && dirtyAtomic && !savingAtomic

  const saveAtomic = async () => {
    if (!canSaveAtomic || !https || !ali || !source.saveCaddyConfiguration ||
        savePendingRef.current) return
    savePendingRef.current = true
    const input: AtomicDesiredSave = {
      https_revision: https.revision, alidns_revision: ali.revision,
      ...(https.changed ? { https: {
        enabled: https.enabled, domain: https.domain,
        lan_enabled: https.lan_enabled, lan_ip: https.lan_ip,
      } } : {}),
      ...(ali.action === 'keep' ? {} : { alidns: ali.action === 'clear'
        ? { action: 'clear' as const }
        : { action: 'replace' as const, access_key_id: ali.access_key_id,
            access_key_secret: ali.access_key_secret } }),
    }
    const epoch = ++saveEpoch.current
    setSavingAtomic(true)
    setConfirmAtomic(false)
    setAtomicError('')
    setAtomicNotice('')
    try {
      const result = await source.saveCaddyConfiguration(input)
      if (epoch !== saveEpoch.current) return
      if (!result || result.saved !== true || result.host_applied !== false ||
          result.apply_supported !== false ||
          !Number.isSafeInteger(result.https_revision) ||
          !Number.isSafeInteger(result.alidns_revision) ||
          result.https_revision !== input.https_revision + (input.https ? 1 : 0) ||
          result.alidns_revision !== input.alidns_revision + (input.alidns ? 1 : 0)) {
        throw new Error('原子保存响应不能确认完整双修订；请重新读取目标，勿视为已应用。')
      }
      setHTTPSDraft(null)
      setAliDraft(null)
      setAtomicRefreshID((value) => value + 1)
      changed()
      setAtomicNotice('两组管理目标已作为一笔事务保存并审计；尚未重新部署 Caddy。')
    } catch (err) {
      if (epoch === saveEpoch.current) {
        setAtomicError(safeCaddyAtomicSaveError(err))
      }
    } finally {
      if (epoch === saveEpoch.current) {
        savePendingRef.current = false
        setSavingAtomic(false)
      }
    }
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
            <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={atomicRefreshID}
              inlineEdit atomicMode atomicSaving={savingAtomic} onAtomicDraft={setHTTPSDraft}
              onDirtyChange={onHTTPSDirtyChange} onConfigurationChanged={changed} />
            <XDriveCaddyAliDNSPanel source={source} refreshID={atomicRefreshID}
              atomicMode atomicSaving={savingAtomic} onAtomicDraft={setAliDraft}
              active={!historyOpen && !evidenceOpen}
              onDirtyChange={onAliDNSDirtyChange} onConfigurationChanged={changed} />
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}
              data-xdrive-caddy-v11-atomic-save aria-busy={savingAtomic || undefined}>
              <Stack spacing={1} alignItems="flex-start">
                <Button variant="contained" size="small"
                  disabled={!canSaveAtomic}
                  data-xdrive-caddy-v11-save-only
                  onClick={() => setConfirmAtomic(true)}>保存配置</Button>
                {dirtyAtomic && <Button size="small" variant="text"
                  disabled={savingAtomic} onClick={() => setConfirmDiscard(true)}>
                  放弃未保存的修改
                </Button>}
                <Typography variant="caption" color="text.secondary">
                  {!source.saveCaddyConfiguration
                    ? '当前 Server/Agent 不支持联合原子保存；不会退回分两次保存。'
                    : !readyRevisions ? '必须先取得同一实例的 HTTPS 与 AliDNS 两个目标修订。'
                    : https?.host_pending || ali?.host_pending ? '存在未完成的 Host 申请，配置保存被锁定。'
                    : '仅保存数据库目标和审计；不修改证书、DNS、Caddy 或宿主机。'}
                </Typography>
                <Box sx={{ minHeight: 24, width: '100%' }} aria-live="polite">
                  {atomicError && <XDriveStatusAlert tone="bad">{atomicError}</XDriveStatusAlert>}
                  {atomicNotice && <XDriveStatusAlert tone="good">{atomicNotice}</XDriveStatusAlert>}
                </Box>
              </Stack>
            </Paper>
            <XDriveConfirmDialog open={confirmAtomic} loading={savingAtomic}
              title="原子保存 Caddy 管理目标"
              description="HTTPS 入口与 AliDNS 修改将使用双修订 CAS 在一次 PostgreSQL 事务中保存和审计。保存不会重新部署，不代表配置已经生效。"
              confirmLabel="仅保存配置" onCancel={() => setConfirmAtomic(false)}
              onConfirm={() => { void saveAtomic() }} />
            <XDriveConfirmDialog open={confirmDiscard} loading={savingAtomic}
              title="放弃未保存的 Caddy 草稿"
              description="重新读取 HTTPS 与 AliDNS 已保存目标；未保存的输入与待清除凭据操作将丢弃。"
              confirmLabel="放弃草稿" onCancel={() => setConfirmDiscard(false)}
              onConfirm={() => {
                setConfirmDiscard(false)
                setHTTPSDraft(null)
                setAliDraft(null)
                setAtomicRefreshID((value) => value + 1)
              }} />
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
