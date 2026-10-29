import { Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import type {
  MediaBaiduMapConsent, MediaBaiduMapConsentInput,
  MediaBaiduMapIndexJob, MediaBaiduMapIndexJobInput, MediaItem,
} from '../models'
import { XDriveDialogTitle } from './DialogTitle'
import { xDriveViewerPhotoMapSelection } from '../media-gallery-viewer-photo-map-selection'
import type { XDriveViewerPhotoMapSelection } from '../media-gallery-viewer-photo-map-selection'

/**
 * Shared Web/Mobile/Desktop Viewer location surface.
 * An authenticated Owner photo with valid GPS needs NO secondary map consent.
 * Deprecated callback props are kept only for old callers during migration.
 * No grant, revoke, expiry, enqueue or confirmation UI is rendered.
 */
export function XDriveMediaGalleryViewerLocationDialog({
  open, item, onOpenDynamicMap, onClose,
}: {
  open: boolean
  item: MediaItem | null
  onOpenDynamicMap?: (selection: XDriveViewerPhotoMapSelection) => void
  /** @deprecated No per-photo map consent. */
  getBaiduMapConsent?: (nodeID: number) => Promise<MediaBaiduMapConsent>
  /** @deprecated No per-photo map consent. */
  saveBaiduMapConsent?: (nodeID: number, input: MediaBaiduMapConsentInput) => Promise<MediaBaiduMapConsent>
  /** @deprecated No per-photo map consent. */
  revokeBaiduMapConsent?: (nodeID: number, revision: number) => Promise<MediaBaiduMapConsent>
  /** @deprecated Indexing is Server-managed without per-photo opt-in. */
  getBaiduMapIndexJob?: (nodeID: number) => Promise<MediaBaiduMapIndexJob>
  /** @deprecated No per-photo queue confirmation. */
  enqueueBaiduMapIndexJob?: (nodeID: number, input: MediaBaiduMapIndexJobInput) => Promise<MediaBaiduMapIndexJob>
  /** @deprecated No per-photo consent-driven cancellation. */
  cancelBaiduMapIndexJob?: (nodeID: number, revision: number) => Promise<MediaBaiduMapIndexJob>
  onClose: () => void
}) {
  // The trusted Viewer sends only the exact current Node and revision.
  // Original WGS84/EXIF, signed URLs and any Owner credentials stay local.
  const selection = xDriveViewerPhotoMapSelection(item)
  const latitude = item?.metadata.latitude
  const longitude = item?.metadata.longitude
  const validGPS = typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180

  return (
    <Dialog open={open && Boolean(item)} onClose={onClose}
      fullWidth maxWidth="sm" aria-label="照片位置地图"
      data-xdrive-gallery-viewer-location>
      <XDriveDialogTitle title="照片位置" subtitle={item?.node.name || '地图'} onClose={onClose} />
      <DialogContent dividers>
        {validGPS ? (
          <Stack spacing={1.5} sx={{p:2}}>
            <Typography variant="body2" color="text.secondary">
              这张照片具有有效 GPS，已自动具备照片地图索引资格，无需单独授权。
              如尚未完成 BD-09 位置派生，地图将在位置索引完成后显示该照片。
            </Typography>
            <Button variant="outlined" disabled={!onOpenDynamicMap || !selection}
              sx={{minHeight:44}}
              onClick={() => {
                if (!validGPS || !selection || !onOpenDynamicMap) return
                onClose()
                onOpenDynamicMap(selection)
              }}>
              打开照片地图
            </Button>
            {!onOpenDynamicMap || !selection ? (
              <Typography variant="caption" color="text.secondary" role="status">
                {!selection
                  ? '当前照片的身份或修订版本无效，无法安全打开地图。'
                  : '当前照片集合暂不能安全映射到地图，请从支持地图的图库或相册范围进入。'}
              </Typography>
            ) : null}
          </Stack>
        ) : (
          <Typography role="status" color="text.secondary" sx={{p:2}}>
            这张照片没有有效的 GPS 坐标。
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
