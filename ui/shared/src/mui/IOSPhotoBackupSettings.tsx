import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, Stack, Typography } from '@mui/material'

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
export interface XDriveIOSPhotoBackupHost {
  capabilities(): Promise<boolean>
  status(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus>
  requestAccess(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus>
  start(
    session: XDriveIOSPhotoBackupSession,
    allowICloudOriginals: boolean,
    onProgress: (progress: XDriveIOSPhotoBackupProgress) => void,
  ): Promise<XDriveIOSPhotoBackupProgress>
  cancel(): Promise<void>
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
  const [progress, setProgress] = useState<XDriveIOSPhotoBackupProgress | null>(null)
  const activeRun = useRef(false)

  // Changing authenticated Owner or closing Settings cancels the current
  // foreground job. Token rotation for the same Owner does not reset the view.
  useEffect(() => {
    let mounted = true
    setAvailable(false)
    setStatus(null)
    setError('')
    setProgress(null)
    if (session) {
      void host.capabilities().then(async supported => {
        if (!mounted || !supported) return
        setAvailable(true)
        const current = await host.status(session)
        if (mounted) setStatus(current)
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
  const loaded = Math.min(progress?.scanned ?? 0,
    Math.max(1, Math.min(progress?.totalVisible ?? 256, 256)))
  const total = Math.max(1, Math.min(progress?.totalVisible ?? 256, 256))

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
    if (!permitted || busy || running) return
    setBusy(true)
    setRunning(true)
    activeRun.current = true
    setCancelRequested(false)
    setProgress(null)
    setError('')
    try {
      const report = await host.start(session, allowCloud, setProgress)
      setProgress(report)
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
          首版每轮最多扫描最近 256 项、新增 20 张。Live Photo 和视频尚未纳入完整备份。
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
              已扫描 {progress.scanned} / {Math.min(progress.totalVisible, 256)}
              {' · '}新增 {progress.uploaded}
              {' · '}已核验跳过 {progress.verifiedAlready}
              {' · '}Live 未支持 {progress.liveNotSupported}
              {' · '}视频未支持 {progress.videosNotSupported}
              {' · '}原件不可用 {progress.unavailable}
              {' · '}待核对 {progress.needsReview}
            </Typography>
          </Stack>
        ) : null}
        {error ? <Alert severity="warning" data-xdrive-ios-photos-error>{error}</Alert> : null}
        {permitted && (running ? (
          <Button variant="outlined" disabled={cancelRequested} onClick={() => { void cancel() }}>
            {cancelRequested ? '正在取消…' : '取消本轮照片备份'}
          </Button>
        ) : (
          <Button variant="contained" disabled={busy} onClick={() => { void start() }}
            data-xdrive-ios-photos-start>
            开始本轮照片备份
          </Button>
        ))}
        <Typography variant="caption" color="text.secondary">
          上传须由用户点击并在 iOS 系统提示中再次确认。只使用当前服务器验证的 Owner/root；
          不镜像删除、不自动后台运行，收到不确定 ACK 时保留账本等待核对。
        </Typography>
      </Stack>
    </Box>
  )
}
