import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, FormControlLabel, MenuItem, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { xDriveCaddyReadFailureMessage } from '../caddy-read-error'
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

function validPrivateLANIP(value: string): boolean {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return false
  const octets = value.split('.').map(Number)
  if (octets.some(part => part > 255)) return false
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
}

export function XDriveCaddyHTTPSDesiredPanel({
  source, refreshID, onConfigurationChanged, section = 'config', onDirtyChange, inlineEdit = false,
}: {
  source: XDriveCaddyHTTPSPort
  refreshID: number
  onConfigurationChanged?: () => void
  section?: 'config' | 'history'
  onDirtyChange?: (dirty: boolean) => void
  inlineEdit?: boolean
}) {
  const epochRef = useRef(0)
  const [config, setConfig] = useState<XDriveCaddyHTTPSConfig | null>(null)
  const [history, setHistory] = useState<XDriveCaddyHTTPSRevisionPage['items']>([])
  const [historyError, setHistoryError] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [domain, setDomain] = useState('')
  const [lanEnabled, setLANEnabled] = useState(false)
  const [lanIP, setLANIP] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirmSave, setConfirmSave] = useState(false)
  const [editingState, setEditing] = useState(false)
  const editing = inlineEdit || editingState
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    const epoch = ++epochRef.current
    setConfig(null)
    setHistory([])
    setHistoryError('')
    setEnabled(false)
    setDomain('')
    setLANEnabled(false)
    setLANIP('')
    setTarget('')
    setBusy(false)
    setLoading(true)
    setError('')
    setNotice('')
    setConfirmSave(false)
    setConfirmRollback(false)
    setEditing(false)
    if (source.loadCaddyHTTPSConfig) {
      void source.loadCaddyHTTPSConfig().then((next) => {
        if (!active || epoch !== epochRef.current) return
        setConfig(next)
        setEnabled(next.desired_enabled)
        setDomain(next.desired_domain)
        setLANEnabled(next.desired_lan_enabled === true)
        setLANIP(next.desired_lan_ip ?? '')
      }).catch((err: unknown) => {
        if (active && epoch === epochRef.current) setError(xDriveCaddyReadFailureMessage(err, 'https'))
      }).finally(() => {
        if (active && epoch === epochRef.current) setLoading(false)
      })
    } else {
      setLoading(false)
    }
    if (section === 'history' && source.loadCaddyHTTPSRevisions) {
      void source.loadCaddyHTTPSRevisions().then((page) => {
        if (active && epoch === epochRef.current) setHistory(page.items)
      }).catch((err: unknown) => {
        if (active && epoch === epochRef.current) setHistoryError(xDriveCaddyReadFailureMessage(err, 'history'))
      })
    }
    return () => { active = false; ++epochRef.current }
  }, [source, refreshID, section])

  const supportsLAN = typeof config?.desired_lan_enabled === 'boolean' &&
    typeof config?.desired_lan_ip === 'string'
  const valid = validDomain(domain) && (!enabled || domain.length > 0) &&
    (!lanIP || validPrivateLANIP(lanIP)) && (!lanEnabled || validPrivateLANIP(lanIP)) &&
    (lanEnabled || enabled)
  const canEdit = !!config?.editable && !busy && !loading
  const changed = !!config && (
    enabled !== config.desired_enabled || domain.toLowerCase() !== config.desired_domain ||
    (supportsLAN && (lanEnabled !== config.desired_lan_enabled || lanIP !== config.desired_lan_ip))
  )
  useEffect(() => { onDirtyChange?.(changed) }, [onDirtyChange, changed])


  const reload = async () => {
    if (!source.loadCaddyHTTPSConfig || busy || changed) return
    const epoch = ++epochRef.current
    setLoading(true)
    setError('')
    if (section === 'history') setHistoryError('')
    try {
      const next = await source.loadCaddyHTTPSConfig()
      if (epoch !== epochRef.current) return
      setConfig(next)
      setEnabled(next.desired_enabled)
      setDomain(next.desired_domain)
      setLANEnabled(next.desired_lan_enabled === true)
      setLANIP(next.desired_lan_ip ?? '')
      if (section === 'history' && source.loadCaddyHTTPSRevisions) {
        const page = await source.loadCaddyHTTPSRevisions().catch((err: unknown) => {
          if (epoch === epochRef.current) setHistoryError(xDriveCaddyReadFailureMessage(err, 'history'))
          return null
        })
        if (page && epoch === epochRef.current) setHistory(page.items)
      }
    } catch (err) {
      if (epoch === epochRef.current) setError(xDriveCaddyReadFailureMessage(err, 'https'))
    } finally {
      if (epoch === epochRef.current) setLoading(false)
    }
  }

  const save = async () => {
    if (!config || !config.editable || !source.saveCaddyHTTPSConfig || busy || !validDomain(domain) ||
      (enabled && !domain) || !supportsLAN || !valid) return
    const epoch = ++epochRef.current
    setBusy(true)
    setConfirmSave(false)
    setError('')
    setNotice('')
    try {
      const next = await source.saveCaddyHTTPSConfig({
        revision: config.revision, enabled, domain: domain.toLowerCase(),
        lan_enabled: lanEnabled, lan_ip: lanIP,
      })
      if (epoch !== epochRef.current) return
      setConfig(next)
      setEnabled(next.desired_enabled)
      setDomain(next.desired_domain)
      setLANEnabled(next.desired_lan_enabled === true)
      setLANIP(next.desired_lan_ip ?? '')
      setNotice('期望配置已保存并审计；宿主机实际 HTTPS 未应用，需后续受限部署操作。')
      setEditing(false)
      onConfigurationChanged?.() // Invalidate prior evidence; history is fetched on opening it.
    } catch (err) {
      if (epoch === epochRef.current) setError(err instanceof Error ? err.message : '保存 HTTPS 期望配置失败；请刷新检查版本。')
    } finally {
      if (epoch === epochRef.current) setBusy(false)
    }
  }

  const rollback = async () => {
    if (!config || !config.editable || !source.rollbackCaddyHTTPS || busy || !target) return
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
      setLANEnabled(next.desired_lan_enabled === true)
      setLANIP(next.desired_lan_ip ?? '')
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


  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-https-desired>
      <Stack spacing={1.5}>
        {section === 'config' && (<>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>{inlineEdit ? 'HTTPS 访问入口' : 'Caddy · HTTPS 期望配置'}</Typography>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            {!inlineEdit && <Button size="small" variant="outlined" data-xdrive-caddy-https-edit-toggle
              disabled={!canEdit || (editing && changed)}
              onClick={() => setEditing((old) => !old)}>
              {editing ? '完成' : '编辑'}
            </Button>}
            <Button size="small" variant="text" disabled={busy || loading || changed || !source.loadCaddyHTTPSConfig}
              onClick={() => { void reload() }}>重新读取已保存配置</Button>
          </Stack>
        </Stack>
        {changed && <Typography variant="caption" color="warning.main" data-xdrive-caddy-draft-refresh-guard>
          当前有未保存的修改，禁止重新读取覆盖草稿；请先保存或恢复原配置。
        </Typography>}
        {editing && !inlineEdit && (
          <Typography variant="body2" color="text.secondary">
            这里独立管理局域网 IP HTTPS 和公网域名 HTTPS 期望配置，允许同时启用，但不允许同时关闭。
            保存会审计期望修订，不修改宿主机 .env、证书、Caddy 或启动参数；实际生效需要后续独立
            的受限 Host Manager 验证和受控重启，不能将“保存成功”误当成运行入口已变化。
          </Typography>
        )}
        </>)}
        {config ? (
          <>
            {section === 'config' && (<>
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" useFlexGap>
              <Chip variant="outlined" size="small" color="warning"
                label={config.host_apply_pending ? 'Host 申请待协调 · 编辑已锁定' :
                  config.source === 'host-import' ? '旧宿主配置已导入 · 生效待核验' :
                  config.apply_state === 'pending' ? '期望配置未应用' : '未由管理员管理'} />
              <Typography variant="caption" color="text.secondary">
                期望修订 #{config.revision} · {config.source === 'host-import' ? '升级时导入的原 Caddy 入口（不构成已应用回执）' :
                  config.source === 'saved' ? '持久化期望配置' : '部署入口初始值（未保存，非生效证明）'}
              </Typography>
            </Stack>
            {config.host_apply_pending && <Typography variant="body2" color="warning.main" data-xdrive-caddy-host-pending-fence>
              存在待协调的宿主配置申请，IP/域名修改和历史回滚已锁定；这不是已部署或已重启的证明。
            </Typography>}
            {config.source === 'host-import' && editing && !inlineEdit && <Typography variant="body2" color="text.secondary" data-xdrive-caddy-host-import>
              已导入旧 Caddy 的 IP／域名管理记录。原证书和网关配置继续保留；请在「状态与检测」确认实际连接，
              不要把导入的修订号当成后续修改已生效。
            </Typography>}
            {editing && !inlineEdit && (
              <Typography variant="caption" color="text.secondary" data-xdrive-caddy-evidence-location>
                运行状态、IP/域名 TLS 校验及实际生效证据集中在上方「状态与检测」；此处仅编辑期望值。
              </Typography>
            )}
            {!editing && (
              <Stack spacing={1} data-xdrive-caddy-https-readonly-summary>
                <Typography variant="body2">
                  局域网 IP HTTPS 目标：{typeof config.desired_lan_enabled === 'boolean'
                    ? (config.desired_lan_enabled ? '开启' : '关闭')
                    : '未知（当前客户端未报告 LAN 目标）'}
                  {config.desired_lan_ip ? ' · ' + config.desired_lan_ip : ''}
                </Typography>
                <Typography variant="body2">
                  公网域名 HTTPS 目标：{config.desired_enabled ? '开启' : '关闭'}
                  {config.desired_domain ? ' · ' + config.desired_domain : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  已保存目标、实际网关状态与应用回执独立；此处不执行 Caddy 应用。
                </Typography>
              </Stack>
            )}
            </>)}
            {section === 'config' && editing && (<>
            <Typography variant="subtitle2" fontWeight={700}>
              局域网 IP HTTPS · 默认部署入口
            </Typography>
            <FormControlLabel
              control={<Switch checked={lanEnabled} disabled={!canEdit || !supportsLAN || (lanEnabled && !enabled)}
                onChange={(event) => setLANEnabled(event.target.checked)} />}
              label="期望启用局域网 IP HTTPS（保存后仍需受限维护重启）"
            />
            <TextField fullWidth size="small" label="期望局域网 IPv4 地址"
              value={lanIP} disabled={!canEdit || !supportsLAN}
              onChange={(event) => setLANIP(event.target.value)}
              error={Boolean(lanIP) && !validPrivateLANIP(lanIP)}
              placeholder="192.168.2.4"
              helperText="必须是标准私有 IPv4；证书通过本机 CA 签发，设备需要自行安全地信任 CA。"
            />
            <Typography variant="subtitle2" fontWeight={700}>
              公网域名 HTTPS · 可选入口
            </Typography>
            <FormControlLabel
              control={<Switch checked={enabled} disabled={!canEdit || (enabled && !lanEnabled)}
                onChange={(event) => setEnabled(event.target.checked)} />}
              label="启用公网域名 HTTPS（保存后不会改变当前网关）"
            />
            <Typography variant="caption" color="text.secondary">
              关闭当前唯一启用的入口前，请先开启另一入口；两种入口允许同时开启。
            </Typography>
            <TextField fullWidth size="small" label="期望 HTTPS 域名 (FQDN)"
              value={domain} disabled={!canEdit}
              onChange={(event) => setDomain(event.target.value)}
              error={!validDomain(domain) || (enabled && !domain)}
              placeholder="photos.example.com"
              helperText="仅接受纯 DNS 域名，不含 https://、端口、路径、IP 或通配符。禁用时可清空。"
            />
            {!supportsLAN && <Typography variant="caption" color="warning.main">
              当前 Server/Agent 尚未报告双入口合同，禁止保存不完整的网络启停意图。
            </Typography>}
            {!lanEnabled && !enabled && <Typography variant="caption" color="error.main">
              不能同时关闭局域网 IP HTTPS 和公网域名 HTTPS；至少保留一个可信管理入口。
            </Typography>}
            <Button variant="outlined" size="small"
              disabled={!canEdit || !supportsLAN || !valid || !changed || !source.saveCaddyHTTPSConfig}
              onClick={() => setConfirmSave(true)}>{inlineEdit ? '保存配置' : '仅保存期望配置（不操作 Caddy）'}</Button>
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
                <Typography variant="body2" color="text.secondary">
                  当前期望修订 #{config.revision}。选择历史修订只会创建新的审计记录；
                  不能证明运行中的 Caddy 已应用，且不会直接操作宿主机。
                </Typography>
                <TextField fullWidth select size="small" label="选择历史期望配置"
                  sx={{ mt: 1 }} value={target} disabled={!canEdit}
                  onChange={(event) => setTarget(event.target.value)}>
                  <MenuItem value="">请选择较早版本</MenuItem>
                  {history.filter((item) => item.revision < config.revision).map((item) => (
                    <MenuItem key={item.revision} value={String(item.revision)}>
                      #{item.revision} · 域名 {item.enabled ? '开启' : '关闭'} · {item.domain || '无域名'}
                      {' · '}LAN IP {item.lan_enabled ? '开启' : '关闭'} · {item.lan_ip || '未设置'} · {item.origin}
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
              description="仅保存独立的 LAN IP HTTPS 与公网域名 HTTPS 启用目标并审计，必须至少保留一个开启；不自动修改宿主机环境、不重启 Caddy，也不声明已生效。"
              confirmLabel="保存期望修订" onCancel={() => setConfirmSave(false)}
              onConfirm={() => { void save() }} />
            <XDriveConfirmDialog open={confirmRollback} loading={busy}
              title="恢复历史 Caddy HTTPS 期望配置"
              description="回滚仅创建新的审计修订，宿主机正在运行的 Caddy 不受影响。"
              confirmLabel="保存回滚修订" onCancel={() => setConfirmRollback(false)}
              onConfirm={() => { void rollback() }} />
          </>
        ) : (
          loading ? <Typography variant="body2" color="text.secondary">正在读取配置…</Typography>
          : source.loadCaddyHTTPSConfig ? (
            <Stack spacing={1} data-xdrive-caddy-https-read-failed>
              <Typography variant="body2" color="text.secondary">
                本次未能取得当前 HTTPS 配置；编辑与历史回滚保持禁用。这不代表网关已停止或接口一定不受支持。
              </Typography>
              <Button size="small" variant="outlined" disabled={busy}
                onClick={() => { void reload() }}>重试读取 HTTPS 配置</Button>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              此客户端尚未提供 HTTPS 配置接口；请更新匹配的客户端与 Server/Agent 版本。
            </Typography>
          )
        )}
        {section === 'history' && historyError && <XDriveStatusAlert tone="bad">{historyError}</XDriveStatusAlert>}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
