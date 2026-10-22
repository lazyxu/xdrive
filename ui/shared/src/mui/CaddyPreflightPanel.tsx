import { useEffect, useRef, useState } from 'react'
import { Button, Chip, Paper, Stack, Typography } from '@mui/material'
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
  desired: '管理配置',
  domain: 'HTTPS 域名',
  alidns: 'AliDNS 凭据',
  'host-manager': 'Host Manager',
  ingress: '网关入口',
  'restricted-apply': '安全部署',
  'public-https': '公网 HTTPS',
}

const states: Record<XDriveCaddyPreflightCheck['state'], string> = {
  pass: '通过',
  missing: '缺少配置',
  blocked: '受阻',
  unknown: '未知',
  'not-required': '不需要',
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

  // Manual, read-only: neither page mount nor config edits consume an online quota.
  const check = async () => {
    if (!source.loadCaddyHTTPSPreflight || loading) return
    const epoch = ++epochRef.current
    setLoading(true)
    ++probeEpochRef.current
    setProbeResult(null)
    setProbeError('')
    setError('')
    try {
      const next = await source.loadCaddyHTTPSPreflight()
      if (epoch === epochRef.current) setResult(verifyCaddyPreflightContract(next))
    } catch {
      if (epoch === epochRef.current) setError('预检失败，请重试。')
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
      if (epoch === probeEpochRef.current) {
        setProbeResult(verifyCaddyAliDNSReadContract(next, {
          desired_revision: result.desired_revision,
          credential_revision: result.credential_revision,
        }))
      }
    } catch {
      if (epoch === probeEpochRef.current) setProbeError('AliDNS 只读权限核验失败。')
    } finally {
      if (epoch === probeEpochRef.current) setProbeBusy(false)
    }
  }

  // Only show supported, actually obtained findings. Unknown/unobserved WAN,
  // CA client trust and missing Applied Receipt never become warning banners.
  const visibleChecks = result?.checks.filter((item) =>
    item.state === 'pass' ||
    ((item.state === 'blocked' || item.state === 'missing') &&
      ['desired', 'domain', 'alidns', 'host-manager', 'ingress'].includes(item.id))
  ) ?? []

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-preflight>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between"
          flexWrap="wrap" useFlexGap spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>安全检查</Typography>
          <Button size="small" variant="outlined" disabled={loading || !source.loadCaddyHTTPSPreflight}
            onClick={() => { void check() }}>
            {loading ? '正在检查…' : '运行只读预检'}
          </Button>
        </Stack>
        {result && (
          <Stack spacing={1.25} data-xdrive-caddy-preflight-verified-results>
            {result.host_live_config_state === 'observed-local' && (
              <Typography variant="body2" data-xdrive-caddy-host-live-config-state>
                已读取 Caddy 运行中配置指纹
              </Typography>
            )}
            {result.host_instance_generation === 'same-instance-local' && (
              <Typography variant="body2" data-xdrive-caddy-instance-generation>
                本轮容器运行代际一致
              </Typography>
            )}
            {result.host_alidns_module_state === 'present-local' && (
              <Typography variant="body2" data-xdrive-caddy-alidns-module-state>
                Caddy 已检测到 AliDNS 插件
              </Typography>
            )}
            {result.action === 'enable' && result.host_alidns_module_state === 'absent-local' && (
              <Typography variant="body2" color="error.main" data-xdrive-caddy-alidns-module-missing>
                当前 Caddy 缺少 AliDNS 插件
              </Typography>
            )}
            {visibleChecks.length > 0 && (
              <Stack spacing={1} data-xdrive-caddy-preflight-checks>
                {visibleChecks.map((item) => (
                  <Stack key={item.id} direction="row" gap={1} alignItems="flex-start"
                    flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" fontWeight={600}>{titles[item.id]}</Typography>
                    <Chip size="small" variant="outlined"
                      color={item.state === 'blocked' || item.state === 'missing' ? 'error' : 'default'}
                      label={states[item.state]} />
                    {(item.state === 'blocked' || item.state === 'missing') && (
                      <Typography variant="body2" color="text.secondary">{item.detail}</Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}
            {result.action === 'enable' && result.configuration_complete &&
              !!source.verifyCaddyAliDNSRead && (
              <Button size="small" variant="outlined"
                disabled={probeBusy || loading}
                onClick={() => { void verifyAliDNSRead() }}>
                {probeBusy ? '正在核验…' : '核验 AliDNS 只读权限（请求阿里云）'}
              </Button>
            )}
            {probeResult?.state === 'read_authorized' && (
              <Typography variant="body2" data-xdrive-caddy-alidns-read-verified>
                AliDNS 读取权限已验证
              </Typography>
            )}
            {probeResult?.state === 'denied' && (
              <Typography variant="body2" color="error.main" data-xdrive-caddy-alidns-read-denied>
                AliDNS 读取权限被拒绝
              </Typography>
            )}
            {probeError && <XDriveStatusAlert tone="bad">{probeError}</XDriveStatusAlert>}
            <Typography variant="caption" color="text.secondary">
              检查时间：{new Date(result.checked_at).toLocaleString()}
            </Typography>
          </Stack>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
