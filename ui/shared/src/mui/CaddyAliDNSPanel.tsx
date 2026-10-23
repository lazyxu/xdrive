import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Paper, Stack, Typography } from '@mui/material'
import { XDriveSensitiveField } from './SensitiveField'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { xDriveCaddyReadFailureMessage } from '../caddy-read-error'
import type { XDriveCaddyAliDNSConfig, XDriveCaddyAliDNSUpdate, XDriveCaddyAliDNSReveal } from '../service-dependencies'

export type XDriveCaddyAliDNSPort = {
  loadCaddyAliDNSConfig?: () => Promise<XDriveCaddyAliDNSConfig>
  saveCaddyAliDNS?: (input: XDriveCaddyAliDNSUpdate) => Promise<XDriveCaddyAliDNSConfig>
  revealCaddyAliDNS?: (revision: number) => Promise<XDriveCaddyAliDNSReveal>
}
export type XDriveCaddyAliDNSAtomicDraft = {
  host_env_sha256?: string
  source: XDriveCaddyAliDNSPort
  revision: number
  action: 'keep' | 'replace' | 'clear'
  access_key_id: string
  access_key_secret: string
  valid: boolean
  ready: boolean
  host_pending: boolean
}

function validSecret(value: string, min: number, max: number) {
  return value.length >= min && value.length <= max && /^[\x21-\x7e]+$/.test(value)
}

