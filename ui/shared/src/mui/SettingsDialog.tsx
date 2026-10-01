import type { ReactNode } from 'react'
import { Box, Dialog, Stack, Typography } from '@mui/material'
import type { DialogProps } from '@mui/material/Dialog'
import type { BuildInfo } from '../models'
import type { XDriveAppearance } from '../preferences'
import type {
  XDriveServerUpdateChannel,
  XDriveServerUpdateSource,
  XDriveServerUpdateState,
} from '../server-update'
import { XDriveAppearanceField } from './AppearanceField'
import { XDriveBuildInfoCard } from './BuildInfoCard'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, xDriveDialogPaperProps } from './DialogTitle'
import { XDriveServerUpdateCard } from './ServerUpdateCard'
import { XDriveStatusAlert } from './StatusAlert'

export interface XDriveSettingsBuildInfo {
  title: string
  info?: BuildInfo | null
}

export interface XDriveSettingsServerUpdate {
  state: XDriveServerUpdateState | null
  source: XDriveServerUpdateSource
  channel: XDriveServerUpdateChannel
  loading?: boolean
  disabled?: boolean
  canUpdate?: boolean
  unavailableMessage?: ReactNode
  error?: ReactNode
  onSourceChange: (value: XDriveServerUpdateSource) => void
  onChannelChange: (value: XDriveServerUpdateChannel) => void
  onStart: () => void
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
  serverUpdate,
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
  serverUpdate?: XDriveSettingsServerUpdate
  children?: ReactNode
}) {
  const canUpdateServer = serverUpdate?.canUpdate !== false

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      scroll="paper"
      slotProps={{ paper: xDriveDialogPaperProps }}
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
            <Box>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>构建信息</Typography>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
                {buildInfo.map((item) => (
                  <XDriveBuildInfoCard key={item.title} title={item.title} info={item.info} />
                ))}
              </Stack>
            </Box>
          ) : null}

          {serverUpdate ? (
            <Box>
              {canUpdateServer ? (
                <Stack spacing={1.5}>
                  <XDriveServerUpdateCard
                    state={serverUpdate.state}
                    source={serverUpdate.source}
                    channel={serverUpdate.channel}
                    loading={serverUpdate.loading}
                    disabled={serverUpdate.disabled}
                    onSourceChange={serverUpdate.onSourceChange}
                    onChannelChange={serverUpdate.onChannelChange}
                    onStart={serverUpdate.onStart}
                  />
                  {serverUpdate.error ? (
                    <XDriveStatusAlert tone="warning">{serverUpdate.error}</XDriveStatusAlert>
                  ) : null}
                </Stack>
              ) : (
                <XDriveStatusAlert tone="neutral">
                  {serverUpdate.unavailableMessage ?? '当前账号不能更新服务端。'}
                </XDriveStatusAlert>
              )}
            </Box>
          ) : null}

          {children}
        </Stack>
      </XDriveDialogContent>
    </Dialog>
  )
}
