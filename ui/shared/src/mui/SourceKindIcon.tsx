import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import { Box, Tooltip } from '@mui/material'
import { externalSourceKindLabel } from '../external-sources'

const sourceKindImages: Record<string, string> = {
  synology_photos: new URL('../../assets/source-icons/synology-photos.png', import.meta.url).href,
  synology_files: new URL('../../assets/source-icons/synology-file-station.png', import.meta.url).href,
  yike_photos: new URL('../../assets/source-icons/yike-photos.png', import.meta.url).href,
}

export interface XDriveSourceKindIconProps {
  kind: string
  size?: 'small' | 'medium'
  title?: string
}

export function XDriveSourceKindIcon({
  kind,
  size = 'medium',
  title,
}: XDriveSourceKindIconProps) {
  const label = title || externalSourceKindLabel(kind)
  const src = sourceKindImages[kind]
  const dimension = size === 'small' ? 28 : 40
  const imageSize = size === 'small' ? 24 : 36

  return (
    <Tooltip title={label} enterDelay={500}>
      <Box
        component="span"
        aria-label={`${label}图标`}
        sx={{
          width: dimension,
          height: dimension,
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: size === 'small' ? 1 : 1.5,
          bgcolor: 'transparent',
          boxSizing: 'border-box',
        }}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt=""
            aria-hidden="true"
            sx={{
              display: 'block',
              width: imageSize,
              height: imageSize,
              objectFit: 'contain',
            }}
          />
        ) : (
          <StorageRoundedIcon sx={{ fontSize: size === 'small' ? 18 : 24, color: 'text.secondary' }} />
        )}
      </Box>
    </Tooltip>
  )
}
