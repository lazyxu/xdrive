import { useEffect, useRef, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import type { XDriveServiceDependency } from '../service-dependencies'
import type { XDriveSystemDependencyTab } from '../system-dependencies-navigation'
import { XDriveCaddyHTTPSDesiredPanel, type XDriveCaddyHTTPSPort, type XDriveCaddyHTTPSAtomicDraft } from './CaddyHTTPSDesiredPanel'
import { XDriveCaddyAliDNSPanel, type XDriveCaddyAliDNSPort, type XDriveCaddyAliDNSAtomicDraft } from './CaddyAliDNSPanel'
import { XDriveCaddyPreflightPanel, type XDriveCaddyPreflightPort } from './CaddyPreflightPanel'
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
  // One flat Caddy page. Legacy verify links scroll to the always-visible
  // read-only checks; legacy history links lead to the HTTPS editor.
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
  useEffect(() => {
    const anchor = activeTab === 'verify' ? 'caddy-v1-evidence'
      : activeTab === 'config' || activeTab === 'history' ? 'caddy-v1-config' : ''
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [activeTab])

  const changed = () => {
    onConfigurationChanged() // Invalidate read-only preflight results after a desired edit.
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

  const healthy = service.installation_state === 'observed' &&
    service.health_state === 'ready' && service.local_tls_state === 'verified'
  const failed = service.health_state === 'failed'
  const primary = healthy ? '网关运行正常' : failed ? '网关检查异常' : 'Caddy / HTTPS 网关'

  return (
    <Box data-xdrive-caddy-v1-detail data-xdrive-caddy-single-page="true"
      sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
      <Paper variant="outlined" id="caddy-v1-overview" sx={{
        p: { xs: 1.5, sm: 2 }, borderRadius: 2, scrollMarginTop: 72,
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between"
          gap={1} flexWrap="wrap">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700}
              data-xdrive-caddy-v1-primary-status>{primary}</Typography>
            {checkedAt && <Typography variant="caption" color="text.secondary">
              检查时间：{checkedAt}
            </Typography>}
          </Box>
          <Button size="small" variant="outlined"
            onClick={() => { if (!hasUnsavedEdits) onRefreshStatus() }}
            disabled={refreshing || hasUnsavedEdits} aria-busy={refreshing || undefined}>
            重新检测
          </Button>
        </Stack>
      </Paper>

      <Box id="caddy-v1-config" data-xdrive-caddy-v1-config sx={{ scrollMarginTop: 72 }}>
        <Stack spacing={1.5}>
          <XDriveCaddyHTTPSDesiredPanel source={source} refreshID={atomicRefreshID}
            inlineEdit atomicMode atomicSaving={savingAtomic} onAtomicDraft={setHTTPSDraft}
            onDirtyChange={onHTTPSDirtyChange} onConfigurationChanged={changed} />
          <XDriveCaddyAliDNSPanel source={source} refreshID={atomicRefreshID}
            atomicMode atomicSaving={savingAtomic} onAtomicDraft={setAliDraft}
            active={activeTab !== 'verify' && activeTab !== 'history'}
            onDirtyChange={onAliDNSDirtyChange} onConfigurationChanged={changed} />
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}
            data-xdrive-caddy-v11-atomic-save aria-busy={savingAtomic || undefined}>
            <Stack spacing={1} alignItems="flex-start">
              <Button variant="contained" size="small"
                disabled={!canSaveAtomic} data-xdrive-caddy-v11-save-only
                onClick={() => setConfirmAtomic(true)}>保存配置</Button>
              {dirtyAtomic && <Button size="small" variant="text"
                disabled={savingAtomic} onClick={() => setConfirmDiscard(true)}>
                放弃未保存的修改
              </Button>}
              {(!source.saveCaddyConfiguration || !readyRevisions ||
                https?.host_pending || ali?.host_pending) && (
                <Typography variant="body2" color="error.main" data-xdrive-caddy-v11-save-blocker>
                  {!source.saveCaddyConfiguration
                    ? '当前 Server/Agent 不支持联合保存配置。'
                    : !readyRevisions ? '无法读取 HTTPS 与 AliDNS 配置修订。'
                    : '存在待协调的 Host 操作，当前不能保存配置。'}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" data-xdrive-caddy-v1-deploy-gate>
                仅保存管理配置，不会重新部署 Caddy。
              </Typography>
              <Box sx={{ minHeight: 24, width: '100%' }} aria-live="polite">
                {atomicError && <XDriveStatusAlert tone="bad">{atomicError}</XDriveStatusAlert>}
                {atomicNotice && <XDriveStatusAlert tone="good">{atomicNotice}</XDriveStatusAlert>}
              </Box>
            </Stack>
          </Paper>
          <XDriveConfirmDialog open={confirmAtomic} loading={savingAtomic}
            title="保存 Caddy 配置"
            description="使用双修订 CAS 保存数据库目标并审计，不会部署 Caddy。"
            confirmLabel="保存配置" onCancel={() => setConfirmAtomic(false)}
            onConfirm={() => { void saveAtomic() }} />
          <XDriveConfirmDialog open={confirmDiscard} loading={savingAtomic}
            title="放弃未保存的 Caddy 草稿"
            description="重新读取已保存的 HTTPS 与 AliDNS 配置；未保存的修改将丢失。"
            confirmLabel="放弃草稿" onCancel={() => setConfirmDiscard(false)}
            onConfirm={() => {
              setConfirmDiscard(false)
              setHTTPSDraft(null)
              setAliDraft(null)
              setAtomicRefreshID((value) => value + 1)
            }} />
        </Stack>
      </Box>

      <Box id="caddy-v1-evidence" data-xdrive-caddy-v1-technical-evidence
        sx={{ scrollMarginTop: 72 }}>
        <XDriveCaddyPreflightPanel source={source} refreshID={evidenceRevision} />
      </Box>
    </Box>
  )
}
