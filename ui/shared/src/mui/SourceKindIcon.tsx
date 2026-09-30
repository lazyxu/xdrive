import CloudRoundedIcon from '@mui/icons-material/CloudRounded'
import FolderCopyRoundedIcon from '@mui/icons-material/FolderCopyRounded'
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import { Box, Tooltip } from '@mui/material'
import { externalSourceKindLabel } from '../external-sources'

export interface XDriveSourceKindIconProps {
  kind: string
  size?: 'small' | 'medium'
  title?: string
}

function sourceKindIcon(kind: string) {
  if (kind === 'synology_photos') return PhotoLibraryRoundedIcon
  if (kind === 'synology_files') return FolderCopyRoundedIcon
  if (kind === 'yike_photos') return CloudRoundedIcon
  return StorageRoundedIcon
}

function sourceKindColor(kind: string) {
  if (kind === 'synology_photos') return 'primary.main'
  if (kind === 'synology_files') return 'warning.main'
  if (kind === 'yike_photos') return 'secondary.main'
  return 'text.secondary'
}

export function XDriveSourceKindIcon({
  kind,
  size = 'medium',
  title,
}: XDriveSourceKindIconProps) {
  const Icon = sourceKindIcon(kind)
  const label = title || externalSourceKindLabel(kind)
  const dimension = size === 'small' ? 28 : 40
  const iconSize = size === 'small' ? 18 : 24

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
          border: 1,
          borderColor: 'divider',
          borderRadius: 1.5,
          bgcolor: 'background.paper',
          color: sourceKindColor(kind),
          boxSizing: 'border-box',
        }}
      >
        <Icon sx={{ fontSize: iconSize }} />
      </Box>
    </Tooltip>
  )
}
