import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent,
  FormControlLabel, Stack, Typography,
} from '@mui/material'
import type {
  MediaBaiduMapConsent, MediaBaiduMapConsentInput,
  MediaBaiduMapIndexJob, MediaBaiduMapIndexJobInput, MediaItem,
  XDriveBaiduMapProviderInfo, XDriveBaiduStaticMapRequest,
} from '../models'
import { XDriveDialogTitle } from './DialogTitle'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'

const indexJobStatusText: Record<MediaBaiduMapIndexJob['status'], string> = {
  not_queued: '尚未加入索引队列',
  queued: '已入队，等待服务器启用调度',
  leased: '任务已被领取',
  completed: '派生位置索引已生成',
  cancelled: '任务已取消',
}

const consentStatusText: Record<MediaBaiduMapConsent['status'], string> = {
  not_granted: '尚未授权向百度转换此照片位置',
  authorized: '已授权（不代表动态地图已经启用）',
  revoked: '授权已撤销',
  expired: '授权已到期',
  source_changed: '照片 GPS 已更改，需重新授权',
}

/**
 * The ONE shared Owner-authorized Viewer location surface for Web, Mobile Web
 * and Desktop. Server-only Baidu Static and future source-bound map-index
 * consent are deliberately distinct; neither control enables JSAPI4.
 */
