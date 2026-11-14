import { Button, Stack } from '@mui/material'
import type { XDriveGalleryPhotoWallScale } from './MediaGalleryPhotoWallPreferences'

/** Shared UI only; each caller still authorizes the collection and date index. */
export function XDriveMediaGalleryTimeScaleControls({
  surface, scale, onChange, disabled = false, hasTimeline = true,
}: {
  surface: 'gallery' | 'places'
  scale: XDriveGalleryPhotoWallScale
  onChange: (scale: XDriveGalleryPhotoWallScale) => void
  disabled?: boolean
  hasTimeline?: boolean
}) {
  const order: XDriveGalleryPhotoWallScale[] = surface === 'gallery'
    ? ['year', 'month', 'day', 'all'] : ['all', 'year', 'month', 'day']
  const labels: Record<XDriveGalleryPhotoWallScale, string> = {
    all: surface === 'gallery' ? '所有照片' : '全部',
    year: '年', month: '月', day: '日',
  }
  return (
    <Stack direction="row" spacing={0.25} useFlexGap flexWrap="wrap"
      role="group" aria-label={surface === 'gallery' ? '图库时间尺度' : '地点照片时间分组'}
      sx={{px: surface === 'places' ? 1.25 : 0,
        pb: surface === 'places' ? 0.5 : 0,
        '& .MuiButton-root': {'@media (max-width:899.95px)': {minHeight: 44}}}}>
      {order.map(value => (
        <Button key={value} size="small"
          variant={scale === value ? 'contained' : 'text'}
          disabled={disabled || (value !== 'all' && !hasTimeline)}
          aria-pressed={scale === value}
          data-xdrive-gallery-time-scale={surface === 'gallery' ? value : undefined}
          data-xdrive-places-photo-time-scale={surface === 'places' ? value : undefined}
          onClick={() => onChange(value)}
          sx={{minHeight: surface === 'places' ? 44 : undefined,
            minWidth: surface === 'places' ? 44 : undefined,
            px: surface === 'places' ? 1.25 : undefined,
            textTransform: 'none'}}>
          {labels[value]}
        </Button>
      ))}
    </Stack>
  )
}
