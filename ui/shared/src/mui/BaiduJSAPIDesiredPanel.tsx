import { useEffect, useRef, useState } from 'react'
import { Box, Button, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material'
import {
  xDriveValidBaiduJSAPI4LoaderProbe,
  type XDriveBaiduJSAPI4LoaderProbe,
  type XDriveBaiduJSAPIConfig,
  type XDriveBaiduJSAPIUpdate,
} from '../service-dependencies'
import { XDriveConfirmDialog } from './ConfirmDialog'
import { XDriveStatusAlert } from './StatusAlert'
import { XDriveBaiduJSAPIConfigSnapshot } from './BaiduJSAPIConfigSnapshot'
import {
  xDriveBaiduMapDiagnosticDetails, xDriveReadBaiduMapDiagnostic,
  xDriveSubscribeBaiduMapDiagnostics, XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS,
} from '../media-gallery-baidu-diagnostics'
import type { XDriveBaiduMapDiagnostic } from '../media-gallery-baidu-diagnostics'

type ReleaseBlocker = NonNullable<XDriveBaiduJSAPIConfig['release_blockers']>[number]
const releaseBlockerLabels: Record<ReleaseBlocker, string> = {
  browser_ak_not_configured: '还没有安全保存独立的 Browser AK',
  desired_disabled: '管理员期望开关未开启',
  encryption_keyring_unavailable: 'Server 尚未配置凭据加密密钥环',
  trusted_https_origin_invalid: 'Server 的 HTTPS Origin 尚未配置正确',
  instance_signing_identity_unavailable: '自动托管的实例签名密钥尚未准备好',
  child_resource_inventory_not_reviewed: '尚无完整、逐项审核的地图子资源白名单',
  signed_release_not_installed: '尚未安装当前有效的 Server 受信签名发布',
}
const releaseBlockerHints: Record<ReleaseBlocker, string> = {
  browser_ak_not_configured: '在「配置与修改」保存独立的 Browser 类型 AK；不要填写 Server 静态地图 AK。',
  desired_disabled: '在「配置与修改」开启 JSAPI 4.0 并保存后重新读取 Server 发布状态。',
  encryption_keyring_unavailable: '检查 Server 凭据加密密钥环的部署状态和实例重启要求；不应在浏览器打印密钥。',
  trusted_https_origin_invalid: '检查 Server 当前可信 HTTPS Origin、Caddy Host 与实际站点入口是否一致。',
  instance_signing_identity_unavailable: '检查 Server 实例签名身份的配置与初始化状态。',
  child_resource_inventory_not_reviewed: '完成固定百度 JSAPI4 子资源清单审查和白名单发布；不能放宽成任意代理。',
  signed_release_not_installed: '检查当前 Server 的签名 Release 修订及激活状态；旧构建/错误修订不能强行开启运行态。',
}
const releaseBlockerIDs = Object.keys(releaseBlockerLabels)

export type XDriveBaiduJSAPIDesiredPort = {
  loadBaiduJSAPIConfig?: () => Promise<XDriveBaiduJSAPIConfig>
  saveBaiduJSAPIConfig?: (input: XDriveBaiduJSAPIUpdate) => Promise<XDriveBaiduJSAPIConfig>
  verifyBaiduJSAPI4Loader?: (revision: number) => Promise<XDriveBaiduJSAPI4LoaderProbe>
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
  source, mode, onDirtyChange, diagnosticScope,
}: {
  source: XDriveBaiduJSAPIDesiredPort
  mode: 'config' | 'verify'
  onDirtyChange?: (dirty: boolean) => void
  diagnosticScope?: string
}) {
  const [config, setConfig] = useState<XDriveBaiduJSAPIConfig | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [newAK, setNewAK] = useState('')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastReadAt, setLastReadAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeResult, setProbeResult] = useState<XDriveBaiduJSAPI4LoaderProbe | null>(null)
  const [probeError, setProbeError] = useState('')
  const generation = useRef(0)
  const [diagnosticState, setDiagnosticState] = useState<{
    scope: string; item: XDriveBaiduMapDiagnostic | null
  }>({ scope: diagnosticScope ?? '', item: null })
  useEffect(() => {
    const scope = diagnosticScope ?? ''
    const refresh = () => setDiagnosticState({
      scope, item: xDriveReadBaiduMapDiagnostic(scope),
    })
    refresh()
    const unsubscribe = xDriveSubscribeBaiduMapDiagnostics(refresh)
    // A suspended Safari/PWA tab may delay the 15-minute timer. Re-read
    // current account's in-memory record when the tab resumes, without HTTP.
    // The real UI has a Window/Document; source-mounted React tests may not.
    // Read-only resume checks must never turn into production network probes.
    const browserWindow = typeof window === 'undefined' ? null : window
    const browserDocument = typeof document === 'undefined' ? null : document
    browserWindow?.addEventListener('focus', refresh)
    browserDocument?.addEventListener('visibilitychange', refresh)
    return () => {
      unsubscribe()
      browserWindow?.removeEventListener('focus', refresh)
      browserDocument?.removeEventListener('visibilitychange', refresh)
    }
  }, [diagnosticScope])
  const latestDiagnostic = diagnosticState.scope === (diagnosticScope ?? '')
    ? diagnosticState.item : xDriveReadBaiduMapDiagnostic(diagnosticScope ?? '')
  // A permanently mounted Admin page must not continue showing a diagnostic
  // after the promise of "recent 15 minutes" has expired.
  useEffect(() => {
    if (!latestDiagnostic) return
    const scope = diagnosticScope ?? ''
    const remaining = XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS -
      (Date.now() - latestDiagnostic.recordedAt)
    const timer = window.setTimeout(() => setDiagnosticState({
      scope, item: xDriveReadBaiduMapDiagnostic(scope),
    }), Math.max(1, remaining + 2))
    return () => window.clearTimeout(timer)
  }, [diagnosticScope, latestDiagnostic?.recordedAt])
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
    setProbeBusy(false)
    setProbeResult(null)
    setProbeError('')
    setReading(true)
    setLastReadAt(null)
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
      setLastReadAt(new Date().toISOString())
    }).catch(() => {
      if (revision === generation.current) setError('读取 Browser AK 配置失败，请检查 Server/Agent 权限与版本。')
    }).finally(() => {
      if (revision === generation.current) setReading(false)
    })
    return () => { ++generation.current }
  }, [source])

  // Read the Server's current saved state; never fabricate or edit release authority.
  // Preserve unsaved Browser AK and toggle drafts rather than silently discarding them.
  const refreshConfig = async () => {
    if (busy || refreshing || dirty || !source.loadBaiduJSAPIConfig) return
    const revision = generation.current
    setRefreshing(true)
    setError('')
    setNotice('')
    try {
      const value = await source.loadBaiduJSAPIConfig()
      if (revision !== generation.current) return
      if (!validConfig(value)) throw new Error('invalid_config')
      setConfig(value)
      setEnabled(value.desired_enabled)
      setLastReadAt(new Date().toISOString())
    } catch {
      if (revision === generation.current) setError('刷新生效状态失败；当前显示上次成功读取的 Server 状态。')
    } finally {
      if (revision === generation.current) setRefreshing(false)
    }
  }

  const apply = async (clearAK = false) => {
    if (busy || refreshing || !config?.editable || !source.saveBaiduJSAPIConfig) return
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
      setLastReadAt(new Date().toISOString())
      setNewAK('')
      setProbeResult(null)
      setProbeError('')
      setNotice(result.runtime_enabled
        ? '当前 Server 已完成签名授权并启用动态地图。请打开图库的「地点 → 地图」验证平移、缩放、聚合及 Viewer；真实三端和资源安全仍需验收。'
        : result.desired_enabled
          ? '启用设置已保存，但当前 Server 尚未授权运行。请切换「检测与生效证据」查看准确的阻断原因。'
          : 'JSAPI 4.0 已停用，原有百度静态地图仍可使用。')
    } catch {
      if (revision === generation.current) setError('保存失败；如其他管理员已修改修订，请重新打开此页面再试。')
    } finally {
      if (revision === generation.current) {
        setBusy(false)
        setConfirmClear(false)
      }
    }
  }

  const verifyLoader = async () => {
    if (!source.verifyBaiduJSAPI4Loader || !config?.configured || !config.desired_enabled ||
        config.revision <= 0 || probeBusy || busy) return
    const revision = generation.current
    const expected = config.revision
    setProbeBusy(true)
    setProbeResult(null)
    setProbeError('')
    try {
      const result = await source.verifyBaiduJSAPI4Loader(expected)
      if (revision !== generation.current) return
      if (!xDriveValidBaiduJSAPI4LoaderProbe(result, expected)) throw new Error('invalid_probe')
      setProbeResult(result)
    } catch {
      if (revision === generation.current) {
        setProbeError('真实 Loader 检测失败、暂不可用或触发 30 秒冷却。请检查当前 Server 和审计日志后重试。')
      }
    } finally {
      if (revision === generation.current) setProbeBusy(false)
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
            动态地图专用 AK。修改期望开关或密钥后由 Server 独立核验发布授权。
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            以下只读状态来自当前 Server；在线 Loader 检测需要管理员主动执行。
          </Typography>
        )}
        {reading ? <Box sx={{ minHeight: 32 }} aria-busy="true" /> : null}
        {config && mode === 'verify' && (
          <Typography variant="body2" role="status"
            color={verified ? 'success.main' : 'warning.main'}
            data-xdrive-baidu-jsapi4-release-state>
            {verified ? 'Server 已签名授权动态地图' : '动态地图尚未获得 Server 签名放行'}
          </Typography>
        )}
        {mode === 'verify' && (
          <Box component="section" data-xdrive-baidu-map-diagnostic
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5,
              p: { xs: 1.25, sm: 1.5 }, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700}>动态照片地图 · 具体故障诊断</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
              Server 发布原因以当前管理员只读状态为准；下方只显示本客户端最近 15 分钟的
              匿名故障阶段。其他浏览器或 Desktop 独立 HTTPS 窗口不会共享记录。
            </Typography>
            {latestDiagnostic ? (
              <Stack spacing={0.5} sx={{ mt: 1 }} data-xdrive-baidu-client-diagnostic>
                <Typography variant="body2" fontWeight={600}>
                  {xDriveBaiduMapDiagnosticDetails[latestDiagnostic.code].title}
                </Typography>
                <Typography variant="caption" color="text.secondary"
                  sx={{ overflowWrap: 'anywhere' }}>
                  错误码：{latestDiagnostic.code}
                  {' · '}时间：{new Date(latestDiagnostic.recordedAt).toLocaleString('zh-CN')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  建议：{xDriveBaiduMapDiagnosticDetails[latestDiagnostic.code].action}
                </Typography>
                <Typography variant="caption" color="text.secondary"
                  data-xdrive-baidu-runtime-evidence-boundary>
                  这是一条实际客户端运行阶段的匿名记录。Server AK 的静态 PNG、
                  Server 签名发布和固定 Loader 校验属于不同前置条件；
                  它们成功也不能覆盖此项浏览器 SDK 失败。
                </Typography>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary"
                data-xdrive-baidu-no-client-error sx={{ mt: 1 }}>
                本客户端会话暂无可归因的动态地图故障记录；这不代表动态 SDK、瓦片或三端交互已验证。
                可先在图库重试，再返回此处查看具体失败阶段。
              </Typography>
            )}
          </Box>
        )}
        {config && mode === 'verify' && (
          <XDriveBaiduJSAPIConfigSnapshot config={config} lastReadAt={lastReadAt}
            refreshing={refreshing} canRefresh={Boolean(source.loadBaiduJSAPIConfig) && !busy && !dirty}
            dirty={dirty} onRefresh={() => { void refreshConfig() }} />
        )}
        {config && mode === 'config' ? (
          <Typography variant="caption" color="text.secondary"
            data-xdrive-baidu-jsapi4-status>
            {config.configured ? 'Browser AK 已安全保存' : 'Browser AK 尚未配置'}
            {' · '}修订 #{config.revision} · {config.requires_restart ? '需重启生效' : '保存即时生效'}
          </Typography>
        ) : null}
        {mode === 'config' && config?.editable && (
          <>
            <FormControlLabel label="启用 JSAPI 4.0（经 Server 签名授权后生效）"
              control={<Switch checked={enabled} onChange={(_event, value) => setEnabled(value)}
                disabled={busy || refreshing} />} />
            <TextField fullWidth size="small" type="password" autoComplete="new-password"
              label="设置或更换 Browser AK" inputProps={{ maxLength: 256 }}
              placeholder={config.configured ? '留空保留当前 Browser AK' : '请输入独立的 Browser 类型 AK'}
              helperText="仅提交新密钥；不会显示、回填或输出已保存的 Browser AK。"
              value={newAK} disabled={busy || refreshing} onChange={event => setNewAK(event.target.value)} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button size="small" variant="contained" disabled={busy || refreshing}
                onClick={() => { void apply(false) }}>保存并应用</Button>
              <Button size="small" color="error" variant="outlined"
                disabled={busy || refreshing || !config.configured}
                onClick={() => setConfirmClear(true)}>清除 Browser AK</Button>
            </Stack>
          </>
        )}
        {mode === 'verify' && (
          <>
            {config && (
              <Stack spacing={1} data-xdrive-baidu-jsapi4-live-probe>
                <Button size="small" variant="outlined" disabled={probeBusy || busy ||
                  !source.verifyBaiduJSAPI4Loader || !config.configured ||
                  !config.desired_enabled || config.revision <= 0}
                  onClick={() => { void verifyLoader() }}>
                  {probeBusy ? '正在检测真实 Loader…' : '检测真实百度 JSAPI 4.0 Loader'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  手动验证固定 Loader（可能消耗配额）；不会运行地图脚本，也不代表瓦片或三端交互通过。
                  {config.configured && !config.desired_enabled ?
                    ' 当前期望开关未开启，请先在配置页启用并保存。' : ''}
                </Typography>
                {probeResult && (
                  <XDriveStatusAlert tone={probeResult.loader_accepted ? 'good' : 'bad'}>
                    {probeResult.state === 'loader_accepted'
                      ? 'Loader 响应校验通过；动态子资源与三端交互仍需验证。'
                      : probeResult.state === 'denied'
                        ? '百度拒绝了 Loader 请求，请检查所配置权限和域名限制。'
                        : 'Loader 本次不可用，请查看 Server 网络与审计状态。'}
                    {' · '}检测时间：{probeResult.checked_at}
                  </XDriveStatusAlert>
                )}
                {probeError && <XDriveStatusAlert tone="bad">{probeError}</XDriveStatusAlert>}
              </Stack>
            )}
            {!verified && config && (
              <Box data-xdrive-baidu-jsapi4-release-blockers>
                <Typography variant="subtitle2">当前 Server 未生效的原因</Typography>
                {config.release_blockers?.length ? (
                  <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                    {config.release_blockers.map(reason => (
                      <Box key={reason} component="li" data-xdrive-baidu-release-blocker={reason}>
                        <Typography variant="body2" fontWeight={600}>
                          {releaseBlockerLabels[reason]}
                        </Typography>
                        <Typography variant="caption" color="text.secondary"
                          sx={{ overflowWrap: 'anywhere' }}>
                          {reason} · 处理：{releaseBlockerHints[reason]}
                        </Typography>
                      </Box>
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