export function XDriveMediaGalleryViewerLocationDialog({
  open, item, getBaiduMapProvider, loadBaiduStaticMap,
  getBaiduMapConsent, saveBaiduMapConsent, revokeBaiduMapConsent,
  getBaiduMapIndexJob, enqueueBaiduMapIndexJob, cancelBaiduMapIndexJob, onClose,
}: {
  open: boolean
  item: MediaItem | null
  getBaiduMapProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadBaiduStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  getBaiduMapConsent?: (nodeID: number) => Promise<MediaBaiduMapConsent>
  saveBaiduMapConsent?: (nodeID: number, input: MediaBaiduMapConsentInput) => Promise<MediaBaiduMapConsent>
  revokeBaiduMapConsent?: (nodeID: number, revision: number) => Promise<MediaBaiduMapConsent>
  getBaiduMapIndexJob?: (nodeID: number) => Promise<MediaBaiduMapIndexJob>
  enqueueBaiduMapIndexJob?: (nodeID: number, input: MediaBaiduMapIndexJobInput) => Promise<MediaBaiduMapIndexJob>
  cancelBaiduMapIndexJob?: (nodeID: number, revision: number) => Promise<MediaBaiduMapIndexJob>
  onClose: () => void
}) {
  const latitude = item?.metadata.latitude
  const longitude = item?.metadata.longitude
  const nodeID = item?.node.id
  const validGPS = typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
  const generation = useRef(0)
  const [consent, setConsent] = useState<MediaBaiduMapConsent | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [agreeConversion, setAgreeConversion] = useState(false)
  const [agreeIndex, setAgreeIndex] = useState(false)
  const [job, setJob] = useState<MediaBaiduMapIndexJob | null>(null)
  const [jobLoading, setJobLoading] = useState(false)
  const [jobError, setJobError] = useState('')
  const [confirmJob, setConfirmJob] = useState(false)
  // A cancelled intent needs a NEW user-consent generation before retry.
  const canQueueJob = Boolean(job && (job.status === 'not_queued' ||
    (job.status === 'cancelled' && consent && consent.revision > job.consent_revision)))

  useEffect(() => {
    const request = ++generation.current
    setConsent(null)
    setLoading(false)
    setBusy(false)
    setError('')
    setAgreeConversion(false)
    setAgreeIndex(false)
    setJob(null)
    setJobError('')
    setConfirmJob(false)
    setJobLoading(false)
    if (open && nodeID && getBaiduMapIndexJob) {
      setJobLoading(true)
      void getBaiduMapIndexJob(nodeID)
        .then((value) => { if (generation.current === request) setJob(value) })
        .catch(() => { if (generation.current === request) setJobError('索引任务状态读取失败，可手动刷新。') })
        .finally(() => { if (generation.current === request) setJobLoading(false) })
    }
    if (!open || !nodeID || !getBaiduMapConsent) return
    setLoading(true)
    void getBaiduMapConsent(nodeID)
      .then((value) => {
        if (generation.current !== request) return
        setConsent(value)
      })
      .catch(() => {
        if (generation.current !== request) return
        setError('授权状态读取失败，请关闭并重新打开照片位置。')
      })
      .finally(() => {
        if (generation.current === request) setLoading(false)
      })
    return () => { generation.current++ }
  }, [open, nodeID, getBaiduMapConsent, getBaiduMapIndexJob])

  const refreshJob = async () => {
    if (!nodeID || !getBaiduMapIndexJob || jobLoading) return
    const request = generation.current
    setJobLoading(true)
    setJobError('')
    try {
      const next = await getBaiduMapIndexJob(nodeID)
      if (request === generation.current) setJob(next)
    } catch {
      if (request === generation.current) setJobError('索引任务状态读取失败，请重试。')
    } finally {
      if (request === generation.current) setJobLoading(false)
    }
  }
  const issueConsent = async () => {
    if (!nodeID || !consent || !saveBaiduMapConsent || !agreeConversion || !agreeIndex ||
        busy || !Number.isSafeInteger(consent.revision)) return
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const next = await saveBaiduMapConsent(nodeID, {
        expected_revision: consent.revision,
        expires_in_seconds: 3600,
        consent_to_baidu_conversion: true,
        consent_to_derived_index: true,
      })
      if (request === generation.current) {
        setConsent(next)
        setAgreeConversion(false)
        setAgreeIndex(false)
        setConfirmJob(false)
        void refreshJob()
      }
    } catch {
      if (request === generation.current) setError('授权保存失败，请重新读取最新状态。')
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }
  const revokeConsent = async () => {
    if (!nodeID || !consent || consent.revision <= 0 ||
        !revokeBaiduMapConsent || busy || !Number.isSafeInteger(consent.revision)) return
    const request = generation.current
    setBusy(true)
    setError('')
    try {
      const next = await revokeBaiduMapConsent(nodeID, consent.revision)
      if (request === generation.current) {
        setConsent(next)
        setConfirmJob(false)
        void refreshJob()
      }
    } catch {
      if (request === generation.current) setError('授权撤销失败，请重新读取最新状态。')
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  const enqueueJob = async () => {
    if (!nodeID || !consent?.authorized || !consent.source_current ||
        !Number.isSafeInteger(consent.revision) || consent.revision <= 0 ||
        !job || !confirmJob || !enqueueBaiduMapIndexJob || busy || jobLoading ||
        !canQueueJob) return
    const request = generation.current
    setBusy(true)
    setJobError('')
    try {
      const next = await enqueueBaiduMapIndexJob(nodeID, {
        expected_revision: consent.revision, confirm: true,
      })
      if (request === generation.current) {
        setJob(next)
        setConfirmJob(false)
      }
    } catch {
      if (request === generation.current) setJobError('提交失败，授权或照片可能已更改；请刷新状态。')
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }
  const cancelJob = async () => {
    if (!nodeID || !job || !cancelBaiduMapIndexJob || busy || jobLoading ||
        !['queued', 'leased'].includes(job.status) ||
        !Number.isSafeInteger(job.consent_revision) || job.consent_revision <= 0) return
    const request = generation.current
    setBusy(true)
    setJobError('')
    try {
      const next = await cancelBaiduMapIndexJob(nodeID, job.consent_revision)
      if (request === generation.current) {
        setJob(next)
        setConfirmJob(false)
      }
    } catch {
      if (request === generation.current) setJobError('取消失败，任务状态可能已变化；请刷新。')
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  return (
    <Dialog
      open={open && Boolean(item)}
      onClose={busy ? undefined : onClose}
      fullWidth maxWidth="sm"
      aria-label="照片位置地图"
      data-xdrive-gallery-viewer-location
    >
      <XDriveDialogTitle title="照片位置" subtitle={item?.node.name || '地图'} onClose={onClose} closeDisabled={busy} />
      <DialogContent dividers sx={{ p: { xs: 0.5, sm: 1 } }}>
        {validGPS ? (
          <XDriveMediaGalleryBaiduStaticMap
            location={{ latitude, longitude, name: item?.node.name }}
            getProvider={getBaiduMapProvider}
            loadStaticMap={loadBaiduStaticMap}
          />
        ) : (
          <Typography role="status" color="text.secondary" sx={{ p: 2 }}>
            这张照片没有有效的 GPS 坐标。
          </Typography>
        )}
        {validGPS && getBaiduMapConsent && saveBaiduMapConsent && revokeBaiduMapConsent ? (
          <Stack spacing={1} sx={{ px: { xs: 1.5, sm: 2 }, py: 2 }}>
            <Typography variant="subtitle2">地图位置隐私授权</Typography>
            <Typography variant="body2" color="text.secondary">
              此授权仅供将来服务端将照片 GPS 发送至百度作坐标转换及建立派生位置索引；
              不会开启百度动态地图，也不会公开原始坐标。
            </Typography>
            <Typography role="status" variant="body2">
              {loading ? '正在读取授权…' : consent
                ? (consentStatusText[consent.status] || '授权状态未知')
                : '尚未获得授权状态'}
            </Typography>
            {consent?.expires_at && consent.status === 'authorized' ? (
              <Typography variant="caption" color="text.secondary">
                到期时间：{new Date(consent.expires_at).toLocaleString('zh-CN')}
              </Typography>
            ) : null}
            <FormControlLabel
              control={<Checkbox checked={agreeConversion} disabled={busy || loading || !consent}
                onChange={(_, checked) => setAgreeConversion(checked)} />}
              label="我同意将此照片的位置发送至百度用于地图坐标转换"
            />
            <FormControlLabel
              control={<Checkbox checked={agreeIndex} disabled={busy || loading || !consent}
                onChange={(_, checked) => setAgreeIndex(checked)} />}
              label="我同意在 xDrive Server 建立此照片的派生位置索引"
            />
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button variant="contained" size="small" sx={{ minHeight: 44 }}
                disabled={!consent || busy || loading || !agreeConversion || !agreeIndex}
                onClick={() => { void issueConsent() }}>
                {consent?.authorized ? '更新一小时授权' : '授权一小时'}
              </Button>
              <Button size="small" color="error" variant="outlined" sx={{ minHeight: 44 }}
                disabled={!consent || consent.revision <= 0 || consent.status === 'revoked' || busy || loading}
                onClick={() => { void revokeConsent() }}>
                撤销授权
              </Button>
            </Stack>
            {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
            {getBaiduMapIndexJob && enqueueBaiduMapIndexJob && cancelBaiduMapIndexJob ? (
              <Stack spacing={1.25} sx={{ pt: 1 }} data-xdrive-gallery-baidu-index-job>
                <Typography variant="subtitle2">照片地图索引任务</Typography>
                <Typography role="status" variant="body2">
                  {jobLoading ? '正在读取任务状态…' : job
                    ? indexJobStatusText[job.status] : '尚未取得任务状态'}
                </Typography>
                {job?.status === 'cancelled' && consent &&
                  consent.revision <= job.consent_revision ? (
                    <Typography variant="caption" color="text.secondary">
                      已取消的任务不能使用旧授权再次提交；需要先更新位置授权。
                    </Typography>
                  ) : null}
                {job && !job.dispatch_enabled ? (
                  <Alert severity="info">
                    服务器尚未放行百度坐标转换及调度。加入等待队列不会立即发送照片位置，也不代表地图已经生成。
                  </Alert>
                ) : null}
                <FormControlLabel
                  control={<Checkbox checked={confirmJob} disabled={busy || jobLoading ||
                    consent?.status !== 'authorized' || !consent.source_current ||
                    !job || !canQueueJob}
                    onChange={(_, checked) => setConfirmJob(checked)} />}
                  label="我确认单独提交此照片的定位索引任务（可能在未来服务启用后执行）"
                />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button size="small" variant="contained" sx={{ minHeight: 44 }}
                    disabled={busy || jobLoading || !confirmJob || !consent?.authorized ||
                      !consent.source_current || !job ||
                      !canQueueJob}
                    onClick={() => { void enqueueJob() }}>
                    加入索引等待队列
                  </Button>
                  <Button size="small" color="error" variant="outlined" sx={{ minHeight: 44 }}
                    disabled={busy || jobLoading || !job || !['queued', 'leased'].includes(job.status)}
                    onClick={() => { void cancelJob() }}>
                    取消索引任务
                  </Button>
                  <Button size="small" disabled={busy || jobLoading}
                    onClick={() => { void refreshJob() }}>刷新状态</Button>
                </Stack>
                {jobError ? <Alert severity="error" role="alert">{jobError}</Alert> : null}
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
