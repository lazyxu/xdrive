import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import type { SvgIconProps } from '@mui/material/SvgIcon'

// File-system and album folder identity on Web and Desktop. Mobile Files keeps
// its native-style blue folder artwork; folder actions use separate icons.
export const XDRIVE_FOLDER_YELLOW = '#ffcb3d'

export function XDriveFolderIcon({ sx, ...props }: Omit<SvgIconProps, 'color'>) {
  return (
    <FolderRoundedIcon
      {...props}
      data-xdrive-folder-icon="true"
      sx={[
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        { color: XDRIVE_FOLDER_YELLOW },
      ]}
    />
  )
}
