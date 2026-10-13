import { Dialog, DialogContent, Typography } from '@mui/material'
import type { MediaItem, XDriveBaiduMapProviderInfo, XDriveBaiduStaticMapRequest } from '../models'
import { XDriveDialogTitle } from './DialogTitle'
import { XDriveMediaGalleryBaiduStaticMap } from './MediaGalleryBaiduStaticMap'

/**
 * The single owner-authorized photo-location Viewer surface for Web, Mobile Web
 * and Desktop. Only the existing Server-backed Baidu PNG is requested.
 */
export function XDriveMediaGalleryViewerLocationDialog({
  open,
  item,
  getBaiduMapProvider,
  loadBaiduStaticMap,
  onClose,
}: {
  open: boolean
  item: MediaItem | null
  getBaiduMapProvider?: () => Promise<XDriveBaiduMapProviderInfo>
  loadBaiduStaticMap?: (input: XDriveBaiduStaticMapRequest, signal?: AbortSignal) => Promise<Blob>
  onClose: () => void
}) {
  const latitude = item?.metadata.latitude
  const longitude = item?.metadata.longitude
  const validGPS = typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180

  return (
    <Dialog
      open={open && Boolean(item)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-label="照片位置地图"
      data-xdrive-gallery-viewer-location
    >
      <XDriveDialogTitle title="照片位置" subtitle={item?.node.name || '地图'} onClose={onClose} />
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
      </DialogContent>
    </Dialog>
  )
}
