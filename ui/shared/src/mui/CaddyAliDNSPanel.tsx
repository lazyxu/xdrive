import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { xDriveCaddyReadFailureMessage } from '../caddy-read-error'
import type { XDriveCaddyAliDNSConfig, XDriveCaddyAliDNSUpdate, XDriveCaddyAliDNSReveal } from '../service-dependencies'

export type XDriveCaddyAliDNSPort = {
  loadCaddyAliDNSConfig?: () => Promise<XDriveCaddyAliDNSConfig>
  saveCaddyAliDNS?: (input: XDriveCaddyAliDNSUpdate) => Promise<XDriveCaddyAliDNSConfig>
  revealCaddyAliDNS?: (revision: number) => Promise<XDriveCaddyAliDNSReveal>
}

function validSecret(value: string, min: number, max: number) {
  return value.length >= min && value.length <= max && /^[\x21-\x7e]+$/.test(value)
}

// Global credentials are staged only. This panel never controls Caddy or DNS.
export function XDriveCaddyAliDNSPanel({ source, refreshID, onConfigurationChanged, onDirtyChange, active = true }: {
  source: XDriveCaddyAliDNSPort
  refreshID: number
  onConfigurationChanged?: () => void
  onDirtyChange?: (dirty: boolean) => void
  active?: boolean // Hide temporary plaintext when Caddy config tab is no longer visible.
}) {
  const requestEpochRef = useRef(0)
  const revealEpochRef = useRef(0)
  const [config, setConfig] = useState<XDriveCaddyAliDNSConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryReadID, setRetryReadID] = useState(0)
  const [busy, setBusy] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [keyID, setKeyID] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [shown, setShown] = useState<XDriveCaddyAliDNSReveal | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const hide = useCallback(() => {
    ++revealEpochRef.current
    setShown(null)
    setRevealing(false)
  }, [])

  useEffect(() => {
    if (!active) hide()
  }, [active, hide])

  useEffect(() => {
    const conceal = () => { if (document.visibilityState !== 'visible') hide() }
    document.addEventListener('visibilitychange', conceal)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('visibilitychange', conceal)
      window.removeEventListener('blur', hide)
    }
  }, [hide])

  useEffect(() => {
    if (!shown) return
    // A revealed credential is short-lived in the renderer even if the
    // operator leaves the page open. Switching accounts also clears it.
    const timer = window.setTimeout(() => setShown(null), Math.min(30, shown.expires_in_seconds) * 1000)
    return () => window.clearTimeout(timer)
  }, [shown])

  useEffect(() => {
    let active = true
    const epoch = ++requestEpochRef.current
    setConfig(null)
    setKeyID('')
    setKeySecret('')
    setShown(null)
    setRevealing(false)
    setManageOpen(false)
    setBusy(false)
    setConfirmSave(false)
    setConfirmClear(false)
    setLoading(true)
    setError('')
    setNotice('')
    if (source.loadCaddyAliDNSConfig) {
      void source.loadCaddyAliDNSConfig().then((cfg) => {
        if (active && epoch === requestEpochRef.current) setConfig(cfg)
      }).catch((err: unknown) => {
        if (active && epoch === requestEpochRef.current) setError(xDriveCaddyReadFailureMessage(err, 'alidns'))
      }).finally(() => {
        if (active && epoch === requestEpochRef.current) setLoading(false)
      })
    } else {
      setLoading(false)
    }
    return () => { active = false; ++requestEpochRef.current; ++revealEpochRef.current }
  }, [source, refreshID, retryReadID])

  const valid = validSecret(keyID, 8, 128) && validSecret(keySecret, 8, 256)
  const canEdit = !!config?.editable && !busy && !loading && !revealing

  const save = async (clear = false) => {
    if (!config || !config.editable || !source.saveCaddyAliDNS || busy || (!clear && !valid) || (clear && !config.configured)) return
    const epoch = ++requestEpochRef.current
    ++revealEpochRef.current
    setBusy(true)
    setConfirmSave(false)
    setConfirmClear(false)
    setShown(null)
    setError('')
    setNotice('')
    try {
      const next = await source.saveCaddyAliDNS(clear
        ? { revision: config.revision, clear: true }
        : { revision: config.revision, access_key_id: keyID, access_key_secret: keySecret })
      if (epoch !== requestEpochRef.current) return
      setConfig(next)
      setKeyID('')
      setKeySecret('')
      setNotice(clear
        ? '已清除服务器保存的 AliDNS 凭据并记入审计；宿主机现有配置未改变。'
        : 'AliDNS AK/SK 已加密保存并审计；仅为待应用的期望配置，未部署或验证。')
      setManageOpen(false)
      onConfigurationChanged?.() // A rotated or cleared key invalidates old proof.
    } catch (err) {
      if (epoch === requestEpochRef.current) setError(err instanceof Error ? err.message : 'AliDNS 凭据保存失败。')
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false)
    }
  }

  const reveal = async () => {
    if (!config?.configured || !source.revealCaddyAliDNS || revealing || busy) return
    const epoch = ++revealEpochRef.current
    setShown(null)
    setRevealing(true)
    setError('')
    try {
      const next = await source.revealCaddyAliDNS(config.revision)
      if (epoch !== revealEpochRef.current) return
      if (!next.access_key_id || !next.access_key_secret ||
          !Number.isFinite(next.expires_in_seconds) || next.expires_in_seconds <= 0) {
        throw new Error('AliDNS 临时查看响应无效')
      }
      setShown(next)
    } catch (err) {
      if (epoch === revealEpochRef.current) setError(err instanceof Error ? err.message : '临时查看凭据失败。')
    } finally {
      if (epoch === revealEpochRef.current) setRevealing(false)
    }
  }

  useEffect(() => { onDirtyChange?.(keyID.length > 0 || keySecret.length > 0) },
    [onDirtyChange, keyID, keySecret])

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-alidns>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>Caddy · AliDNS DNS-01 凭据</Typography>
          {config && (
            <Button size="small" variant="outlined" data-xdrive-caddy-alidns-manage
              disabled={busy || revealing || (manageOpen && (keyID.length > 0 || keySecret.length > 0))}
              onClick={() => { hide(); setManageOpen((opened) => !opened) }}>
              {manageOpen ? '收起管理' : '管理'}
            </Button>
          )}
        </Stack>
        {manageOpen && (
          <Typography variant="body2" color="text.secondary">
            实例级阿里云 AccessKey ID / AccessKey Secret，仅加密保存在 Server 数据库。
            保存不会更新宿主机 .env、签发证书、查询 DNS 或启停 Caddy。
          </Typography>
        )}
        {config ? (
          <>
            {config.host_apply_pending && <Typography variant="body2" color="warning.main" data-xdrive-caddy-alidns-host-pending>
              存在未应用的 Host 申请，AliDNS 凭据修改与清除已锁定，须由独立操作员核对；此状态不表示 Caddy 或 DNS 已生效。
            </Typography>}
            {!config.editable && !config.host_apply_pending && <Typography variant="caption" color="warning.main" data-xdrive-caddy-alidns-no-keyring>
              当前服务器尚无可用的凭据加密密钥，AliDNS 配置只能读取、不能修改；读取接口本身不要求配置密钥。
            </Typography>}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" variant="outlined"
                color={config.configured ? 'warning' : 'default'}
                label={config.source === 'host-import' ? '原 Caddy 凭据已加密导入 · 生效另验' :
                  config.configured ? '已加密保存 · 待应用' : '服务器未保存凭据'} />
              <Chip size="small" variant="outlined" label={`凭据修订 #${config.revision}`} />
            </Stack>
            {manageOpen && (<>
            <TextField fullWidth size="small" label="AccessKey ID（新值）"
              type="password" autoComplete="new-password" value={keyID}
              onChange={(event) => setKeyID(event.target.value)} disabled={!canEdit}
              helperText="留空表示不修改；更换时必须同时填写 ID 和 Secret。" />
            <TextField fullWidth size="small" label="AccessKey Secret（新值）"
              type="password" autoComplete="new-password" value={keySecret}
              onChange={(event) => setKeySecret(event.target.value)} disabled={!canEdit}
              helperText="只接受可打印的非空 ASCII 凭据；填写后请在安全环境操作。" />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" disabled={!canEdit || !valid || !source.saveCaddyAliDNS}
                onClick={() => setConfirmSave(true)}>加密保存凭据（不应用 Caddy）</Button>
              <Button size="small" variant="outlined"
                disabled={!canEdit || !config.configured || !source.revealCaddyAliDNS}
                onClick={() => { void reveal() }}>临时显示已保存凭据（审计）</Button>
              <Button size="small" color="error" variant="text"
                disabled={!canEdit || !config.configured || !source.saveCaddyAliDNS}
                onClick={() => setConfirmClear(true)}>清除已保存凭据</Button>
            </Stack>
            {shown && (
              <Box>
                <TextField size="small" fullWidth label="已保存 AccessKey ID · 临时显示"
                  value={shown.access_key_id} slotProps={{ input: { readOnly: true } }} sx={{ mb: 1 }} />
                <TextField size="small" fullWidth label="已保存 AccessKey Secret · 临时显示"
                  value={shown.access_key_secret} slotProps={{ input: { readOnly: true } }} />
                <Button size="small" onClick={hide}>立即隐藏凭据</Button>
              </Box>
            )}
            {config.source === 'host-import' && manageOpen && <Typography variant="body2" color="text.secondary" data-xdrive-caddy-alidns-host-import>
              AliDNS 凭据来自旧宿主并已加密入库；运行中的 Caddy 未因此重启或轮换密钥。
              后续编辑仍需独立的安全应用流程及 DNS／证书验证。
            </Typography>}
            {manageOpen && (<>
              <Typography variant="caption" color="warning.main">{config.requirement}</Typography>
              <Typography variant="caption" color="text.secondary">
                实际生效检测：尚不支持。当前凭据状态仅说明加密存储，不代表 AliDNS 权限有效、
                DNS-01 验证成功或 HTTPS 公网可达；受限 Host Manager 预检与应用在后续阶段实施。
              </Typography>
            </>)}
            </>)}
            <XDriveConfirmDialog open={confirmSave} loading={busy}
              title="加密保存 AliDNS 凭据"
              description="保存新 ID/Secret 将创建审计修订，但不替换宿主机凭据，也不会操作 Caddy。"
              confirmLabel="仅保存凭据" onCancel={() => setConfirmSave(false)}
              onConfirm={() => { void save() }} />
            <XDriveConfirmDialog open={confirmClear} loading={busy}
              title="清除服务器保存的 AliDNS 凭据"
              description="删除此加密配置并审计；无法据此证明或清除宿主机正在使用的任何凭据。"
              confirmLabel="仅清除已保存配置" onCancel={() => setConfirmClear(false)}
              onConfirm={() => { void save(true) }} />
          </>
        ) : (
          loading ? <Typography variant="body2" color="text.secondary">正在读取 AliDNS 凭据状态…</Typography>
          : source.loadCaddyAliDNSConfig ? (
            <Stack spacing={1} data-xdrive-caddy-alidns-read-failed>
              <Typography variant="body2" color="text.secondary">
                未能读取凭据状态；为避免误操作，暂时禁止保存、清除和显示凭据。这不等于缺少加密密钥。
              </Typography>
              <Button size="small" variant="outlined" disabled={busy}
                onClick={() => setRetryReadID((value) => value + 1)}>重试读取 AliDNS 配置</Button>
            </Stack>
          ) : <Typography variant="body2" color="text.secondary">
              此客户端尚未提供 AliDNS 管理接口，请更新匹配的客户端与 Server/Agent 版本。
            </Typography>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
    </Paper>
  )
}
