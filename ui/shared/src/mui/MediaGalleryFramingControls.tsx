import { Button, Stack } from '@mui/material'
import type { XDriveMediaGalleryFraming } from './MediaGalleryPhotoWallFraming'

/** One accessible, presentation-only control for Gallery and trusted Places.
 * Each parent owns its own photo collection, accepted Owner and Viewer state.
 */
export function XDriveMediaGalleryFramingControls({
  surface, framing, onChange,
}: {
  surface: 'gallery' | 'places'
  framing: XDriveMediaGalleryFraming
  onChange: (next: XDriveMediaGalleryFraming) => void
}) {
  const gallery = surface === 'gallery'
  return (
    <Stack direction="row" spacing={0.25} aria-label="照片墙显示比例"
      data-xdrive-gallery-framing-controls={gallery ? '' : undefined}
      data-xdrive-places-photo-framing-controls={!gallery ? '' : undefined}>
      <Button size="small"
        variant={framing === 'crop' ? 'contained' : 'text'}
        aria-pressed={framing === 'crop'}
        data-xdrive-gallery-aspect-crop={gallery ? '' : undefined}
        data-xdrive-places-photo-aspect-crop={!gallery ? '' : undefined}
        onClick={() => onChange('crop')}
        sx={{minHeight:44,textTransform:'none'}}>
        方形裁切
      </Button>
      <Button size="small"
        variant={framing === 'contain' ? 'contained' : 'text'}
        aria-pressed={framing === 'contain'}
        data-xdrive-gallery-aspect-contain={gallery ? '' : undefined}
        data-xdrive-places-photo-aspect-contain={!gallery ? '' : undefined}
        onClick={() => onChange('contain')}
        sx={{minHeight:44,textTransform:'none'}}>
        原比例完整显示
      </Button>
    </Stack>
  )
}
