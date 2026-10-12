import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import type {
  XDriveCaddyHTTPSConfig, XDriveCaddyHTTPSUpdate,
  XDriveCaddyHTTPSRevisionPage, XDriveCaddyHTTPSRollbackInput,
} from '../service-dependencies'

export type XDriveCaddyHTTPSPort = {
  loadCaddyHTTPSConfig?: () => Promise<XDriveCaddyHTTPSConfig>
  saveCaddyHTTPSConfig?: (input: XDriveCaddyHTTPSUpdate) => Promise<XDriveCaddyHTTPSConfig>
  loadCaddyHTTPSRevisions?: () => Promise<XDriveCaddyHTTPSRevisionPage>
  rollbackCaddyHTTPS?: (input: XDriveCaddyHTTPSRollbackInput) => Promise<XDriveCaddyHTTPSConfig>
}

function validDomain(value: string): boolean {
  if (value === '') return true
  if (value.length > 253 || value.trim() !== value || value.length < 4) return false
  const labels = value.split('.')
  if (labels.length < 2) return false
  if (labels.some((label) => label.length < 1 || label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return false
  return /^[a-z]{2,}$/i.test(labels[labels.length - 1] ?? '')
}

const tlsLabels: Record<XDriveCaddyHTTPSConfig['host_tls_state'], string> = {
  verified: '本机 TLS 证书和域名已验证（非公网）',
  failed: '本机 TLS 验证失败',
  unavailable: '本机 TLS 验证不可用',
  'invalid-config': '宿主机 HTTPS 配置不合法',
  disabled: '宿主机未启用 HTTPS',
  unknown: '宿主机 TLS 状态未知',
}

export function XDriveCaddyHTTPSDesiredPanel({
  source, refreshID, onConfigurationChanged, section = 'config', onDirtyChange,
}: {
  source: XDriveCaddyHTTPSPort
  refreshID: number
  onConfigurationChanged?: () => void
  section?: 'config' | 'history'
  onDirtyChange?: (dirty: boolean) => void
}) {
  const epochRef = useRef(0)
  const [config, setConfig] = useState<XDriveCaddyHTTPSConfig | null>(null)
  const [history, setHistory] = useState<XDriveCaddyHTTPSRevisionPage['items']>([])
  const [enabled, setEnabled] = useState(false)
  const [domain, setDomain] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    const epoch = ++epochRef.current
    setConfig(null)
    setHistory([])
    setEnabled(false)
    setDomain('')
    setTarget('')
    setBusy(false)
    setLoading(true)
    setError('')
    setNotice('')
    setConfirmSave(false)
    setConfirmRollback(false)
    if (source.loadCaddyHTTPSConfig) {
      void source.loadCaddyHTTPSConfig().then((next) => {
        if (!active || epoch !== epochRef.current) return
        setConfig(next)
        setEnabled(next.desired_enabled)
        setDomain(next.desired_domain)
      }).catch(() => {
        if (active && epoch === epochRef.current) setError('无法读取 Caddy HTTPS 期望配置；请检查 Server/Agent 版本。')
      }).finally(() => {
        if (active && epoch === epochRef.current) setLoading(false)
      })
    } else {
      setLoading(false)
    }
    if (section === 'history' && source.loadCaddyHTTPSRevisions) {
      void source.loadCaddyHTTPSRevisions().then((page) => {
        if (active && epoch === epochRef.current) setHistory(page.items)
      }).catch(() => {
        if (active && epoch === epochRef.current) setError('无法读取 Caddy HTTPS 配置历史；请检查 Server/Agent 版本。')
      })
    }
    return () => { active = false; ++epochRef.current }
  }, [source, refreshID, section])

  const reload = async () => {
    if (!source.loadCaddyHTTPSConfig || busy) return
    const epoch = ++epochRef.current
    setLoading(true)
    setError('')
    try {
      const next = await source.loadCaddyHTTPSConfig()
      if (epoch !== epochRef.current) return
      setConfig(next)
      setEnabled(next.desired_enabled)
      setDomain(next.desired_domain)
      if (source.loadCaddyHTTPSRevisions) {
        const page = await source.loadCaddyHTTPSRevisions().catch(() => null)
        if (page && epoch === epochRef.current) setHistory(page.items)
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(err instanceof Error ? err.message : '刷新 HTTPS 配置失败。')
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  const save = async () => {
    if (!config || !source.saveCaddyHTTPSConfig || busy || !validDomain(domain) || (enabled && !domain)) return
    const epoch = ++epochRef.current
    setBusy(true)
    setConfirmSave(false)
    setError('')
    setNotice('')
    try {
      const next = await source.saveCaddyHTTPSConfig({
        revision: config.revision, enabled, domain: domain.toLowerCase(),
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setEnabled(next.desired_enabled)
      setDomain(next.desired_domain)
      setNotice('期望配置已保存并审计；宿主机实际 HTTPS 未应用，需后续受限部署操作。')
      onConfigurationChanged?.() // Invalidate preflight and any prior cloud read proof.
      const page = await source.loadCaddyHTTPSRevisions?.().catch(() => null)
      if (page && epoch === epochRef.current) setHistory(page.items)
    } catch (err) {
      if (epoch === epochRef.current) setError(err instanceof Error ? err.message : '保存 HTTPS 期望配置失败；请刷新检查版本。')
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const rollback = async () => {
    if (!config || !source.rollbackCaddyHTTPS || busy || !target) return
    const epoch = ++epochRef.current
    setBusy(true)
    setConfirmRollback(false)
    setError('')
    setNotice('')
    try {
      const next = await source.rollbackCaddyHTTPS({
        revision: config.revision, target_revision: Number(target),
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setEnabled(next.desired_enabled)
      setDomain(next.desired_domain)
      setTarget('')
      setNotice('历史期望配置已恢复为新修订，仍待单独、安全地应用至 Caddy。')
      onConfigurationChanged?.()
      const page = await source.loadCaddyHTTPSRevisions?.().catch(() => null)
      if (page && epoch === epochRef.current) setHistory(page.items)
    } catch (err) {
      if (epoch === epochRef.current) setError(err instanceof Error ? err.message : '恢复历史 HTTPS 期望配置失败。')
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const valid = validDomain(domain) && (!enabled || domain.length > 0)
  const canEdit = !!config?.editable && !busy && !loading
  const changed = !!config && (
    enabled !== config.desired_enabled || domain.toLowerCase() !== config.desired_domain
  )
  useEffect(() => { onDirtyChange?.(changed) }, [onDirtyChange, changed])

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-https-desired>
      <Stack spacing={1.5}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>Caddy · HTTPS 期望配置</Typography>
          <Button size="small" variant="outlined" disabled={busy || loading || !source.loadCaddyHTTPSConfig}
            onClick={() => { void reload() }}>核查配置与实际状态</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          仅保存管理员的 HTTPS 期望域名和启用意图，不会修改宿主机 .env、DNS 凭据、证书或重启 Caddy。
          未来需经防管理入口失联的受限 Host Manager 单独预检和应用。
        </Typography>
        {config ? (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" useFlexGap>
              <Chip variant="outlined" size="small" color="warning"
                label={config.apply_state === 'pending' ? '期望配置未应用' : '未由管理员管理'} />
              <Typography variant="caption" color="text.secondary">
                期望修订 #{config.revision} · {config.source === 'saved' ? '持久化期望配置' : '默认值（不代表宿主部署）'}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              期望：{config.desired_enabled ? '启用 HTTPS' : '保持 HTTPS 禁用'}
              {' · '}域名：{config.desired_domain || '未填写'}
              {' · '}宿主机：{!config.host_observed ? '无法观察' :
                config.host_https_configured ? '配置了 HTTPS' : '未配置 HTTPS'}
              {' · '}{tlsLabels[config.host_tls_state] ?? '状态未知'}
            </Typography>
            {section === 'config' && (<>
            <FormControlLabel
              control={<Switch checked={enabled} disabled={!canEdit}
                onChange={(event) => setEnabled(event.target.checked)} />}
              label="期望启用 HTTPS（保存后不会改变当前网关）"
            />
            <TextField fullWidth size="small" label="期望 HTTPS 域名 (FQDN)"
              value={domain} disabled={!canEdit}
              onChange={(event) => setDomain(event.target.value)}
              error={!valid}
              placeholder="photos.example.com"
              helperText="仅接受纯 DNS 域名，不含 https://、端口、路径、IP 或通配符。禁用时可清空。"
            />
            <Button variant="outlined" size="small"
              disabled={!canEdit || !valid || !changed || !source.saveCaddyHTTPSConfig}
              onClick={() => setConfirmSave(true)}>仅保存期望配置（不操作 Caddy）</Button>
            <Typography variant="caption" color="warning.main">
              {config.requirement}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {config.apply_supported ? '宿主机控制能力待独立验证' : '实际应用尚未开放：没有可安全操作网关的控制接口。'}
              {' '}本机 TLS 验证不等于公网 HTTPS 可访问。
            </Typography>
            </>)}
            {section === 'history' && source.loadCaddyHTTPSRevisions && source.rollbackCaddyHTTPS && (
              <Box>
                <Typography variant="subtitle2" fontWeight={700}>历史修订与审计回滚</Typography>
                <TextField fullWidth select size="small" label="选择历史期望配置"
                  sx={{ mt: 1 }} value={target} disabled={!canEdit}
                  onChange={(event) => setTarget(event.target.value)}>
                  <MenuItem value="">请选择较早版本</MenuItem>
                  {history.filter((item) => item.revision < config.revision).map((item) => (
                    <MenuItem key={item.revision} value={String(item.revision)}>
                      #{item.revision} · {item.enabled ? '期望启用' : '期望关闭'} · {item.domain || '无域名'} · {item.origin}
                    </MenuItem>
                  ))}
                </TextField>
                <Button variant="outlined" size="small" sx={{ mt: 1 }}
                  disabled={!canEdit || !target} onClick={() => setConfirmRollback(true)}>
                  恢复历史期望配置
                </Button>
              </Box>
            )}
            <XDriveConfirmDialog open={confirmSave} loading={busy}
              title="保存 Caddy HTTPS 期望配置"
              description="仅保存管理员期望的 HTTPS 域名及启用状态，产生审计修订；不部署证书、不修改 DNS、不重启或关闭 Caddy。"
              confirmLabel="保存期望修订" onCancel={() => setConfirmSave(false)}
              onConfirm={() => { void save() }} />
            <XDriveConfirmDialog open={confirmRollback} loading={busy}
              title="恢复历史 Caddy HTTPS 期望配置"
              description="回滚仅创建新的审计修订，宿主机正在运行的 Caddy 不受影响。"
              confirmLabel="保存回滚修订" onCancel={() => setConfirmRollback(false)}
              onConfirm={() => { void rollback() }} />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {loading ? '正在读取配置…' : '当前 Server/Agent 不支持 Caddy HTTPS 期望配置；不会提供失效按钮。'}
          </Typography>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
