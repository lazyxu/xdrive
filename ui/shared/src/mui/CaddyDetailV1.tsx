import { useEffect, useRef, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServiceDependency, XDriveCaddyHTTPSConfig, XDriveCaddyDeployState, XDriveCaddyDeployHistoryPage } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort, type XDriveCaddyHTTPSAtomicDraft } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort, type XDriveCaddyAliDNSAtomicDraft } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { caddyHostDeployFailureMessage } from './caddyHostDeployFailure'
import { xDriveReconcileCaddyDeployReceipt } from '../caddy-operation-recovery'

// Host .env is authoritative in v1; DB desired is legacy compatibility only.
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
  loadCaddyDeployHistory?: () => Promise<XDriveCaddyDeployHistoryPage>
  operationScope?: string // Stable authenticated Server/account boundary.
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

function caddyHistoryTime(item: XDriveCaddyDeployState): string {
  if (typeof item.recorded_at !== 'string') return '时间未记录'
  const ms = Date.parse(item.recorded_at)
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '时间未记录'
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
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [atomicError, setAtomicError] = useState('')
  const [atomicNotice, setAtomicNotice] = useState('')
  const [confirmDeploy, setConfirmDeploy] = useState(false)
  const [deployReceipt, setDeployReceipt] = useState<XDriveCaddyDeployState | null>(null)
  const [deployError, setDeployError] = useState('')
  const [historyItems, setHistoryItems] = useState<XDriveCaddyDeployState[]>([])
  const [historyState, setHistoryState] = useState<'idle' | 'ready' | 'unavailable'>('idle')
  const [historyRefreshID, setHistoryRefreshID] = useState(0)
  const [deployPollSeq, setDeployPollSeq] = useState(0)
  const [deployBusy, setDeployBusy] = useState(false)
  const deployEpoch = useRef(0)
  const deployPendingRef = useRef(false)
  const saveEpoch = useRef(0)
  const savePendingRef = useRef(false)
  const storageKey = source.operationScope ? `xdrive:caddy:deploy:${source.operationScope}` : ''
  useEffect(() => {
    savePendingRef.current = false
    ++saveEpoch.current // Invalidates response from previous Server/account.
    ++deployEpoch.current
    deployPendingRef.current = false
    setDeployBusy(false)
    setHTTPSDraft(null)
    setAliDraft(null)
    setSavingAtomic(false)
    setConfirmDiscard(false)
    setAtomicError('')
    setAtomicNotice('')
    setConfirmDeploy(false)
    setDeployReceipt(null)
    setDeployError('')
    setDeployPollSeq(0)
    let alive = true
    // Same-tab resume uses ONLY opaque Request ID + target SHA, never .env,
    // AliDNS secrets, certificates, or unsafe old results. Authenticated GET
    // still enforces the Server's administrator boundary.
    if (storageKey && source.getCaddyDeployStatus) {
      try {
        const raw = window.sessionStorage.getItem(storageKey)
        const saved = raw ? JSON.parse(raw) as { request_id?: unknown; sha256?: unknown; at?: unknown } : null
        if (saved && typeof saved.request_id === 'string' &&
            /^[0-9a-f]{24}$/.test(saved.request_id) &&
            typeof saved.sha256 === 'string' && /^[0-9a-f]{64}$/.test(saved.sha256) &&
            typeof saved.at === 'number' && Date.now() - saved.at < 7 * 24 * 3600 * 1000 &&
            saved.at <= Date.now()) {
          void source.getCaddyDeployStatus(saved.request_id).then((receipt) => {
            if (!alive || receipt?.request_id !== saved.request_id ||
                receipt.sha256 !== saved.sha256 ||
                (receipt.state !== 'deploying' && receipt.state !== 'deployed' &&
                  receipt.state !== 'failed')) return
            setDeployReceipt(receipt)
            if (receipt.state === 'failed') setDeployError(caddyHostDeployFailureMessage(receipt))
          }).catch(() => {
            // An unavailable Host status is unknown, not permission to replay.
          })
        }
      } catch {
        // No browser storage, malformed or stale data: retain neutral UI.
      }
    }
    return () => { alive = false }
  }, [source, storageKey])

  useEffect(() => {
    let alive = true
    setHistoryItems([])
    setHistoryState('idle')
    if (!source.loadCaddyDeployHistory) {
      setHistoryState('unavailable')
      return () => { alive = false }
    }
    void source.loadCaddyDeployHistory().then((page) => {
      if (!alive) return
      if (!page || page.scope !== 'host-terminal' || page.retention_days !== 7 ||
          !Array.isArray(page.items) || page.items.length > 20) {
        setHistoryState('unavailable')
        return
      }
      const clean = page.items.filter((item) =>
        item && /^[0-9a-f]{24}$/.test(item.request_id) &&
        /^[0-9a-f]{64}$/.test(item.sha256) &&
        (item.state === 'deployed' || item.state === 'failed'))
      if (clean.length !== page.items.length) {
        setHistoryState('unavailable')
        return
      }
      setHistoryItems(clean)
      // Reconcile only matching operation IDs, or a newer Host-active task.
      // An unrelated historical failure must not replace the visible task.
      setDeployReceipt((prior) =>
        xDriveReconcileCaddyDeployReceipt(prior, page.current, clean[0], Date.now()))
      setHistoryState('ready')
    }).catch(() => {
      if (alive) setHistoryState('unavailable')
    })
    return () => { alive = false }
  }, [source, deployReceipt?.request_id, deployReceipt?.state, historyRefreshID])

  // When a newer operation is recovered, clear transport errors from the
  // previous operation. Read failures during this operation remain visible.
  useEffect(() => {
    if (deployReceipt?.state === 'deploying' || deployReceipt?.state === 'deployed') {
      setDeployError('')
    }
  }, [deployReceipt?.request_id, deployReceipt?.state])

  // Never render the prior Server/account's sensitive Host/desired state.
  const readFailed = snapshot?.source === source && snapshot.failed

  useEffect(() => {
    const anchor = activeTab === 'verify' ? 'caddy-v1-evidence'
      : activeTab === 'history' ? 'caddy-v1-history'
      : activeTab === 'config' ? 'caddy-v1-config' : ''
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
  const inDeploy = deployReceipt?.state === 'deploying'
  // A Host operation freezes both editors, including credential reveal/clear.
  const editorsLocked = savingAtomic || deployBusy || inDeploy
  const safeRevision = (v: number) => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER
  const readyRevisions = !!https && !!ali && safeRevision(https.revision) && safeRevision(ali.revision) &&
    (!https.host_env_sha256 || (https.host_env_sha256 === ali.host_env_sha256 &&
      /^[a-f0-9]{64}$/.test(https.host_env_sha256)))
  const dirtyAtomic = !!https?.changed || (ali?.action !== undefined && ali.action !== 'keep')
  const readyAtomic = readyRevisions && !!https?.ready && !!ali?.ready &&
    !(https?.host_pending || ali?.host_pending) &&
    (!https?.changed || !!https.valid) &&
    (ali?.action === 'keep' || !!ali?.valid)
  const canSaveAtomic = !!source.saveCaddyConfiguration && readyAtomic && dirtyAtomic && !editorsLocked

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
      setAtomicNotice('配置已保存，等待应用到 Caddy。')
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
  const domainRequested = config?.desired_enabled === true
  const lanRequested = config?.desired_lan_enabled === true
  const domainTLSFailure = hostObserved &&
    (config?.host_tls_state === 'failed' || config?.host_tls_state === 'invalid-config')
  const lanTLSFailure = hostObserved &&
    (config?.host_lan_tls_state === 'failed' || config?.host_lan_tls_state === 'invalid-config')
  const lanVerified = hostObserved && config?.host_lan_configured === true &&
    config.host_lan_tls_state === 'verified'
  const healthy = service.installation_state === 'observed' &&
    service.health_state === 'ready' && service.local_tls_state === 'verified'
  const bad = service.health_state === 'failed'
  const primary = healthy ? '网关运行正常' : bad ? '网关检查异常' : '网关状态未确认'
  const displayedDeployError = deployReceipt?.state === 'failed'
    ? caddyHostDeployFailureMessage(deployReceipt) : deployError
  // A historical success blocks retries of THAT precise four-field target,
  // not a later, independently saved Host .env CAS fingerprint.
  const validPendingTarget = config?.source === 'host-env' &&
    config.host_env_pending_redeploy === true &&
    /^[0-9a-f]{64}$/.test(config.host_env_sha256 ?? '')
  const alreadyCompletedThisTarget = deployReceipt?.state === 'deployed' &&
    deployReceipt.sha256 === config?.host_env_sha256 &&
    config?.host_env_pending_redeploy !== true
  const canDeploy = !!source.startCaddyDeploy && !!source.getCaddyDeployStatus &&
    validPendingTarget && !alreadyCompletedThisTarget &&
    !savingAtomic && !dirtyAtomic && !hasUnsavedEdits && !inDeploy && !deployBusy
  // A maintenance restart uses the original Host CAS Save and Caddy-only Deploy.
  // No-op HTTPS Save retains AliDNS credentials and prepares a rollback journal.
  const canRestart = !!source.saveCaddyConfiguration && !!source.startCaddyDeploy &&
    !!source.getCaddyDeployStatus && config?.source === 'host-env' &&
    config.host_env_pending_redeploy === false &&
    /^[0-9a-f]{64}$/.test(config.host_env_sha256 ?? '') &&
    (config.desired_enabled || config.desired_lan_enabled === true) &&
    !savingAtomic && !dirtyAtomic && !hasUnsavedEdits && !inDeploy && !deployBusy

  const refreshAllCaddy = () => {
    // Refresh is read-only, but rereading editor models would discard drafts.
    if (refreshing || hasUnsavedEdits || dirtyAtomic || savingAtomic || deployBusy ||
        savePendingRef.current || deployPendingRef.current) return
    setConfigRevision((value) => value + 1)
    setAtomicRefreshID((value) => value + 1)
    setHistoryRefreshID((value) => value + 1)
    onRefreshStatus()
  }
  const startDeploy = async () => {
    if ((!canDeploy && !canRestart) || !source.startCaddyDeploy ||
        deployPendingRef.current) return
    const restarting = !canDeploy && canRestart
    deployPendingRef.current = true
    const epoch = ++deployEpoch.current
    setDeployBusy(true)
    setConfirmDeploy(false)
    setDeployError('')
    setDeployReceipt(null)
    try {
      if (restarting) {
        if (config?.source !== 'host-env' || !source.saveCaddyConfiguration) return
        const target = config.host_env_sha256
        // One unchanged, revision-fenced HTTPS Save creates the original
        // backup/rollback journal. Neither key is read or overwritten.
        // If its ACK is lost, do not deploy or blindly retry the Save.
        const saveResult = await source.saveCaddyConfiguration({
          host_env_sha256: target,
          https_revision: 0, alidns_revision: 0,
          https: {
            enabled: config.desired_enabled, domain: config.desired_domain,
            lan_enabled: config.desired_lan_enabled === true,
            lan_ip: config.desired_lan_ip ?? '',
          },
        })
        if (epoch !== deployEpoch.current) return
        if (!saveResult || saveResult.saved !== true ||
            saveResult.host_applied !== false || saveResult.apply_supported !== false ||
            saveResult.host_env_sha256 !== target ||
            saveResult.https_revision !== 0 || saveResult.alidns_revision !== 0) {
          throw new Error('maintenance restart Save unconfirmed')
        }
      }
      const status = await source.startCaddyDeploy()
      if (epoch !== deployEpoch.current) return
      if (!status || status.protocol !== 'xdrive.caddy.host-env.v1' ||
        !/^[0-9a-f]{24}$/.test(status.request_id) ||
        !/^[0-9a-f]{64}$/.test(status.sha256) ||
        (status.state !== 'deploying' && status.state !== 'deployed' && status.state !== 'failed')) {
        throw new Error('unverified deployment receipt')
      }
      setDeployReceipt(status)
      if (storageKey) {
        try {
          window.sessionStorage.setItem(storageKey, JSON.stringify({
            request_id: status.request_id, sha256: status.sha256, at: Date.now(),
          }))
        } catch {
          // Storage unavailable: the live Host operation is unaffected.
        }
      }
      if (status.state === 'deployed') {
        setAtomicNotice('Caddy 重新部署完成；本机入口验证已通过。')
        setAtomicRefreshID((value) => value + 1)
        changed()
      } else if (status.state === 'failed') {
        setDeployError(caddyHostDeployFailureMessage(status))
        setAtomicRefreshID((value) => value + 1)
        changed()
      }
    } catch {
      if (epoch === deployEpoch.current) {
        setDeployError('重新部署结果尚未确认；正在从宿主机记录恢复，勿重复操作。')
        setHistoryRefreshID((n) => n + 1)
        setAtomicRefreshID((value) => value + 1)
        changed()
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
            setDeployError('')
            setAtomicNotice('Caddy 重新部署完成；本机入口验证已通过。')
          } else {
            setDeployError(caddyHostDeployFailureMessage(next))
          }
          setAtomicRefreshID((value) => value + 1)
          changed()
        } else {
          setDeployPollSeq((n) => n + 1)
        }
      }).catch(() => {
        if (!active) return
        setDeployError('暂时无法读取部署状态；正在核对宿主机，勿重复提交。')
        // The Host may not yet have claimed a recovered queued request.
        // Retry reads only: NEVER issue another Save or Deploy.
        if (deployPollSeq < 120) setDeployPollSeq((n) => n + 1)
      })
    }, 1500)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [source, deployReceipt?.request_id, deployReceipt?.sha256, deployReceipt?.state, deployPollSeq])

  // A Start ACK says historical deployed, not current Applied. Always obtain
  // the newer readonly Host comparison for a terminal success when supported.
  useEffect(() => {
    if (deployReceipt?.state !== 'deployed' || !source.getCaddyDeployStatus ||
        deployReceipt.local_runtime_state) return
    let active = true
    void source.getCaddyDeployStatus(deployReceipt.request_id).then((next) => {
      if (!active || next?.request_id !== deployReceipt.request_id ||
          next.sha256 !== deployReceipt.sha256 || next.state !== 'deployed') return
      if (next.local_runtime_state === 'matching-local' ||
          next.local_runtime_state === 'changed-local' ||
          next.local_runtime_state === 'unverified') setDeployReceipt(next)
    }).catch(() => {
      // No trust upgrade from an unavailable read.
    })
    return () => { active = false }
  }, [source, deployReceipt?.request_id, deployReceipt?.sha256,
    deployReceipt?.state, deployReceipt?.local_runtime_state])

  return (
    <Box data-xdrive-caddy-v1-detail data-xdrive-caddy-single-page="true"
      sx={{ width: '100%', minWidth: 0 }}>
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
            <Button size="small" variant="outlined" onClick={refreshAllCaddy}
              disabled={refreshing || hasUnsavedEdits || dirtyAtomic || savingAtomic || deployBusy}
              aria-busy={refreshing || undefined}>
              重新检测
            </Button>
          </Stack>
          {(domainRequested || lanRequested || hostDomainVerified || independentDomainVerified || lanVerified) && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}
              data-xdrive-caddy-v1-reconciliation sx={{ mt: 1.5 }}>
              {(domainRequested || hostDomainVerified || independentDomainVerified) && (
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    域名 HTTPS{domainRequested && config?.desired_domain ? ' · ' + config.desired_domain : ''}
                  </Typography>
                  <Typography variant="body2" data-xdrive-caddy-v1-domain-evidence-source
                    color={domainTLSFailure ? 'error.main' : hostDomainVerified ? 'success.main' : 'text.secondary'}>
                    {hostDomainVerified ? '本机域名证书已验证'
                      : config?.host_tls_state === 'invalid-config' && hostObserved ? '本机 HTTPS 配置不合法'
                      : domainTLSFailure ? '本机域名 TLS 检查失败'
                      : independentDomainVerified ? '内部 HTTPS 已验证（已保存域名未确认）'
                      : config?.host_tls_state === 'disabled' ? '当前域名入口未启用'
                      : '本机域名 TLS 尚未确认'}
                  </Typography>
                </Box>
              )}
              {(lanRequested || lanVerified) && (
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    局域网 IP HTTPS{lanRequested && config?.desired_lan_ip ? ' · ' + config.desired_lan_ip : ''}
                  </Typography>
                  <Typography variant="body2" data-xdrive-caddy-v1-saved-lan-target
                    color={lanTLSFailure ? 'error.main' : lanVerified ? 'success.main' : 'text.secondary'}>
                    {lanVerified ? '本机 IP 证书已验证'
                      : config?.host_lan_tls_state === 'invalid-config' && hostObserved ? '本机 IP HTTPS 配置不合法'
                      : lanTLSFailure ? '本机 IP TLS 检查失败'
                      : config?.host_lan_tls_state === 'disabled' ? '当前局域网入口未启用'
                      : '本机 IP TLS 尚未确认'}
                  </Typography>
                </Box>
              )}
            </Stack>
          )}
        </Paper>
        {readFailed && (
          <Typography variant="caption" color="text.secondary"
            data-xdrive-caddy-v1-config-read-failed sx={{ mt: 1, display: 'block' }}>
            无法读取管理配置；请使用「重新检测」重试。
          </Typography>
        )}
      </Box>

      <Box id="caddy-v1-config" data-xdrive-caddy-v1-config sx={{ scrollMarginTop: 72 }}>
        <Stack spacing={1.5}>
          <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={atomicRefreshID}
            inlineEdit atomicMode atomicSaving={editorsLocked} onAtomicDraft={setHTTPSDraft}
            onDirtyChange={onHTTPSDirtyChange} onConfigurationChanged={changed} />
          <XDriveCaddyAliDNSPanel source={source} refreshID={atomicRefreshID}
            atomicMode atomicSaving={editorsLocked} onAtomicDraft={setAliDraft}
            onDirtyChange={onAliDNSDirtyChange} onConfigurationChanged={changed} />
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}
            data-xdrive-caddy-v11-atomic-save aria-busy={editorsLocked || undefined}>
            <Stack spacing={1}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
                alignItems={{ xs: 'stretch', sm: 'center' }} useFlexGap flexWrap="wrap">
                <Button variant="contained" size="small" disabled={!canSaveAtomic}
                  data-xdrive-caddy-v11-save-only onClick={() => { void saveAtomic() }}>
                  保存配置
                </Button>
              {config?.source === 'host-env' && (
                <Button size="small" variant="outlined" disabled={!canDeploy && !canRestart}
                  onClick={() => setConfirmDeploy(true)} data-xdrive-caddy-host-env-deploy
                  data-xdrive-caddy-maintenance-restart={canRestart || undefined}>
                  {inDeploy ? '正在应用 Caddy…' : canRestart ? '重启 Caddy' : '应用配置'}
                </Button>
              )}
              {dirtyAtomic && (
                <Button size="small" variant="text" disabled={editorsLocked}
                  onClick={() => setConfirmDiscard(true)}>放弃未保存的修改</Button>
              )}
              </Stack>
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
                {displayedDeployError && <XDriveStatusAlert tone="bad">{displayedDeployError}</XDriveStatusAlert>}
                {deployReceipt?.state === 'deployed' && (
                  <Typography variant="caption" color="text.secondary"
                    data-xdrive-caddy-local-runtime-state>
                    {deployReceipt.local_runtime_state === 'matching-local'
                      ? '最近部署与当前本机运行一致（未独立签名，不代表持续生效）。'
                      : deployReceipt.local_runtime_state === 'changed-local'
                        ? '本机配置已变化；不能视为此次部署仍然生效。'
                        : '最近部署完成；当前运行代际与应用生效状态未验证。'}
                  </Typography>
                )}
              </Box>
            </Stack>
          </Paper>
          <XDriveConfirmDialog open={confirmDeploy}
            title={canRestart ? '重启 Caddy' : '应用 Caddy 配置'}
            description={canRestart
              ? '只重建 Caddy，不改变地址或 AliDNS，也不会重启其他服务；失败时尝试回滚。'
              : '将已保存的配置应用到 Caddy；失败时尝试恢复上一份运行配置。'}
            confirmLabel={canRestart ? '确认重启' : '应用配置'}
            onCancel={() => setConfirmDeploy(false)}
            onConfirm={() => { void startDeploy() }} />
          <XDriveConfirmDialog open={confirmDiscard} loading={editorsLocked}
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
            {config?.source !== 'host-env'
              ? '保存只更新管理配置；当前模式需在宿主机另行应用。'
              : validPendingTarget
                ? '配置已保存，等待应用到 Caddy。'
                : '保存只更新配置；有变更时再点击「应用配置」。'}
          </Typography>
        </Stack>
      </Box>

      <Box id="caddy-v1-history" sx={{ scrollMarginTop: 72, mt: 1.5 }}>
        {config?.source === 'host-env' && (
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}
            data-xdrive-caddy-host-terminal-history>
            <Typography variant="subtitle2" fontWeight={600}>最近部署记录</Typography>
            <Typography variant="caption" color="text.secondary">
              最近 7 天的部署结果；历史成功不代表当前配置仍在运行。
            </Typography>
            {historyState === 'unavailable' && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                当前无法核实宿主机近期历史；不能推断没有执行过部署。
              </Typography>
            )}
            {historyState === 'ready' && historyItems.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                本次读取未发现保留期内的部署终态。
              </Typography>
            )}
            {historyState === 'ready' && historyItems.length > 0 && (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {historyItems.map((item) => (
                  <Box key={item.request_id} sx={{ minWidth: 0 }} title={item.request_id}
                    data-xdrive-caddy-host-terminal-row>
                    <Typography variant="body2">
                      {caddyHistoryTime(item)} · {item.state === 'deployed' ? '部署完成' : '部署失败'}
                    </Typography>
                    {item.state === 'failed' && (
                      <Typography variant="caption" color="text.secondary">
                        {caddyHostDeployFailureMessage(item)}
                      </Typography>
                    )}
                    {item.state === 'deployed' && (
                      <Typography variant="caption" color="text.secondary">
                        {item.local_runtime_state === 'matching-local'
                          ? '最近本机运行匹配（未独立签名）'
                          : item.local_runtime_state === 'changed-local'
                            ? '当前本机代际或配置已变化'
                            : '当前是否仍生效未验证'}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>
        )}
      </Box>

      <Box id="caddy-v1-evidence" sx={{ scrollMarginTop: 72 }}>
        {config?.source !== 'host-env' && <XDriveCaddyPreflightPanel source={source} refreshID={evidenceRevision} />}
      </Box>
    </Box>
  )
}
