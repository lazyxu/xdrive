import type { ReactNode } from 'react'
import { Box, Dialog, Divider, Stack, Typography } from '@mui/material'
import { XDriveActionButton } from './ActionButton'
import { XDriveDescriptionGrid, XDriveDescriptionItem } from './DescriptionGrid'
import { XDriveDialogActions } from './DialogActions'
import { XDriveDialogContent } from './DialogContent'
import { XDriveDialogTitle, useXDriveCompactTouchDialog } from './DialogTitle'

export type XDriveFilePropertiesDialogSection = 'general' | 'content' | 'technical'

export type XDriveFilePropertiesDialogProperty = {
  label: string
  value: ReactNode
  section?: XDriveFilePropertiesDialogSection
}

export function XDriveFilePropertiesDialog({
  open,
  title,
  preview,
  properties,
  onClose,
}: {
  open: boolean
  title: ReactNode
  preview?: ReactNode
  properties: XDriveFilePropertiesDialogProperty[]
  onClose: () => void
}) {
  const { compactTouch, dialogPaper } = useXDriveCompactTouchDialog()
  const sections = ([
    ['general', '常规'],
    ['content', '内容'],
    ['technical', '技术详情'],
  ] as const)
    .map(([key, label]) => ({
      key,
      label,
      properties: properties.filter((property) => (
        (property.section ?? 'general') === key
      )),
    }))
    .filter((section) => section.properties.length > 0)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={compactTouch}
      scroll="paper"
      aria-label="文件属性"
      slotProps={{ paper: dialogPaper }}
    >
      <XDriveDialogTitle title={title} onClose={onClose} />
      <XDriveDialogContent dividers>
        <Stack spacing={2}>
          {preview ? (
            <Box
              data-xdrive-file-properties-preview
              sx={{
                minHeight: 144,
                maxHeight: 220,
                borderRadius: 0,
                bgcolor: 'background.default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {preview}
            </Box>
          ) : null}

          {sections.map((section, index) => (
            <Stack key={section.key} spacing={1}>
              {index > 0 ? <Divider /> : null}
              <Typography variant="caption" color="text.secondary">
                {section.label}
              </Typography>
              <XDriveDescriptionGrid columns={2}>
                {section.properties.map((property) => (
                  <XDriveDescriptionItem key={property.label} label={property.label}>
                    {property.value}
                  </XDriveDescriptionItem>
                ))}
              </XDriveDescriptionGrid>
            </Stack>
          ))}
        </Stack>
      </XDriveDialogContent>
      <XDriveDialogActions>
        <XDriveActionButton intent="primary" onClick={onClose}>确定</XDriveActionButton>
      </XDriveDialogActions>
    </Dialog>
  )
}
