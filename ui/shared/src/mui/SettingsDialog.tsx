import type { ReactNode } from 'react'
import { Box, Dialog, Stack, Typography } from '@mui/material'
import type { DialogProps } from '@mui/material/Dialog'
import type { BuildInfo } from '../models'
import type { XDriveAppearance } from '../preferences'
import { XDriveAppearanceField } from './AppearanceField'
import { XDriveBuildInfoCard } from './BuildInfoCard'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'

export interface XDriveSettingsBuildInfo {
  title: string
  info?: BuildInfo | null
}

export function XDriveSettingsDialog({
  open,
  onClose,
  subtitle,
  maxWidth = 'md',
  appearance,
  appearanceDisabled = false,
  onAppearanceChange,
  buildInfo = [],
  buildInfoSectionID,
  children,
}: {
  open: boolean
  onClose: () => void
  subtitle?: ReactNode
  maxWidth?: DialogProps['maxWidth']
  appearance: XDriveAppearance
  appearanceDisabled?: boolean
  onAppearanceChange: (value: XDriveAppearance) => void | Promise<void>
  buildInfo?: XDriveSettingsBuildInfo[]
  buildInfoSectionID?: string
  children?: ReactNode
}) {
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      fullScreen={compactTouch}
      scroll="paper"
      slotProps={{ paper: dialogPaper }}
    >
      <XDriveDialogTitle
        title="设置"
        subtitle={subtitle}
        onClose={onClose}
      />
      <XDriveDialogContent dividers>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>外观</Typography>
            <XDriveAppearanceField
              value={appearance}
              disabled={appearanceDisabled}
              onChange={onAppearanceChange}
            />
          </Box>

          {buildInfo.length > 0 ? (
            <Box id={buildInfoSectionID}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>构建信息</Typography>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
                {buildInfo.map((item) => (
                  <XDriveBuildInfoCard key={item.title} title={item.title} info={item.info} />
                ))}
              </Stack>
            </Box>
          ) : null}

          {children}
        </Stack>
      </XDriveDialogContent>
    </Dialog>
  )
}
