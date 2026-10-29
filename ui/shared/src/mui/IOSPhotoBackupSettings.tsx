import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'

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
export interface XDriveIOSReceiptReviewStatus {
  pending: number
  maxPerRun: number
}
export interface XDriveIOSReceiptReviewProgress {
  pending: number
  checked: number
  confirmed: number
  activeUnverified: number
  missing: number
  expired: number
  ambiguous: number
  stage: string
}

export interface XDriveIOSPhotoAutoStatus {
  enabled: boolean
  pausedForReview: boolean
  intervalMinutes: number
  allowICloudOriginals: boolean
  windowIndex: number
  nextDueAt: number // Unix milliseconds; zero when not scheduled
}
export interface XDriveIOSPhotoAutoTickResult {
  ran: boolean
  reason?: string
  uploaded?: number
  verifiedAlready?: number
  needsReview?: number
  schedule?: XDriveIOSPhotoAutoStatus
}

export interface XDriveIOSPhotoBackupHost {
  /** Negotiated with the real native host; false for older installed IPA. */
  scanWindowsSupported?: boolean
  receiptReviewSupported?: boolean
  foregroundAutoSupported?: boolean
  capabilities(): Promise<boolean>
  status(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus>
  requestAccess(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoStatus>
  start(
    session: XDriveIOSPhotoBackupSession,
    allowICloudOriginals: boolean,
    onProgress: (progress: XDriveIOSPhotoBackupProgress) => void,
    windowIndex?: number,
  ): Promise<XDriveIOSPhotoBackupProgress>
  reviewStatus(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSReceiptReviewStatus>
  reviewPending(
    session: XDriveIOSPhotoBackupSession,
    onProgress: (progress: XDriveIOSReceiptReviewProgress) => void,
  ): Promise<XDriveIOSReceiptReviewProgress>
  autoStatus(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoAutoStatus>
  configureAuto(
    session: XDriveIOSPhotoBackupSession,
    enabled: boolean, intervalMinutes: number, allowICloudOriginals: boolean,
  ): Promise<XDriveIOSPhotoAutoStatus>
  autoTick(session: XDriveIOSPhotoBackupSession): Promise<XDriveIOSPhotoAutoTickResult>
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
  const [reviewStatus, setReviewStatus] = useState<XDriveIOSReceiptReviewStatus | null>(null)
  const [reviewReport, setReviewReport] = useState<XDriveIOSReceiptReviewProgress | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [autoStatus, setAutoStatus] = useState<XDriveIOSPhotoAutoStatus | null>(null)
  const [autoInterval, setAutoInterval] = useState(60)
  const [autoConsentBusy, setAutoConsentBusy] = useState(false)
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
    setReviewStatus(null)
    setReviewReport(null)
    setAutoStatus(null)
    if (session) {
      void host.capabilities().then(async supported => {
        if (!mounted || !supported) return
        setAvailable(true)
        const current = await host.status(session)
        if (mounted) setStatus(current)
        if (host.receiptReviewSupported) {
          const pending = await host.reviewStatus(session)
          if (mounted) setReviewStatus(pending)
        }
        if (host.foregroundAutoSupported) {
          const auto = await host.autoStatus(session)
          if (mounted) {
            setAutoStatus(auto)
            setAutoInterval(auto.intervalMinutes)
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
    if (busy || running || reviewing) return
    setBusy(true)
    setError('')
    try {
      setStatus(await host.requestAccess(session))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法取得系统相册授权。')
    } finally { setBusy(false) }
  }

  const start = async () => {
    if (!permitted || busy || running || reviewing || (scanWindows && !validWindow)) return
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
      if (host.receiptReviewSupported) {
        try { setReviewStatus(await host.reviewStatus(session)) }
        catch { /* A failed optional ledger count must not hide genuine upload receipt. */ }
      }
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

  const configureAuto = async (enabled: boolean) => {
    if (!host.foregroundAutoSupported || busy || running || reviewing ||
        autoConsentBusy) return
    setAutoConsentBusy(true)
    setError('')
    try {
      const result = await host.configureAuto(session, enabled, autoInterval, allowCloud)
      setAutoStatus(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法保存前台自动备份授权。')
    } finally {
      setAutoConsentBusy(false)
    }
  }

  const cancel = async () => {
    setCancelRequested(true)
    try { await host.cancel() }
    catch { setError('取消请求未获得确认；请在服务器核对未完成的上传。') }
  }

  const reviewReceipts = async () => {
    if (!host.receiptReviewSupported || !reviewStatus?.pending ||
        busy || running || reviewing) return
    setReviewing(true)
    activeRun.current = true
    setError('')
    setReviewReport(null)
    try {
      const report = await host.reviewPending(session, setReviewReport)
      setReviewReport(report)
      setReviewStatus(await host.reviewStatus(session))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法确认当前 Owner 的历史上传收据。')
    } finally {
      activeRun.current = false
      setReviewing(false)
    }
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
        {host.foregroundAutoSupported ? (
          <Stack spacing={1.2} data-xdrive-ios-foreground-auto-backup>
            <Typography variant="body2" fontWeight={700}>前台自动定时增量备份</Typography>
            <Typography variant="caption" color="text.secondary">
              仅当 iPhone App 保持打开、共享登录有效且页面处于前台时，
              按选择的间隔自动检查一个相册分段。每轮最多新增 20 项，
              逐段轮转并通过已确认的 Server 收据跳过重复原件。
              系统锁屏、退出 App 或关闭网页不会保证后台执行。
            </Typography>
            <TextField select label="检查间隔" size="small" value={autoInterval}
              onChange={event => setAutoInterval(Number(event.target.value))}
              disabled={autoConsentBusy || busy || running || reviewing}
              data-xdrive-ios-auto-interval>
              <MenuItem value={15}>每 15 分钟</MenuItem>
              <MenuItem value={60}>每 1 小时</MenuItem>
              <MenuItem value={360}>每 6 小时</MenuItem>
              <MenuItem value={1440}>每天</MenuItem>
            </TextField>
            {autoStatus?.pausedForReview ? (
              <Alert severity="warning">
                上轮收据不确定，已暂停自动任务；请先核对历史收据再重新授权。
              </Alert>
            ) : null}
            {autoStatus?.enabled ? (
              <Typography variant="caption">
                已启用：当前扫描第 {autoStatus.windowIndex + 1} 段。
                {autoStatus.nextDueAt > 0 ? ' 下次最早尝试时间：' +
                  new Date(autoStatus.nextDueAt).toLocaleString() : ''}
              </Typography>
            ) : null}
            <Button variant={autoStatus?.enabled ? 'outlined' : 'contained'}
              disabled={autoConsentBusy || busy || running || reviewing ||
                (!autoStatus?.enabled && !permitted)}
              onClick={() => { void configureAuto(!autoStatus?.enabled) }}
              data-xdrive-ios-auto-toggle>
              {autoConsentBusy ? '正在确认…' :
                autoStatus?.enabled ? '关闭前台自动备份' : '启用前台自动备份'}
            </Button>
          </Stack>
        ) : null}
        {host.receiptReviewSupported ? (
          <Stack spacing={1} data-xdrive-ios-receipt-review>
            <Typography variant="body2" fontWeight={700}>历史上传收据核对</Typography>
            <Typography variant="body2">
              {reviewStatus ? '当前有 ' + reviewStatus.pending + ' 条不确定记录待核对。'
                : '正在读取此账户受保护的本地备份账本…'}
            </Typography>
            {reviewReport ? (
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {reviewReport.stage}
                {' · '}本轮检查 {reviewReport.checked}
                {' · '}真实确认 {reviewReport.confirmed}
                {' · '}活动会话未证实 {reviewReport.activeUnverified}
                {' · '}未找到证据 {reviewReport.missing}
                {' · '}已过期 {reviewReport.expired}
                {' · '}多重匹配 {reviewReport.ambiguous}
              </Typography>
            ) : null}
            {reviewing ? (
              <Button variant="outlined" onClick={() => {
                void host.cancel().catch(() => {
                  setError('取消核对未得到确认，请检查当前连接。')
                })
              }}>
                取消本轮核对
              </Button>
            ) : (
              <Button variant="outlined"
                disabled={busy || running || !reviewStatus || reviewStatus.pending === 0}
                onClick={() => { void reviewReceipts() }}
                data-xdrive-ios-receipt-review-start>
                只读核对历史收据（每轮最多 20 条）
              </Button>
            )}
            <Typography variant="caption" color="text.secondary">
              此操作只查询当前 Owner 已存在的 UploadSession，并核验真正保存的文件；
              不会自动补传、重新创建会话、删除或覆盖照片。未获得双重确认的记录仍保持未知。
            </Typography>
          </Stack>
        ) : null}
        {error ? <Alert severity="warning" data-xdrive-ios-photos-error>{error}</Alert> : null}
        {permitted && (running ? (
          <Button variant="outlined" disabled={cancelRequested} onClick={() => { void cancel() }}>
            {cancelRequested ? '正在取消…' : '取消本轮照片备份'}
          </Button>
        ) : (
          <Button variant="contained" disabled={busy || reviewing || (scanWindows && !validWindow)}
            onClick={() => { void start() }}
            data-xdrive-ios-photos-start>
            开始本轮照片备份
          </Button>
        ))}
        <Typography variant="caption" color="text.secondary">
          上传须由用户点击并在 iOS 系统提示中再次确认。只使用当前服务器验证的 Owner/root；
          不镜像删除、不自动后台运行，收到不确定 ACK 时保留账本等待核对。
        </Typography>
        <Button variant="outlined" disabled={busy || running || reviewing}
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
