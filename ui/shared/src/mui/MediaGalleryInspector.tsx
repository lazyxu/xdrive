import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import {
  Box,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import {
  XDriveMediaDetailsContent,
} from './MediaGalleryDetails'
import type {
  XDriveMediaDetailsContentProps,
} from './MediaGalleryDetails'

export type XDriveMediaDetailsInspectorProps =
  XDriveMediaDetailsContentProps & {
    onClose: () => void
  }

function MediaInspectorHeader({
  name,
  onClose,
}: {
  name: string
  onClose: () => void
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{
        minHeight: 52,
        px: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          信息
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          {name}
        </Typography>
      </Box>
      <IconButton size="small" aria-label="关闭媒体信息" onClick={onClose}>
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

export function XDriveMediaDetailsInspector({
  item,
  onClose,
  ...contentProps
}: XDriveMediaDetailsInspectorProps) {
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true })
  if (!item) return null

  const content = (
    <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
      <XDriveMediaDetailsContent item={item} {...contentProps} />
    </Box>
  )

  if (desktop) {
    return (
      <Paper
        component="aside"
        elevation={3}
        data-xdrive-media-inspector
        sx={{
          position: 'fixed',
          top: 72,
          right: 20,
          bottom: 20,
          width: 360,
          minHeight: 0,
          zIndex: theme.zIndex.appBar - 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          backgroundImage: 'none',
        }}
      >
        <MediaInspectorHeader name={item.node.name} onClose={onClose} />
        {content}
      </Paper>
    )
  }

  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      data-xdrive-media-details-drawer
      slotProps={{
        paper: {
          sx: {
            maxHeight: '86vh',
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            backgroundImage: 'none',
            overflow: 'hidden',
          },
        },
      }}
    >
      <MediaInspectorHeader name={item.node.name} onClose={onClose} />
      {content}
    </Drawer>
  )
}
