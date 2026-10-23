import { useEffect, useRef, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServiceDependency, XDriveCaddyHTTPSConfig, XDriveCaddyDeployState } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort, type XDriveCaddyHTTPSAtomicDraft } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort, type XDriveCaddyAliDNSAtomicDraft } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'

// Only PostgreSQL desired state is saved. No Host/Docker/ACME/DNS Apply.
type AtomicDesiredSave = {
  host_env_sha256?: string
  https_revision: number
  alidns_revision: number
  https?: { enabled: boolean; domain: string; lan_enabled: boolean; lan_ip: string }
  alidns?: { action: 'replace' | 'clear'; access_key_id?: string; access_key_secret?: string }
}
type AtomicDesiredResult = {
  host_env_sha256?: string
  https_revision: number
  alidns_revision: number
  saved: boolean
  host_applied: boolean
  apply_supported: boolean
}
type CaddyPort = XDriveCaddyHTTPSPort & XDriveCaddyAliDNSPort & XDriveCaddyPreflightPort & {
  saveCaddyConfiguration?: (input: AtomicDesiredSave) => Promise<AtomicDesiredResult>
  startCaddyDeploy?: () => Promise<XDriveCaddyDeployState>
  getCaddyDeployStatus?: (requestID: string) => Promise<XDriveCaddyDeployState>
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
  onRefreshStatus, onHTTPSDirtyChange, onAliDNSDirtyChange,
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
  // Caddy has no accordion or history UI; old deep links still land on the single page.
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
  const [confirmDeploy, setConfirmDeploy] = useState(false)
  const [deployReceipt, setDeployReceipt] = useState<XDriveCaddyDeployState | null>(null)
  const [deployError, setDeployError] = useState('')
  const [deployPollSeq, setDeployPollSeq] = useState(0)
  const [deployBusy, setDeployBusy] = useState(false)
  const deployEpoch = useRef(0)
  const deployPendingRef = useRef(false)
  const saveEpoch = useRef(0)
  const savePendingRef = useRef(false)
  useEffect(() => {
    savePendingRef.current = false
    ++saveEpoch.current // Invalidates response from previous Server/account.
    ++deployEpoch.current
    deployPendingRef.current = false
    setDeployBusy(false)
    setHTTPSDraft(null)
    setAliDraft(null)
    setSavingAtomic(false)
    setConfirmAtomic(false)
    setConfirmDiscard(false)
    setAtomicError('')
    setAtomicNotice('')
    setConfirmDeploy(false)
    setDeployReceipt(null)
    setDeployError('')
    setDeployPollSeq(0)
  }, [source])
  // Never render the prior Server/account's sensitive Host/desired state.
  const readFailed = snapshot?.source === source && snapshot.failed

  useEffect(() => {
    const anchor = activeTab === 'verify' ? 'caddy-v1-evidence'
      : activeTab === 'config' || activeTab === 'history' ? 'caddy-v1-config' : ''
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
  const readyRevisions = !!https && !!ali && safeRevision(https.revision) && safeRevision(ali.revision) &&
    (!https.host_env_sha256 || (https.host_env_sha256 === ali.host_env_sha256 &&
      /^[a-f0-9]{64}$/.test(https.host_env_sha256)))
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
      ...(https.host_env_sha256 ? { host_env_sha256: https.host_env_sha256 } : {}),
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
          (input.host_env_sha256
            ? (!/^[0-9a-f]{64}$/.test(result.host_env_sha256 || '') ||
              result.https_revision !== 0 || result.alidns_revision !== 0)
            : (result.https_revision !== input.https_revision + (input.https ? 1 : 0) ||
              result.alidns_revision !== input.alidns_revision + (input.alidns ? 1 : 0)))) {
        throw new Error('原子保存响应不能确认完整双修订；请重新读取目标，勿视为已应用。')
      }
      setHTTPSDraft(null)
      setAliDraft(null)
      setAtomicRefreshID((value) => value + 1)
      changed()
      setAtomicNotice(input.host_env_sha256
        ? '宿主机 .env 已保存；尚未重新部署 Caddy。'
        : '两组管理目标已作为一笔事务保存并审计；尚未重新部署 Caddy。')
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

  // Runtime and locally verified TLS are independent from saved Desired and
  // signed Applied. No trusted Applied Receipt exists in this UI contract yet;
  // do not render a fictional application state or WAN/client-CA claim.
  const config = snapshot?.source === source ? snapshot.config : null
  const hostObserved = config?.host_observed === true
  const hostDomainVerified = hostObserved && config?.host_https_configured === true &&
    config.host_tls_state === 'verified'
  const independentDomainVerified = service.caddy_local_domain_https_state === 'verified'
  const lanVerified = hostObserved && config?.host_lan_configured === true &&
    config.host_lan_tls_state === 'verified'
  const healthy = service.installation_state === 'observed' &&
    service.health_state === 'ready' && service.local_tls_state === 'verified'
  const bad = service.health_state === 'failed'
  const primary = healthy ? '网关运行正常' : bad ? '网关检查异常' : '网关状态未确认'
  const inDeploy = deployReceipt?.state === 'deploying'
  const canDeploy = !!source.startCaddyDeploy && !!source.getCaddyDeployStatus &&
    config?.source === 'host-env' && config.host_env_pending_redeploy === true &&
    !savingAtomic && !dirtyAtomic && !hasUnsavedEdits && !inDeploy && !deployBusy &&
    deployReceipt?.state !== 'deployed'
  const startDeploy = async () => {
    if (!canDeploy || !source.startCaddyDeploy || deployPendingRef.current) return
    deployPendingRef.current = true
    const epoch = ++deployEpoch.current
    setDeployBusy(true)
    setConfirmDeploy(false)
    setDeployError('')
    try {
      const status = await source.startCaddyDeploy()
      if (epoch !== deployEpoch.current) return
      if (!status || status.protocol !== 'xdrive.caddy.host-env.v1' ||
        !/^[0-9a-f]{24}$/.test(status.request_id) ||
        !/^[0-9a-f]{64}$/.test(status.sha256) ||
        (status.state !== 'deploying' && status.state !== 'deployed' && status.state !== 'failed')) {
        throw new Error('unverified deployment receipt')
      }
      setDeployReceipt(status)
      if (status.state === 'deployed') {
        setAtomicNotice('Caddy 重新部署完成；本机入口验证已通过。')
        changed()
      } else if (status.state === 'failed') {
        setDeployError('重新部署失败；请先核对宿主机恢复结果，再决定是否重试。')
        changed()
      }
    } catch {
      if (epoch === deployEpoch.current) {
        setDeployError('重新部署结果尚未确认；请刷新宿主机状态，避免重复操作。')
      }
    } finally {
      if (epoch === deployEpoch.current) {
        deployPendingRef.current = false
        setDeployBusy(false)
      }
    }
  }
  useEffect(() => {
    if (!deployReceipt || deployReceipt.state !== 'deploying' || !source.getCaddyDeployStatus) return
    let active = true
    const timeout = window.setTimeout(() => {
      void source.getCaddyDeployStatus!(deployReceipt.request_id).then((next) => {
        if (!active) return
        if (!next || next.protocol !== 'xdrive.caddy.host-env.v1' ||
          next.request_id !== deployReceipt.request_id ||
          next.sha256 !== deployReceipt.sha256 ||
          (next.state !== 'deploying' && next.state !== 'deployed' && next.state !== 'failed')) {
          setDeployError('部署状态校验失败。请检查宿主机，勿重复提交。')
          return
        }
        setDeployReceipt(next)
        if (next.state === 'deployed' || next.state === 'failed') {
          if (next.state === 'deployed') {
            setAtomicNotice('Caddy 重新部署完成；本机入口验证已通过。')
          } else {
            setDeployError(next.rolled_back
              ? '重新部署失败，已尝试恢复旧 Caddy；请重新检测。'
              : '重新部署失败，原网关恢复未确认；请从宿主机检查。')
          }
          changed()
        } else {
          setDeployPollSeq((n) => n + 1)
        }
      }).catch(() => {
        if (active) setDeployError('暂时无法读取部署状态；请检查宿主机，不要重复提交。')
      })
    }, 1500)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [source, deployReceipt?.request_id, deployReceipt?.sha256, deployReceipt?.state, deployPollSeq])

  return (
    <Box data-xdrive-caddy-v1-detail data-xdrive-caddy-single-page="true"
      sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
      <Box id="caddy-v1-overview" sx={{ scrollMarginTop: 72 }}>
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between"
            gap={1} flexWrap="wrap">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700}
                data-xdrive-caddy-v1-primary-status data-xdrive-caddy-v1-runtime-axis>
                {primary}
              </Typography>
              {checkedAt && (
                <Typography variant="caption" color="text.secondary">
                  检查时间：{checkedAt}
                </Typography>
              )}
            </Box>
            <Button size="small" variant="outlined" onClick={() => {
              if (hasUnsavedEdits) return
              setConfigRevision((value) => value + 1)
              onRefreshStatus()
            }} disabled={refreshing || hasUnsavedEdits} aria-busy={refreshing || undefined}>
              重新检测
            </Button>
          </Stack>
          {(hostDomainVerified || independentDomainVerified || lanVerified) && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}
              data-xdrive-caddy-v1-reconciliation sx={{ mt: 1.5 }}>
              {(hostDomainVerified || independentDomainVerified) && (
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">域名 HTTPS</Typography>
                  <Typography variant="body2" data-xdrive-caddy-v1-domain-evidence-source>
                    {hostDomainVerified ? '本机域名 TLS 已验证' : '内部域名 TLS 已验证'}
                  </Typography>
                </Box>
              )}
              {lanVerified && (
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">局域网 IP HTTPS</Typography>
                  <Typography variant="body2" data-xdrive-caddy-v1-saved-lan-target>
                    本机 IP SAN / Local CA 已验证
                  </Typography>
                </Box>
              )}
            </Stack>
          )}
        </Paper>
        {readFailed && (
          <Stack direction="row" alignItems="center" spacing={1}
            data-xdrive-caddy-v1-config-read-failed sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">无法读取管理配置。</Typography>
            <Button size="small" onClick={() => setConfigRevision((v) => v + 1)}>重试</Button>
          </Stack>
        )}
      </Box>

      <Box id="caddy-v1-config" data-xdrive-caddy-v1-config sx={{ scrollMarginTop: 72 }}>
        <Stack spacing={1.5}>
          <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={atomicRefreshID}
            inlineEdit atomicMode atomicSaving={savingAtomic} onAtomicDraft={setHTTPSDraft}
            onDirtyChange={onHTTPSDirtyChange} onConfigurationChanged={changed} />
          <XDriveCaddyAliDNSPanel source={source} refreshID={atomicRefreshID}
            atomicMode atomicSaving={savingAtomic} onAtomicDraft={setAliDraft}
            onDirtyChange={onAliDNSDirtyChange} onConfigurationChanged={changed} />
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}
            data-xdrive-caddy-v11-atomic-save aria-busy={savingAtomic || undefined}>
            <Stack spacing={1} alignItems="flex-start">
              <Button variant="contained" size="small" disabled={!canSaveAtomic}
                data-xdrive-caddy-v11-save-only onClick={() => setConfirmAtomic(true)}>
                保存配置
              </Button>
              {config?.source === 'host-env' && (
                <Button size="small" variant="outlined" disabled={!canDeploy}
                  onClick={() => setConfirmDeploy(true)} data-xdrive-caddy-host-env-deploy>
                  {inDeploy ? '正在重新部署…' : '重新部署 Caddy'}
                </Button>
              )}
              {dirtyAtomic && (
                <Button size="small" variant="text" disabled={savingAtomic}
                  onClick={() => setConfirmDiscard(true)}>放弃未保存的修改</Button>
              )}
              {(!source.saveCaddyConfiguration || !readyRevisions ||
                https?.host_pending || ali?.host_pending) && (
                <Typography variant="caption" color="text.secondary">
                  {!source.saveCaddyConfiguration
                    ? '需要兼容联合保存的 Server/Agent。'
                    : !readyRevisions ? '等待 HTTPS 与 AliDNS 管理配置加载。'
                    : 'Host 申请处理中，当前不可保存。'}
                </Typography>
              )}
              <Box sx={{ minHeight: 24, width: '100%' }} aria-live="polite">
                {atomicError && <XDriveStatusAlert tone="bad">{atomicError}</XDriveStatusAlert>}
                {atomicNotice && <XDriveStatusAlert tone="good">{atomicNotice}</XDriveStatusAlert>}
                {deployError && <XDriveStatusAlert tone="bad">{deployError}</XDriveStatusAlert>}
              </Box>
            </Stack>
          </Paper>
          <XDriveConfirmDialog open={confirmAtomic} loading={savingAtomic}
            title="保存 Caddy 管理配置"
            description="Host 模式保存至宿主机 .env；不会立即重新部署 Caddy。"
            confirmLabel="仅保存配置" onCancel={() => setConfirmAtomic(false)}
            onConfirm={() => { void saveAtomic() }} />
          <XDriveConfirmDialog open={confirmDeploy} title="重新部署 Caddy"
            description="将已保存的宿主机 .env 应用到 Caddy。此操作只重新创建 Caddy；失败时尝试恢复上一份运行配置。"
            confirmLabel="重新部署" onCancel={() => setConfirmDeploy(false)}
            onConfirm={() => { void startDeploy() }} />
          <XDriveConfirmDialog open={confirmDiscard} loading={savingAtomic}
            title="放弃未保存的 Caddy 草稿"
            description="重新读取已保存的配置；未保存的输入和凭据操作将被清除。"
            confirmLabel="放弃草稿" onCancel={() => setConfirmDiscard(false)}
            onConfirm={() => {
              setConfirmDiscard(false)
              setHTTPSDraft(null)
              setAliDraft(null)
              setAtomicRefreshID((value) => value + 1)
            }} />
          <Typography variant="caption" color="text.secondary"
            data-xdrive-caddy-v1-deploy-gate>
            保存更新宿主机 .env；生效需另行重新部署 Caddy。
          </Typography>
        </Stack>
      </Box>

      <Box id="caddy-v1-evidence" sx={{ scrollMarginTop: 72 }}>
        {config?.source !== 'host-env' && <XDriveCaddyPreflightPanel source={source} refreshID={evidenceRevision} />}
      </Box>
    </Box>
  )
}
