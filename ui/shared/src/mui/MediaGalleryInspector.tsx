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
    overlayZIndex?: number
    open?: boolean
    fallbackName?: string
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
          属性
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          {name}
        </Typography>
      </Box>
      <IconButton
        size="small"
        aria-label="关闭属性"
        onClick={onClose}
        sx={{ '@media (max-width:899.95px)': { minWidth: 44, minHeight: 44 } }}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

export function XDriveMediaDetailsInspector({
  item,
  open = false,
  fallbackName,
  onClose,
  overlayZIndex,
  ...contentProps
}: XDriveMediaDetailsInspectorProps) {
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true })
  if (!item && !open) return null
  const name = item?.node.name ?? fallbackName ?? '媒体属性'

  const content = (
    <Box sx={{ minHeight: 0, flex: 1, overflowY: 'auto' }}>
      {item
        ? <XDriveMediaDetailsContent item={item} {...contentProps} />
        : <Typography sx={{ p: 2 }} color="text.secondary" role="status">正在加载媒体属性…</Typography>}
    </Box>
  )

  if (desktop && overlayZIndex !== undefined && overlayZIndex > theme.zIndex.modal) {
    return (
      <Drawer
        anchor="right"
        open
        onClose={onClose}
        sx={{ zIndex: overlayZIndex }}
        slotProps={{ paper: { sx: {
          width: 360,
          maxWidth: '100vw',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundImage: 'none',
        } } }}
        data-xdrive-media-details-viewer-drawer
      >
        <MediaInspectorHeader name={name} onClose={onClose} />
        {content}
      </Drawer>
    )
  }

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
          zIndex: overlayZIndex ?? theme.zIndex.appBar - 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          backgroundImage: 'none',
        }}
      >
        <MediaInspectorHeader name={name} onClose={onClose} />
        {content}
      </Paper>
    )
  }

  return (
    <Drawer
      anchor="bottom"
      open
      onClose={onClose}
      sx={overlayZIndex === undefined ? undefined : { zIndex: overlayZIndex }}
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
      <MediaInspectorHeader name={name} onClose={onClose} />
      {content}
    </Drawer>
  )
}
