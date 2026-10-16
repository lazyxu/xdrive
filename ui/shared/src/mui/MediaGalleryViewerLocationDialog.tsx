import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent,
  FormControlLabel, Stack, Typography,
} from '@mui/material'
import type {
  MediaBaiduMapConsent, MediaBaiduMapConsentInput, MediaItem,
  XDriveBaiduMapProviderInfo, XDriveBaiduStaticMapRequest,
} from '../models'
import { XDriveDialogTitle } from './DialogTitle'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'

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
  getBaiduMapConsent, saveBaiduMapConsent, revokeBaiduMapConsent, onClose,
}: {
  open: boolean
  item: MediaItem | null
  getBaiduMapProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadBaiduStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  getBaiduMapConsent?: (nodeID: number) => Promise<MediaBaiduMapConsent>
  saveBaiduMapConsent?: (nodeID: number, input: MediaBaiduMapConsentInput) => Promise<MediaBaiduMapConsent>
  revokeBaiduMapConsent?: (nodeID: number, revision: number) => Promise<MediaBaiduMapConsent>
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

  useEffect(() => {
    const request = ++generation.current
    setConsent(null)
    setLoading(false)
    setBusy(false)
    setError('')
    setAgreeConversion(false)
    setAgreeIndex(false)
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
  }, [open, nodeID, getBaiduMapConsent])

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
      if (request === generation.current) setConsent(next)
    } catch {
      if (request === generation.current) setError('授权撤销失败，请重新读取最新状态。')
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
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
