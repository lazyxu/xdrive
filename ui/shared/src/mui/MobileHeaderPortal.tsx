import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import { Box, Drawer, IconButton, Portal, Stack, Typography } from '@mui/material'

/** A Web shell owns one mobile header. Standalone Desktop map guests keep
 * their local chrome, while L2/L3 intentionally suppress ordinary page nav.
 */
export type XDriveMobileHeaderMode = 'standalone' | 'shell' | 'global' | 'hidden'
export type XDriveMobileHeaderPortalState = {
  mode: XDriveMobileHeaderMode
  navigationTarget: HTMLDivElement | null
  actionsTarget: HTMLDivElement | null
}
export const XDriveMobileHeaderPortalContext =
  createContext<XDriveMobileHeaderPortalState | null>(null)

export function useXDriveMobileHeaderMode(): XDriveMobileHeaderMode {
  return useContext(XDriveMobileHeaderPortalContext)?.mode ?? 'standalone'
}

/** Portal the original controls/callbacks, never duplicate page navigation. */
export function XDriveMobileHeaderNavigation({ children }: { children: ReactNode }) {
  const host = useContext(XDriveMobileHeaderPortalContext)
  if (host?.mode === 'hidden') return null
  if (host?.mode === 'global')
    return host.navigationTarget ? <Portal container={host.navigationTarget}>{children}</Portal> : null
  return <>{children}</>
}

/** Generic shared-page action buttons belong to one accessible top-menu,
 * not a second title/toolbar. The authenticated action handlers are unchanged.
 */
export function XDriveMobileHeaderPageActions({
  title, actions,
}: { title: string; actions?: ReactNode }) {
  const host = useContext(XDriveMobileHeaderPortalContext)
  const [open, setOpen] = useState(false)
  if (host?.mode !== 'shell' || !host.actionsTarget || !actions) return null
  return (
    <Portal container={host.actionsTarget}>
      <>
      <IconButton data-xdrive-mobile-page-actions-trigger
        aria-label={title + '页面操作'} aria-haspopup="dialog"
        aria-expanded={open} onClick={() => setOpen(true)}
        sx={{ width: 44, height: 44, flexShrink: 0 }}>
        <MoreHorizRoundedIcon />
      </IconButton>
      <Drawer anchor="bottom" open={open} onClose={() => setOpen(false)}
        slotProps={{ paper: { sx: {
          maxHeight: 'min(75dvh, 680px)', overflowY: 'auto',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          pb: 'max(12px, env(safe-area-inset-bottom, 0px))',
          px: 'max(16px, env(safe-area-inset-left, 0px))',
        } } }}>
        <Stack direction="row" alignItems="center" sx={{ minHeight: 52 }}>
          <Typography component="h2" variant="subtitle1" sx={{ flex: 1, minWidth: 0 }} noWrap>
            {title} · 操作
          </Typography>
          <IconButton aria-label="关闭页面操作" onClick={() => setOpen(false)}
            sx={{ width: 44, height: 44 }}>
            <MoreHorizRoundedIcon />
          </IconButton>
        </Stack>
        <Box data-xdrive-mobile-page-action-sheet
          onClickCapture={() => setOpen(false)}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, py: 1,
            '& .MuiButtonBase-root': { minHeight: 44, minWidth: 44 } }}>
          {actions}
        </Box>
      </Drawer>
      </>
    </Portal>
  )
}
