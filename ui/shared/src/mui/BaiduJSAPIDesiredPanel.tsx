import { useEffect, useRef, useState } from 'react'
import { Box, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import type { XDriveBaiduJSAPIConfig, XDriveBaiduJSAPIUpdate } from '../service-dependencies'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'

type ReleaseBlocker = NonNullable<XDriveBaiduJSAPIConfig['release_blockers']>[number]
const releaseBlockerLabels: Record<ReleaseBlocker, string> = {
  browser_ak_not_configured: '还没有安全保存独立的 Browser AK',
  desired_disabled: '管理员期望开关未开启',
  encryption_keyring_unavailable: 'Server 尚未配置凭据加密密钥环',
  trusted_https_origin_invalid: 'Server 的 HTTPS Origin 尚未配置正确',
  operator_signing_root_not_pinned: '当前构建未固定生产签名公钥',
  child_resource_inventory_not_reviewed: '尚无完整、逐项审核的地图子资源白名单',
  signed_release_not_installed: '尚未安装当前有效的 Server 受信签名发布',
}
const releaseBlockerIDs = Object.keys(releaseBlockerLabels)

export type XDriveBaiduJSAPIDesiredPort = {
  loadBaiduJSAPIConfig?: () => Promise<XDriveBaiduJSAPIConfig>
  saveBaiduJSAPIConfig?: (input: XDriveBaiduJSAPIUpdate) => Promise<XDriveBaiduJSAPIConfig>
}

function validConfig(value: unknown): value is XDriveBaiduJSAPIConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Partial<XDriveBaiduJSAPIConfig>
  return v.provider === 'baidu-jsapi-4.0' &&
    typeof v.desired_enabled === 'boolean' && typeof v.configured === 'boolean' &&
    typeof v.editable === 'boolean' && typeof v.runtime_enabled === 'boolean' &&
    typeof v.requires_restart === 'boolean' &&
    typeof v.revision === 'number' && Number.isSafeInteger(v.revision) && v.revision >= 0 &&
    ['blocked_pending_licence_and_proxy', 'authorized_signed_release'].includes(String(v.activation_state)) &&
    v.runtime_enabled === (v.activation_state === 'authorized_signed_release') &&
    (v.release_blockers === undefined ||
      (Array.isArray(v.release_blockers) && v.release_blockers.length <= 7 &&
        v.release_blockers.every(reason =>
          typeof reason === 'string' && releaseBlockerIDs.includes(reason)) &&
        new Set(v.release_blockers).size === v.release_blockers.length &&
        (!v.runtime_enabled || v.release_blockers.length === 0)))
}

/** ONE shared admin UI across Web, Mobile Web/PWA and Desktop.
 * It never requests an existing Browser AK or treats a desired flag as signed
 * production authorization. No map script is loaded from this panel. */
