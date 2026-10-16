import { useEffect, useRef, useState } from 'react'
import { Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { XDriveStatusAlert } from './StatusAlert'
import { verifyCaddyPreflightContract, verifyCaddyAliDNSReadContract } from './CaddyPreflightValidation'
import type {
  XDriveCaddyHTTPSPreflight, XDriveCaddyPreflightCheck,
  XDriveCaddyAliDNSReadVerify, XDriveCaddyAliDNSReadVerifyInput,
} from '../service-dependencies'

export type XDriveCaddyPreflightPort = {
  loadCaddyHTTPSPreflight?: () => Promise<XDriveCaddyHTTPSPreflight>
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
            <Typography variant="body2"
              data-xdrive-caddy-desired-domain-local-match
              color={result.desired_domain_local_match === 'mismatch-local' ? 'error.main' : 'text.secondary'}>
              期望域名与本机已验证 TLS 域名：{result.desired_domain_local_match === 'matched-local'
                ? '本机握手的 SNI 与管理员期望域名匹配（不代表目标修订已应用或公网可用）'
                : result.desired_domain_local_match === 'mismatch-local'
                  ? '不匹配：当前 HTTPS 证书验证使用的部署域名与期望域名不同；不能认定配置已生效。'
                  : '尚未核验：缺少新鲜的 TLS 验证域名指纹、旧版 Host Manager，或当前期望不是启用 HTTPS。'}
            </Typography>
            <Typography variant="caption" color="text.secondary"
              data-xdrive-caddy-preflight-revision-snapshot>
              本次只读预检修订一致性：{result.revision_snapshot_consistent === true
                ? 'HTTPS 期望配置与 AliDNS 凭据的读取窗口已复核（不代表宿主机已经应用）'
                : '旧版 Server/Agent 未报告一致性复核；不能推断已应用。'}
            </Typography>
            <Typography variant="body2"
              data-xdrive-caddy-ingress-change-risk
              color={result.ingress_change_risk && result.ingress_change_risk !== 'unverified'
                ? 'warning.main' : 'text.secondary'}>
              网关变更防失联提示：{result.ingress_change_risk === 'local-https-removal'
                ? '当前本机 HTTPS 证书已验证；若将保存的停用意图真正部署，可能移除现有 HTTPS 访问路径。未证明存在备用管理入口。'
                : result.ingress_change_risk === 'local-domain-switch'
                  ? '管理员期望域名与既有本机 TLS 域名不同；如果执行切换，可能影响当前访问。未验证 DNS、证书和回滚路径。'
                  : '无法证明切换安全；缺少可靠的本机风险证据，或目前未观察到以上两类变更风险。'}
              这是只读风险提示，不是应用许可或公网 HTTPS 生效证明。
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
            <Stack spacing={1} alignItems="flex-start">
              <Button size="small" variant="outlined"
                disabled={!source.verifyCaddyAliDNSRead || probeBusy || loading ||
                  result.action !== 'enable' || !result.configuration_complete}
                onClick={() => { void verifyAliDNSRead() }}>
                {probeBusy ? '正在核验只读权限…' : '核验 AliDNS 实际只读权限（不会修改 DNS）'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                仅在管理员主动点击后，使用当前已加密保存的凭据请求阿里云固定
                DescribeSubDomainRecords 接口。不会添加、更新或删除 TXT 记录。
              </Typography>
              {probeResult && (
                <Stack spacing={0.5}>
                  <Chip size="small" variant="outlined"
                    color={probeResult.state === 'read_authorized' ? 'default' : 'warning'}
                    label={probeResult.state === 'read_authorized'
                      ? 'AliDNS 读取鉴权通过（写入权限未验证）'
                      : probeResult.state === 'denied' ? 'AliDNS 读取鉴权被拒绝' : 'AliDNS 读取鉴权无法确认'} />
                  <Typography variant="body2" color="text.secondary">{probeResult.detail}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    验证时间：{new Date(probeResult.checked_at).toLocaleString()} ·
                    未验证 DNS 写入、证书签发或 HTTPS 实际应用。
                  </Typography>
                </Stack>
              )}
              {probeError && <XDriveStatusAlert tone="bad">{probeError}</XDriveStatusAlert>}
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