// Global credentials are staged only. This panel never controls Caddy or DNS.
export function XDriveCaddyAliDNSPanel({
  source, refreshID, onConfigurationChanged, onDirtyChange, active = true,
  atomicMode = false, atomicSaving = false, onAtomicDraft,
}: {
  source: XDriveCaddyAliDNSPort
  refreshID: number
  onConfigurationChanged?: () => void
  onDirtyChange?: (dirty: boolean) => void
  active?: boolean // Hide temporary plaintext when Caddy config tab is no longer visible.
  atomicMode?: boolean
  atomicSaving?: boolean // The parent single Save owns the form during submission.
  onAtomicDraft?: (draft: XDriveCaddyAliDNSAtomicDraft | null) => void
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
  const [pendingClear, setPendingClear] = useState(false)
  const [shown, setShown] = useState<XDriveCaddyAliDNSReveal | null>(null)
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
    setPendingClear(false)
    setShown(null)
    setRevealing(false)
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

  // Fields rotate independently. The Go transaction preserves the encrypted
  // counterpart without reading it back into the browser.
  const valid = !!(keyID || keySecret) &&
    (keyID ? validSecret(keyID, 8, 128) : !!config?.configured) &&
    (keySecret ? validSecret(keySecret, 8, 256) : !!config?.configured)
  const canEdit = !!config?.editable && !busy && !loading && !revealing && !atomicSaving

  const save = async (clear = false) => {
    if (!config || !config.editable || !source.saveCaddyAliDNS || busy || atomicSaving || (!clear && !valid) || (clear && !config.configured)) return
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
        ? 'AliDNS 凭据已清除。'
        : 'AliDNS 凭据已加密保存。')
      onConfigurationChanged?.() // A rotated or cleared key invalidates old proof.
    } catch (err) {
      if (epoch === requestEpochRef.current) setError('AliDNS 保存结果未得到确认；请重新核对修订后再提交。')
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false)
    }
  }

  const reveal = async () => {
    if (!config?.configured || !source.revealCaddyAliDNS || revealing || busy || atomicSaving) return
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
      if (epoch === revealEpochRef.current) setError('AliDNS 凭据读取失败或当前修订已失效。')
    } finally {
      if (epoch === revealEpochRef.current) setRevealing(false)
    }
  }

  const action = pendingClear ? 'clear' : keyID || keySecret ? 'replace' : 'keep'
  useEffect(() => { onDirtyChange?.(action !== 'keep') }, [onDirtyChange, action])
  useEffect(() => {
    onAtomicDraft?.(config ? {
      source, revision: config.revision, host_env_sha256: config.host_env_sha256, action,
      access_key_id: action === 'replace' ? keyID : '',
      access_key_secret: action === 'replace' ? keySecret : '',
      valid: action === 'keep' || (canEdit && (action === 'clear' ? config.configured : valid)),
      ready: !loading && !busy && !revealing,
      host_pending: config.host_apply_pending === true,
    } : null)
  }, [onAtomicDraft, source, config, action, keyID, keySecret, valid,
    canEdit, loading, busy, revealing])

  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 2 }}
      data-xdrive-admin-caddy-alidns>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2" fontWeight={700}>AliDNS DNS-01 凭据</Typography>
        {config ? (
          <>
            {config.host_apply_pending && <Typography variant="caption" color="text.secondary"
              data-xdrive-caddy-alidns-host-pending>
              Host 申请处理中，凭据暂不能编辑。
            </Typography>}
            {!config.editable && !config.host_apply_pending && <Typography variant="caption"
              color="text.secondary" data-xdrive-caddy-alidns-no-keyring>
              凭据加密服务未就绪，当前不可编辑。
            </Typography>}
            <XDriveSensitiveField label="AccessKey ID" value={keyID}
              configured={config.configured}
              revealedValue={active ? shown?.access_key_id : undefined}
              onReveal={() => { void reveal() }} onHide={hide}
              revealLoading={revealing} revealDisabled={!config.configured || !source.revealCaddyAliDNS || atomicSaving}
              disabled={!canEdit} maxLength={128}
              onChange={(value) => { setPendingClear(false); setKeyID(value) }} />
            <XDriveSensitiveField label="AccessKey Secret" value={keySecret}
              configured={config.configured}
              revealedValue={active ? shown?.access_key_secret : undefined}
              onReveal={() => { void reveal() }} onHide={hide}
              revealLoading={revealing} revealDisabled={!config.configured || !source.revealCaddyAliDNS || atomicSaving}
              disabled={!canEdit} maxLength={256}
              onChange={(value) => { setPendingClear(false); setKeySecret(value) }} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {!atomicMode && <Button size="small" variant="outlined" disabled={!canEdit || !valid || !source.saveCaddyAliDNS}
                onClick={() => setConfirmSave(true)}>保存凭据</Button>}
              <Button size="small" color="error" variant="text"
                disabled={!canEdit || !config.configured || (!atomicMode && !source.saveCaddyAliDNS) || pendingClear}
                onClick={() => setConfirmClear(true)}>清除凭据</Button>
              {atomicMode && pendingClear && <Button size="small" variant="text"
                onClick={() => setPendingClear(false)}>撤销清除</Button>}
            </Stack>
            {!atomicMode && <XDriveConfirmDialog open={confirmSave} loading={busy}
              title="加密保存 AliDNS 凭据"
              description="保存新 ID/Secret 将创建审计修订，但不替换宿主机凭据，也不会操作 Caddy。"
              confirmLabel="仅保存凭据" onCancel={() => setConfirmSave(false)}
              onConfirm={() => { void save() }} />}
            <XDriveConfirmDialog open={confirmClear} loading={busy}
              title={config.source === 'host-env' ? '清除宿主机 AliDNS 凭据' : '清除服务器保存的 AliDNS 凭据'}
              description={atomicMode
                ? config.source === 'host-env'
                  ? '只加入待保存草稿。点击「保存配置」后清除宿主机 .env 中的 AliDNS ID 和 Secret；仍需单独重新部署 Caddy。'
                  : '只加入待保存草稿。下方统一「保存配置」后才会删除数据库里的密文；不会修改 Caddy 或宿主机。'
                : '删除此加密配置并审计；无法据此证明或清除宿主机正在使用的任何凭据。'}
              confirmLabel={atomicMode ? '加入清除草稿' : '仅清除已保存配置'}
              onCancel={() => setConfirmClear(false)}
              onConfirm={() => {
                if (atomicMode) {
                  setConfirmClear(false)
                  setPendingClear(true)
                  setKeyID('')
                  setKeySecret('')
                  hide()
                } else void save(true)
              }} />
          </>
        ) : (
          loading ? <Typography variant="body2" color="text.secondary">正在读取 AliDNS 凭据状态…</Typography>
          : source.loadCaddyAliDNSConfig ? (
            <Stack spacing={1} data-xdrive-caddy-alidns-read-failed>
              <Typography variant="body2" color="text.secondary">
                未能读取凭据状态；为避免误操作，暂时禁止保存、清除和显示凭据。这不等于缺少加密密钥。
              </Typography>
              <Button size="small" variant="outlined" disabled={busy || atomicSaving}
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
