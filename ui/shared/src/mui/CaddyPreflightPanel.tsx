import { useEffect, useRef, useState } from 'react'
import { Button, Paper, Stack, Typography } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import { verifyCaddyPreflightContract, verifyCaddyAliDNSReadContract } from './CaddyPreflightValidation'
import type {
  XDriveCaddyHTTPSPreflight, XDriveCaddyPreflightCheck, XDriveCaddyHTTPSHostPlan,
  XDriveCaddyAliDNSReadVerify, XDriveCaddyAliDNSReadVerifyInput,
} from '../service-dependencies'

export type XDriveCaddyPreflightPort = {
  loadCaddyHTTPSPreflight?: () => Promise<XDriveCaddyHTTPSPreflight>
  loadCaddyHTTPSHostPlan?: () => Promise<XDriveCaddyHTTPSHostPlan>
  verifyCaddyAliDNSRead?: (input: XDriveCaddyAliDNSReadVerifyInput) => Promise<XDriveCaddyAliDNSReadVerify>
}

const titles: Record<XDriveCaddyPreflightCheck['id'], string> = {
  desired: '管理员期望状态',
  domain: 'HTTPS 期望域名',
  alidns: 'AliDNS 加密凭据',
  'host-manager': 'Host Manager 心跳',
  ingress: '现有网关内部 HTTP',
  'restricted-apply': '受限安全应用协议',
  'public-https': '公网 HTTPS 实际可达',
}

export function XDriveCaddyPreflightPanel({ source, refreshID }: {
  source: XDriveCaddyPreflightPort
  refreshID: number
}) {
  const epochRef = useRef(0)
  const probeEpochRef = useRef(0)
  const [result, setResult] = useState<XDriveCaddyHTTPSPreflight | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [probeResult, setProbeResult] = useState<XDriveCaddyAliDNSReadVerify | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeError, setProbeError] = useState('')

  useEffect(() => {
    ++epochRef.current
    ++probeEpochRef.current
    setProbeResult(null)
    setProbeBusy(false)
    setProbeError('')
    setResult(null)
    setLoading(false)
    setError('')
    return () => { ++epochRef.current; ++probeEpochRef.current }
  }, [source, refreshID])

  const check = async () => {
    if (!source.loadCaddyHTTPSPreflight || loading) return
    const epoch = ++epochRef.current
    setLoading(true)
    setResult(null)
    ++probeEpochRef.current
    setProbeResult(null)
    setProbeError('')
    setError('')
    try {
      const next = await source.loadCaddyHTTPSPreflight()
      if (epoch !== epochRef.current) return
      setResult(verifyCaddyPreflightContract(next))
    } catch (err) {
      if (epoch === epochRef.current) {
        setError(err instanceof Error ? err.message : 'HTTPS 预检失败。')
      }
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  const verifyAliDNSRead = async () => {
    if (!result || result.action !== 'enable' || !result.configuration_complete ||
        !source.verifyCaddyAliDNSRead || probeBusy || loading) return
    const epoch = ++probeEpochRef.current
    setProbeResult(null)
    setProbeError('')
    setProbeBusy(true)
    try {
      const next = await source.verifyCaddyAliDNSRead({
        desired_revision: result.desired_revision,
        credential_revision: result.credential_revision,
      })
      if (epoch !== probeEpochRef.current) return
      setProbeResult(verifyCaddyAliDNSReadContract(next, {
        desired_revision: result.desired_revision,
        credential_revision: result.credential_revision,
      }))
    } catch (err) {
      if (epoch === probeEpochRef.current) {
        setProbeError(err instanceof Error ? err.message : 'AliDNS 只读验证失败。')
      }
    } finally {
      if (epoch === probeEpochRef.current) setProbeBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-preflight>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between"
          gap={1} flexWrap="wrap">
          <Typography variant="subtitle2" fontWeight={700}>安全预检</Typography>
          <Button size="small" variant="outlined" disabled={loading || !source.loadCaddyHTTPSPreflight}
            onClick={() => { void check() }}>
            {loading ? '正在检查…' : '执行预检'}
          </Button>
        </Stack>
        {result && (
          <Stack spacing={1} data-xdrive-caddy-preflight-results>
            <Typography variant="caption" color="text.secondary">
              最近检查：{new Date(result.checked_at).toLocaleString()}
            </Typography>
            {result.checks.filter((item) => item.state === 'missing' &&
              item.id !== 'public-https' && item.id !== 'restricted-apply').map((item) => (
              <Typography key={item.id} variant="body2" color="text.secondary">
                {titles[item.id] ?? item.id}：配置不完整
              </Typography>
            ))}
            {result.desired_domain_local_match === 'mismatch-local' && (
              <Typography variant="body2" data-xdrive-caddy-desired-domain-local-match>
                本机域名 TLS 与已保存域名不同。
              </Typography>
            )}
            {result.desired_lan_local_match === 'mismatch-local' && (
              <Typography variant="body2" data-xdrive-caddy-desired-lan-local-match>
                本机 IP HTTPS 与已保存的局域网入口不同。
              </Typography>
            )}
            {result.host_runtime_tls_alignment === 'mismatch-local' && (
              <Typography variant="body2" data-xdrive-caddy-host-runtime-tls-alignment>
                Caddy 运行域名与本机 TLS 域名不同。
              </Typography>
            )}
            {result.host_live_config_state === 'observed-local' && (
              <Typography variant="body2" data-xdrive-caddy-host-live-config-state>
                已读取 Caddy 运行配置指纹。
              </Typography>
            )}
            {result.host_instance_generation === 'same-instance-local' && (
              <Typography variant="body2" data-xdrive-caddy-instance-generation>
                Caddy 检查期间运行实例一致。
              </Typography>
            )}
            {result.host_alidns_module_state === 'absent-local' && (
              <Typography variant="body2" data-xdrive-caddy-alidns-module-state>
                当前 Caddy 未检测到 AliDNS 插件。
              </Typography>
            )}
            {result.ingress_change_risk && result.ingress_change_risk !== 'unverified' && (
              <Typography variant="body2" data-xdrive-caddy-ingress-change-risk>
                检测到切换入口可能导致管理连接中断。
              </Typography>
            )}
            {result.action === 'enable' && (
              <Stack spacing={1} alignItems="flex-start">
                <Button size="small" variant="outlined"
                  disabled={!source.verifyCaddyAliDNSRead || probeBusy || loading ||
                    !result.configuration_complete}
                  onClick={() => { void verifyAliDNSRead() }}>
                  {probeBusy ? '正在验证…' : '验证 AliDNS 读取权限'}
                </Button>
                {probeResult?.state === 'read_authorized' && (
                  <Typography variant="body2">AliDNS 读取权限已验证。</Typography>
                )}
                {probeResult?.state === 'denied' && (
                  <Typography variant="body2" color="error.main">AliDNS 读取权限被拒绝。</Typography>
                )}
                {probeError && <XDriveStatusAlert tone="bad">{probeError}</XDriveStatusAlert>}
              </Stack>
            )}
          </Stack>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