export function XDriveBaiduJSAPIDesiredPanel({
  source, mode, onDirtyChange,
}: {
  source: XDriveBaiduJSAPIDesiredPort
  mode: 'config' | 'verify'
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [config, setConfig] = useState<XDriveBaiduJSAPIConfig | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [newAK, setNewAK] = useState('')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const generation = useRef(0)
  const dirty = Boolean(config && (config.desired_enabled !== enabled || newAK !== ''))

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    const revision = ++generation.current
    setConfig(null)
    setEnabled(false)
    setNewAK('')
    setError('')
    setNotice('')
    setBusy(false)
    setConfirmClear(false)
    setReading(true)
    if (!source.loadBaiduJSAPIConfig) {
      setReading(false)
      setError('当前 Server/Agent 不支持 Browser AK 管理，请升级到支持 JSAPI 4.0 的版本。')
      return () => { ++generation.current }
    }
    void source.loadBaiduJSAPIConfig().then(value => {
      if (revision !== generation.current) return
      if (!validConfig(value)) throw new Error('invalid_config')
      setConfig(value)
      setEnabled(value.desired_enabled)
    }).catch(() => {
      if (revision === generation.current) setError('读取 Browser AK 配置失败，请检查 Server/Agent 权限与版本。')
    }).finally(() => {
      if (revision === generation.current) setReading(false)
    })
    return () => { ++generation.current }
  }, [source])

  const apply = async (clearAK = false) => {
    if (busy || !config?.editable || !source.saveBaiduJSAPIConfig) return
    const key = newAK.trim()
    if (!clearAK && enabled && !config.configured && key === '') {
      setError('启用 Browser AK 的期望配置前，必须输入独立的 Browser 类型 AK。')
      return
    }
    if (key !== '' && (key.length > 256 || !/^[!-~]+$/.test(key))) {
      setError('Browser AK 只能包含不超过 256 个可见 ASCII 字符。')
      return
    }
    const revision = generation.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await source.saveBaiduJSAPIConfig({
        desired_enabled: clearAK ? false : enabled,
        revision: config.revision,
        ...(clearAK ? { clear_ak: true } : key ? { browser_ak: key } : {}),
      })
      if (revision !== generation.current) return
      if (!validConfig(result) || result.revision <= config.revision) throw new Error('invalid_revision')
      setConfig(result)
      setEnabled(result.desired_enabled)
      setNewAK('')
      setNotice('Browser AK 期望配置已加密保存。动态 JSAPI 4.0 仍须通过独立签名发布、资源清单和真实三端验收才会生效。')
    } catch {
      if (revision === generation.current) setError('保存失败；如其他管理员已修改修订，请重新打开此页面再试。')
    } finally {
      if (revision === generation.current) {
        setBusy(false)
        setConfirmClear(false)
      }
    }
  }

  const verified = config?.runtime_enabled === true && config.activation_state === 'authorized_signed_release'
  return (
    <Paper variant="outlined" data-xdrive-baidu-jsapi4-admin
      sx={{ mt: 1.5, borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2" fontWeight={700}>
          {mode === 'config' ? '百度 JSAPI 4.0 · Browser AK' : '动态地图 · Server 发布授权'}
        </Typography>
        {mode === 'config' ? (
          <Typography variant="body2" color="text.secondary">
            独立于静态地图 Server AK。此处仅加密保存 Browser AK 和期望开关，
            保存后立即更新期望修订，不等于动态地图获准运行。
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            此处检查当前 Server 对真实 JSAPI 4.0 的发布授权，和上方静态地图在线检测完全独立。
            Browser AK 和 HTTPS 即使已配置，也不能替代已审核资源清单和有效签名发布。
          </Typography>
        )}
        {reading ? <Box sx={{ minHeight: 32 }} aria-busy="true" /> : null}
        {config && mode === 'config' ? (
          <Typography variant="caption" color={verified ? 'success.main' : 'text.secondary'}
            data-xdrive-baidu-jsapi4-status>
            {config.configured ? 'Browser AK 已加密配置' : '未配置 Browser AK'}
            {' · '}期望{config.desired_enabled ? '启用' : '停用'}
            {' · '}运行{verified ? '已通过受信签名放行' : '未授权放行'}
            {' · '}修订 #{config.revision}
            {' · '}{config.requires_restart ? '配置需重启' : '保存设置无需重启'}
          </Typography>
        ) : null}
        {mode === 'config' && config?.editable && (
          <>
            <FormControlLabel label="期望启用 JSAPI 4.0（不等于运行授权）"
              control={<Switch checked={enabled} onChange={(_event, value) => setEnabled(value)}
                disabled={busy} />} />
            <TextField fullWidth size="small" type="password" autoComplete="new-password"
              label="设置或更换 Browser AK" inputProps={{ maxLength: 256 }}
              placeholder={config.configured ? '留空保留当前 Browser AK' : '请输入独立的 Browser 类型 AK'}
              helperText="仅提交新密钥；不会显示、回填或输出已保存的 Browser AK。"
              value={newAK} disabled={busy} onChange={event => setNewAK(event.target.value)} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button size="small" variant="contained" disabled={busy}
                onClick={() => { void apply(false) }}>保存期望配置</Button>
              <Button size="small" color="error" variant="outlined"
                disabled={busy || !config.configured}
                onClick={() => setConfirmClear(true)}>清除 Browser AK</Button>
            </Stack>
          </>
        )}
        {mode === 'verify' && (
          <>
            {config && (
              <Typography variant="caption" color="text.secondary"
                data-xdrive-baidu-jsapi4-release-state>
                当前运行：{verified ? 'Server 已授权动态地图' : 'Server 尚未放行动态地图'}
                {' · '}Browser AK {config.configured ? '已保存' : '未配置'}
                {' · '}期望{config.desired_enabled ? '开启' : '关闭'}
              </Typography>
            )}
            {verified ? (
              <XDriveStatusAlert tone="good">当前 Server 返回已签名放行；仍须以真实三端地图交互和资源审计作为验收依据。</XDriveStatusAlert>
            ) : (
              <XDriveStatusAlert tone="bad">动态地图仍受 Server 安全门禁限制；现有百度静态地图可继续使用。</XDriveStatusAlert>
            )}
            {!verified && config && (
              <Box data-xdrive-baidu-jsapi4-release-blockers>
                <Typography variant="subtitle2">当前 Server 未生效的原因</Typography>
                {config.release_blockers?.length ? (
                  <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                    {config.release_blockers.map(reason => (
                      <Typography key={reason} component="li" variant="body2"
                        color="text.secondary">{releaseBlockerLabels[reason]}</Typography>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary"
                    data-xdrive-baidu-jsapi4-missing-blocker-evidence>
                    Server 未返回详细阻断原因；请检查服务端版本和发布状态。
                    不需要再次填写已保存的 AK，也不能将缺少原因当作验证通过。
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  这是 Server 结构性门禁；真实百度子资源、许可、AK 防泄漏和三端真机仍需独立验收。
                  未放行时不会试探加载脚本，更不会仅凭配置开启动态地图。
                </Typography>
              </Box>
            )}
          </>
        )}
        {!config && !reading && !error && (
          <Typography variant="body2" color="text.secondary">暂无法读取当前管理员配置。</Typography>
        )}
        {config && !config.editable && mode === 'config' && (
          <Typography variant="body2" color="text.secondary">
            服务器未配置凭据加密密钥环，Browser AK 只能在完成 Server 密钥环部署后管理。
          </Typography>
        )}
        {error && <XDriveStatusAlert tone="bad">{error}</XDriveStatusAlert>}
        {notice && <XDriveStatusAlert tone="good">{notice}</XDriveStatusAlert>}
      </Stack>
      <XDriveConfirmDialog open={confirmClear} title="清除 Browser AK"
        description="该操作保存新的服务端修订并关闭 JSAPI 4.0 的期望开关；现有静态地图 Server AK 不会受到影响。"
        confirmIntent="danger" confirmLabel="确认清除 Browser AK" loading={busy}
        onCancel={() => setConfirmClear(false)} onConfirm={() => { void apply(true) }} />
    </Paper>
  )
}
