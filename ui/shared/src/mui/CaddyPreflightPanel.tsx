import { useEffect, useRef, useState } from 'react'
import { Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import type { XDriveCaddyHTTPSPreflight, XDriveCaddyPreflightCheck } from '../service-dependencies'

export type XDriveCaddyPreflightPort = {
  loadCaddyHTTPSPreflight?: () => Promise<XDriveCaddyHTTPSPreflight>
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

const states: Record<XDriveCaddyPreflightCheck['state'], string> = {
  pass: '本地检查符合',
  missing: '缺少配置',
  blocked: '尚不可用',
  unknown: '无法确认',
  'not-required': '当前意图无需',
}

export function XDriveCaddyPreflightPanel({ source, refreshID }: {
  source: XDriveCaddyPreflightPort
  refreshID: number
}) {
  const epochRef = useRef(0)
  const [result, setResult] = useState<XDriveCaddyHTTPSPreflight | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ++epochRef.current
    setResult(null)
    setLoading(false)
    setError('')
    return () => { ++epochRef.current }
  }, [source, refreshID])

  const check = async () => {
    if (!source.loadCaddyHTTPSPreflight || loading) return
    const epoch = ++epochRef.current
    setLoading(true)
    setResult(null)
    setError('')
    try {
      const next = await source.loadCaddyHTTPSPreflight()
      if (epoch !== epochRef.current) return
      // Old Agents and malformed responses cannot fabricate operational readiness.
      if (!Array.isArray(next.checks) || typeof next.apply_supported !== 'boolean') {
        throw new Error('预检响应不完整，请升级 Server/Agent。')
      }
      setResult(next)
    } catch (err) {
      if (epoch === epochRef.current) {
        setError(err instanceof Error ? err.message : 'HTTPS 预检失败。')
      }
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-preflight>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>Caddy · HTTPS 配置预检</Typography>
          <Button size="small" variant="outlined" disabled={loading || !source.loadCaddyHTTPSPreflight}
            onClick={() => { void check() }}>
            {loading ? '正在核对…' : '预检配置（只读）'}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          仅核对已保存的启停意图、AliDNS 密文完整性、Host Manager 心跳与当前网关只读观测。
          不连接阿里云、不修改 DNS 或 Caddy、不签发证书，也不推断目标修订已生效。
        </Typography>
        {result ? (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" variant="outlined"
                label={`意图：${result.action === 'enable' ? '启用 HTTPS' : result.action === 'disable' ? '停用 HTTPS' : '未设置'}`} />
              <Chip size="small" variant="outlined" label={`域名修订 #${result.desired_revision}`} />
              <Chip size="small" variant="outlined" label={`凭据修订 #${result.credential_revision}`} />
              <Chip size="small" variant="outlined" color={result.configuration_complete ? 'default' : 'warning'}
                label={result.configuration_complete ? '本地配置齐全（未应用）' : '本地配置不完整'} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              既有网关观测：{result.host_observed ? '新鲜可信' : '未知'}；
              内部 HTTP：{result.host_ingress_ready ? '健康' : '未确认健康'}；
              既有配置本机 TLS：{result.host_local_tls_verified ? '证书校验通过（非本次修订证明）' : '未确认'}。
            </Typography>
            <Stack spacing={1}>
              {result.checks.map((item) => (
                <Stack key={item.id} direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={600}>{titles[item.id] ?? item.id}</Typography>
                  <Chip size="small" variant="outlined"
                    color={item.state === 'blocked' || item.state === 'missing' ? 'warning' : 'default'}
                    label={states[item.state] ?? '未知'} />
                  <Typography variant="body2" color="text.secondary">{item.detail}</Typography>
                </Stack>
              ))}
            </Stack>
            <Typography variant="caption" color="warning.main">
              {result.apply_supported
                ? '预检绝不执行应用；必须由后续受限 Host Manager 协议执行并证明生效。'
                : '尚未提供防失联的安全应用接口：即使本地配置齐全，也不能在此处启停网关或宣称公网 HTTPS 可用。'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              检查时间：{new Date(result.checked_at).toLocaleString()}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {source.loadCaddyHTTPSPreflight
              ? '点击预检以核对实际缺少的安全应用前置条件。'
              : '旧版 Server/Agent 暂不支持预检，不提供无效的应用按钮。'}
          </Typography>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
