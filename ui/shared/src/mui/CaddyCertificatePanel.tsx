import { Button, Divider, Paper, Stack, Typography } from '@mui/material'
import type { XDriveCaddyCertificate, XDriveCaddyCertificates } from '../service-dependencies'

// This is an explicitly user-triggered PUBLIC certificate export. No private
// key, admin bearer, cookie or remote URL is included in either download.
function savePublicCertificate(pem: string, filename: string, asDER = false): void {
  if (pem.length > 8192 ||
      !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(pem)) {
    return
  }
  let blob: Blob
  if (asDER) {
    const base64 = pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '')
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    blob = new Blob([bytes], { type: 'application/pkix-cert' })
  } else {
    blob = new Blob([pem], { type: 'application/x-pem-file' })
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function formatCertificateDate(value?: string): string {
  if (!value) return '未取得'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '未取得'
}

function CertificateEntry({
  label, certificate, identity,
}: {
  label: string
  certificate: XDriveCaddyCertificate
  identity: string
}) {
  const verified = certificate.state === 'verified-local'
  return (
    <Stack spacing={0.6} data-xdrive-caddy-cert-entry>
      <Typography variant="subtitle2" fontWeight={700}>{label}</Typography>
      <Typography variant="body2">
        {certificate.state === 'disabled' ? '未启用'
          : verified ? '当前 Caddy 证书：本机 TLS 身份验证通过'
          : '证书尚未核实；不会提供不可信证书下载'}
      </Typography>
      {verified && (<>
        <Typography variant="body2">目标身份：{identity}</Typography>
        <Typography variant="body2">SAN：{[...(certificate.dns_names ?? []), ...(certificate.ip_addresses ?? [])].join('、') || '未知'}</Typography>
        <Typography variant="body2">签发者：{certificate.issuer || '未记录'}</Typography>
        {certificate.chain_root_sha256 && (
          <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
            本机验证链根 CA SHA-256：{certificate.chain_root_sha256}
            {certificate.chain_root_not_after ? ` · 到期：${formatCertificateDate(certificate.chain_root_not_after)}` : ''}
          </Typography>
        )}
        <Typography variant="body2">生效：{formatCertificateDate(certificate.not_before)}</Typography>
        <Typography variant="body2">到期：{formatCertificateDate(certificate.not_after)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          叶证书 SHA-256：{certificate.leaf_sha256}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          本机核对：{formatCertificateDate(certificate.verified_at)}
        </Typography>
        <Button variant="outlined" size="small" sx={{ alignSelf: 'flex-start' }}
          disabled={!certificate.leaf_pem}
          onClick={() => certificate.leaf_pem &&
            savePublicCertificate(certificate.leaf_pem, label.startsWith('公网')
              ? 'xdrive-public-leaf.crt' : 'xdrive-lan-leaf.crt')}>
          下载公开叶证书（非私钥）
        </Button>
      </>)}
    </Stack>
  )
}

export function XDriveCaddyCertificatePanel({
  certificates, domain, lanIP,
}: {
  certificates?: XDriveCaddyCertificates
  domain: string
  lanIP: string
}) {
  if (!certificates || certificates.scope !== 'caddy-container-local-v1') {
    return (
      <Paper variant="outlined" sx={{ p: 1.5 }} data-xdrive-caddy-certificates>
        <Typography variant="subtitle2">HTTPS 证书管理</Typography>
        <Typography variant="body2" color="text.secondary">
          当前 Server/Agent 尚未提供证书明细；可使用既有 Caddy 本机 TLS 状态或升级服务端。
        </Typography>
      </Paper>
    )
  }
  const root = certificates.root_ca
  const lanReady = certificates.lan.state === 'verified-local' &&
    !!root && /^[0-9a-f]{64}$/.test(root.sha256)
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-xdrive-caddy-certificates>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" fontWeight={700}>HTTPS 证书管理</Typography>
        <Typography variant="caption" color="text.secondary">
          以下仅为固定 Caddy 容器的近期严格 TLS/主机名校验，不证明公网可达、
          客户端已经信任、配置长期生效或存在自动安装证书的权限。证书由 Caddy 自动管理续期。
        </Typography>
        <CertificateEntry label="公网域名 HTTPS" identity={domain || '未配置'}
          certificate={certificates.domain} />
        <Divider />
        <CertificateEntry label="局域网 IP HTTPS" identity={lanIP || '未配置'}
          certificate={certificates.lan} />
        {lanReady && root && (
          <Stack spacing={0.7} data-xdrive-caddy-lan-root>
            <Typography variant="subtitle2">内网私有 CA 公共根证书</Typography>
            <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
              根 CA SHA-256（证书 DER 指纹）：{root.sha256}
            </Typography>
            <Typography variant="body2">根 CA 到期：{formatCertificateDate(root.not_after)}</Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button variant="outlined" size="small"
                onClick={() => savePublicCertificate(root.pem, 'xdrive-lan-root.crt')}>
                下载根 CA（PEM）
              </Button>
              <Button variant="outlined" size="small"
                onClick={() => savePublicCertificate(root.pem, 'xdrive-lan-root.cer', true)}>
                下载 iPhone 根证书（CER）
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              请通过独立可信渠道确认指纹后再安装。iPhone：打开 CER，前往
              “设置 → 通用 → VPN 与设备管理”安装描述文件，再到
              “设置 → 通用 → 关于本机 → 证书信任设置”明确启用完全信任。
              这不会由 xDrive 自动完成。
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Windows/Linux/macOS 浏览器及 Web/PWA 需要其系统或浏览器信任此 CA；
              Desktop 可使用已有的应用内局域网信任流程。Android 原生 App 填写公网 HTTPS 域名及可选内网 IP 时，
              将 TCP 直连内网并继续验证域名公网证书；直接以 IP URL 访问才需要
              内网 CA 信任，不要关闭证书校验。
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}
