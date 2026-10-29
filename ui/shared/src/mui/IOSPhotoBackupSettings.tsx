import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, Stack, TextField, Typography } from '@mui/material'

/** Capabilities are supplied by the iOS WKWebView host, never simulated by Web. */
export interface XDriveIOSPhotoBackupSession {
  username: string
  ownerID: number
  accessToken: string // short-lived Web -> native, not persisted here
}
export type XDriveIOSPhotoPermission =
  'notDetermined' | 'authorized' | 'limited' | 'denied' | 'restricted'
export interface XDriveIOSPhotoStatus {
  authorization: XDriveIOSPhotoPermission
  totalVisible?: number
}
export interface XDriveIOSPhotoBackupProgress {
  totalVisible: number
  /** Absent on older IPA builds that only scan the first 256 items. */
  startOffset?: number
  scanned: number
  uploaded: number
  verifiedAlready: number
  liveNotSupported: number
  videosNotSupported: number
  unavailable: number
  needsReview: number
  isLimited: boolean
  stoppedForReview: boolean
  stage: string
}
export interface XDriveIOSPhotoBackgroundGrantStatus {
  enrolled: boolean
  enabled: boolean
  storedButUnverified: boolean
  revokePending: boolean
  serverVerified: boolean
  expiresAt: number // Unix milliseconds, zero when absent
  backgroundUploadReady: boolean
}

export interface XDriveIOSPhotoBackupHost {
  /** Negotiated with the real native host; false for older installed IPA. */
  scanWindowsSupported?: boolean
  nativeBackgroundGrantSupported?: boolean
  capabilities(): Promise<boolean>
  status(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus>
  requestAccess(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus>
  start(
    session: XDriveIOSPhotoBackupSession,
    allowICloudOriginals: boolean,
    onProgress: (progress: XDriveIOSPhotoBackupProgress) => void,
    windowIndex?: number,
  ): Promise<XDriveIOSPhotoBackupProgress>
  /** Only a true native iOS Host may expose an Owner-scoped grant status.
   * No long-lived secret may ever cross this interface into JavaScript. */
  backgroundGrantStatus?(session: XDriveIOSPhotoBackupSession):
    Promise<XDriveIOSPhotoBackgroundGrantStatus>
  configureBackgroundGrant?(session: XDriveIOSPhotoBackupSession, enabled: boolean):
    Promise<XDriveIOSPhotoBackgroundGrantStatus>
  cancel(): Promise<void>
  switchServer(): Promise<void>
}

/** Shared React/MUI Settings surface, not an independent SwiftUI Photos page.
 * No permission prompt, scan, or upload runs on mount or during login. */
export function XDriveIOSPhotoBackupSettings({
  host, session,
}: {
  host: XDriveIOSPhotoBackupHost
  session: XDriveIOSPhotoBackupSession | null
}) {
  const [available, setAvailable] = useState(false)
  const [status, setStatus] = useState<XDriveIOSPhotoStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [allowCloud, setAllowCloud] = useState(false)
  // This is a transient 1-based selection, NOT a persisted PhotoKit identity.
  const [windowIndexText, setWindowIndexText] = useState('1')
  const [progress, setProgress] = useState<XDriveIOSPhotoBackupProgress | null>(null)
  const [bgGrant, setBGGrant] = useState<XDriveIOSPhotoBackgroundGrantStatus | null>(null)
  const [bgGrantBusy, setBGGrantBusy] = useState(false)
  const [bgGrantError, setBGGrantError] = useState('')
  const activeRun = useRef(false)

  // Changing authenticated Owner or closing Settings cancels the current
  // foreground job. Token rotation for the same Owner does not reset the view.
  useEffect(() => {
    let mounted = true
    setAvailable(false)
    setStatus(null)
    setError('')
    setWindowIndexText('1')
    setProgress(null)
    setBGGrant(null)
    setBGGrantError('')
    if (session) {
      void host.capabilities().then(async supported => {
        if (!mounted || !supported) return
        setAvailable(true)
        const current = await host.status(session)
        if (mounted) setStatus(current)
        // This probes a real scoped native/Server grant only. A regular
        // PWA/Desktop/DSM must not show or emulate background credentials.
        if (host.nativeBackgroundGrantSupported && host.backgroundGrantStatus) {
          try {
            const result = await host.backgroundGrantStatus(session)
            if (mounted) setBGGrant(result)
          } catch {
            if (mounted) setBGGrantError(
              '后台受限授权无法验证；不会据此启动自动上传。')
          }
        }
      }).catch(() => {
        if (mounted) {
          setAvailable(true)
          setError('无法连接到 iOS 原生相册能力，请检查当前账户和服务器。')
        }
      })
    }
    return () => {
      mounted = false
      if (activeRun.current) void host.cancel().catch(() => {})
    }
    // Each explicit action uses the current session prop, never stale tokens.
  }, [host, session?.username, session?.ownerID])

  if (!session || !available) return null
  const permitted = status?.authorization === 'authorized' || status?.authorization === 'limited'
  const scanWindows = host.scanWindowsSupported === true
  const visibleCount = Math.max(0, status?.totalVisible ?? 0)
  const windowCount = Math.max(1, Math.ceil(visibleCount / 256))
  const windowNumber = Number(windowIndexText)
  const validWindow = /^[1-9]\d*$/.test(windowIndexText) &&
    Number.isSafeInteger(windowNumber) && windowNumber <= windowCount
  // A starting progress event has no fresh count yet. Never reset the selected
  // older segment to the newest segment while the snapshot is being acquired.
  const progressCount = progress?.stage === '检查当前授权相册…' && progress.totalVisible === 0
    ? visibleCount : progress?.totalVisible ?? visibleCount
  const progressOffset = progress?.startOffset ?? 0
  const windowCapacity = Math.max(0, Math.min(256, progressCount - progressOffset))
  const total = Math.max(1, windowCapacity)
  const loaded = Math.min(progress?.scanned ?? 0, total)

  const requestAccess = async () => {
    if (busy || running) return
    setBusy(true)
    setError('')
    try {
      setStatus(await host.requestAccess(session))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法取得系统相册授权。')
    } finally { setBusy(false) }
  }

  const start = async () => {
    if (!permitted || busy || running || (scanWindows && !validWindow)) return
    setBusy(true)
    setRunning(true)
    activeRun.current = true
    setCancelRequested(false)
    setProgress(null)
    setError('')
    try {
      const report = await host.start(
        session, allowCloud, setProgress,
        scanWindows ? windowNumber - 1 : 0,
      )
      setProgress(report)
      // The authoritative PhotoKit count can shrink between selected windows.
      // Do not silently send an out-of-range selection back to window one.
      setStatus(current => current ? { ...current, totalVisible: report.totalVisible } : current)
      if (report.stoppedForReview || report.needsReview > 0) {
        setError('存在服务端提交结果待核对的文件；已停止新增上传，不会盲目重试。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '本轮原件备份未完成。')
    } finally {
      activeRun.current = false
      setRunning(false)
      setBusy(false)
      setCancelRequested(false)
    }
  }

  const configureBGGrant = async (enabled: boolean) => {
    if (busy || running || bgGrantBusy ||
        !host.nativeBackgroundGrantSupported ||
        !host.configureBackgroundGrant || (enabled && !permitted)) return
    setBGGrantBusy(true)
    setBGGrantError('')
    try {
      const result = await host.configureBackgroundGrant(session, enabled)
      setBGGrant(result)
    } catch (caught) {
      setBGGrantError(caught instanceof Error
        ? caught.message : '后台授权状态无法安全更新。')
      // A network error after local revocation must never make a disabled
      // grant appear newly active based on old UI state.
      if (host.backgroundGrantStatus) {
        try { setBGGrant(await host.backgroundGrantStatus(session)) }
        catch { setBGGrant(null) }
      }
    } finally {
      setBGGrantBusy(false)
    }
  }

  const cancel = async () => {
    setCancelRequested(true)
    try { await host.cancel() }
    catch { setError('取消请求未获得确认；请在服务器核对未完成的上传。') }
  }

  return (
    <Box data-xdrive-ios-photo-backup-settings>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        iPhone 系统相册备份
      </Typography>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          使用当前 xDrive 登录账户，将 iPhone 已授权的普通照片原件备份到云端文件。
          每轮只扫描选定分段最多 256 项，新增最多 20 张普通照片。
          选择较早的分段可检查更多已授权项目；Live Photo 和视频仍未完成原件备份。
        </Typography>
        {status ? (
          <Typography variant="body2" data-xdrive-ios-photos-permission>
            系统相册权限：{status.authorization === 'authorized' ? '全部照片'
              : status.authorization === 'limited' ? '仅允许的部分照片'
                : status.authorization === 'notDetermined' ? '尚未授权'
                  : '未允许读取'}
            {typeof status.totalVisible === 'number' ? ' · 当前可见 ' + status.totalVisible + ' 项' : ''}
          </Typography>
        ) : <Typography variant="body2" color="text.secondary">正在核实 iOS 相册状态…</Typography>}
        {status?.authorization === 'notDetermined' ? (
          <Button variant="outlined" disabled={busy} onClick={() => { void requestAccess() }}>
            允许访问系统相册
          </Button>
        ) : null}
        {status && !permitted && status.authorization !== 'notDetermined' ? (
          <Alert severity="info">请在 iOS「设置 → xDrive → 照片」中允许访问。不会自动请求或扩大权限。</Alert>
        ) : null}
        {permitted && scanWindows ? (
          <Stack spacing={1} data-xdrive-ios-photos-window>
            <Typography variant="body2" fontWeight={600}>相册扫描分段</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button variant="outlined" disabled={busy || !Number.isSafeInteger(windowNumber) || windowNumber <= 1}
                onClick={() => setWindowIndexText(String(windowNumber - 1))}>
                上一段
              </Button>
              <TextField
                size="small" type="number" label="第几段"
                value={windowIndexText}
                onChange={event => setWindowIndexText(event.target.value)}
                error={!validWindow}
                slotProps={{ htmlInput: { min: 1, max: windowCount, step: 1, inputMode: 'numeric' } }}
                sx={{ width: 110 }}
                disabled={busy}
                data-xdrive-ios-photos-window-index
              />
              <Button variant="outlined" disabled={busy || !validWindow || windowNumber >= windowCount}
                onClick={() => setWindowIndexText(String(windowNumber + 1))}>
                下一段
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              当前授权相册共 {windowCount} 段（每段最多 256 项）。
              {visibleCount === 0 ? '当前没有可扫描的授权照片。' : validWindow ? '当前选择第 ' + windowNumber + ' 段，索引 ' +
                ((windowNumber - 1) * 256 + 1) + '–' + Math.min(windowNumber * 256, visibleCount) + '。'
                : '请输入当前范围内的正整数段号。'}
              授权或照片顺序发生变化时，分段位置可能移动；分段完成不等于整机照片全部备份。
            </Typography>
          </Stack>
        ) : null}
        {permitted && !scanWindows ? (
          <Typography variant="caption" color="text.secondary">
            当前安装的 iOS IPA 尚不支持选择更早的扫描分段，本轮仅检查最新 256 项。
          </Typography>
        ) : null}
        {permitted ? (
          <FormControlLabel
            control={<Checkbox checked={allowCloud} disabled={busy}
              onChange={event => setAllowCloud(event.target.checked)} />}
            label="允许从 iCloud 下载本轮照片原件（默认关闭）"
          />
        ) : null}
        {progress ? (
          <Stack spacing={1}>
            <Typography variant="body2">{progress.stage}</Typography>
            <LinearProgress variant="determinate"
              value={Math.min(100, (loaded / total) * 100)}
              aria-label="本轮 iPhone 相册扫描进度" />
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              从第 {progressOffset + 1} 项起：已扫描 {progress.scanned} / {windowCapacity}
              {' · '}新增 {progress.uploaded}
              {' · '}已核验跳过 {progress.verifiedAlready}
              {' · '}Live 未支持 {progress.liveNotSupported}
              {' · '}视频未支持 {progress.videosNotSupported}
              {' · '}原件不可用 {progress.unavailable}
              {' · '}待核对 {progress.needsReview}
            </Typography>
          </Stack>
        ) : null}
        {host.nativeBackgroundGrantSupported && host.configureBackgroundGrant ? (
          <Stack spacing={1} data-xdrive-ios-bg-grant>
            <Typography variant="body2" fontWeight={700}>
              iPhone 系统后台备份授权
            </Typography>
            <Alert severity="info">
              当前阶段仅允许指定 iPhone 在锁屏后安全验证可撤销的
              Owner/Root 后台授权，并未实现后台原件自动上传。
              需要额外的受保护上传任务和重启恢复验证才能启用无人值守备份。
            </Alert>
            {bgGrant?.revokePending ? (
              <Typography variant="caption" color="warning.main">
                本机已停用；服务器撤销仍待网络确认。
              </Typography>
            ) : bgGrant?.serverVerified && bgGrant.enabled ? (
              <Typography variant="caption" color="text.secondary">
                已核实的受限授权；有效期至{' '}
                {bgGrant.expiresAt > 0
                  ? new Date(bgGrant.expiresAt).toLocaleString() : '未知'}。
              </Typography>
            ) : bgGrant?.storedButUnverified ? (
              <Typography variant="caption" color="warning.main">
                本机保存过授权，但当前服务器尚未核实；不会当作有效备份凭据。
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                尚未启用经过服务器验证的原生后台授权。
              </Typography>
            )}
            {bgGrantError ? (
              <Alert severity="warning" data-xdrive-ios-bg-grant-error>
                {bgGrantError}
              </Alert>
            ) : null}
            <Button variant="outlined"
              disabled={busy || running || bgGrantBusy ||
                (!bgGrant?.enrolled && !permitted)}
              onClick={() => { void configureBGGrant(!bgGrant?.enrolled) }}
              data-xdrive-ios-bg-grant-toggle>
              {bgGrantBusy ? '正在执行原生确认…'
                : bgGrant?.revokePending ? '重试撤销服务器后台授权'
                : bgGrant?.enrolled ? '停止并撤销后台授权'
                : '授权此设备进行后台备份准备'}
            </Button>
          </Stack>
        ) : null}
        {error ? <Alert severity="warning" data-xdrive-ios-photos-error>{error}</Alert> : null}
        {permitted && (running ? (
          <Button variant="outlined" disabled={cancelRequested} onClick={() => { void cancel() }}>
            {cancelRequested ? '正在取消…' : '取消本轮照片备份'}
          </Button>
        ) : (
          <Button variant="contained" disabled={busy || bgGrantBusy || (scanWindows && !validWindow)}
            onClick={() => { void start() }}
            data-xdrive-ios-photos-start>
            开始本轮照片备份
          </Button>
        ))}
        <Typography variant="caption" color="text.secondary">
          上传须由用户点击并在 iOS 系统提示中再次确认。只使用当前服务器验证的 Owner/root；
          不镜像删除、不自动后台运行，收到不确定 ACK 时保留账本等待核对。
        </Typography>
        <Button variant="outlined" disabled={busy || running || bgGrantBusy}
          data-xdrive-ios-settings-switch-server
          onClick={() => {
            void host.switchServer().catch(caught => {
              setError(caught instanceof Error ? caught.message : '无法打开服务器切换确认。')
            })
          }}>
          更换 iPhone App 服务器
        </Button>
      </Stack>
    </Box>
  )
}
