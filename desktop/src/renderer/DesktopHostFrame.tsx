import type { ReactNode } from 'react'
import { IconButton } from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded'
import FilterNoneRoundedIcon from '@mui/icons-material/FilterNoneRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import xDriveBrandIcon from '../../../assets/icon/master/xdrive-icon-master.svg'
import { XDriveBrandLockup } from '@xdrive/ui/mui'

/** Desktop-only chrome; no Electron call or DSM CGI in this pure JSX. */
export type DesktopWindowHostActions = Readonly<{
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
}>

export function DesktopHostFrame({
  children,
  maximized,
  titlebarActions,
  windowHost,
}: {
  children: ReactNode
  maximized: boolean
  titlebarActions?: ReactNode
  windowHost: DesktopWindowHostActions
}) {
  return (
    <div className="desktop-frame">
      <header className="desktop-titlebar">
        <XDriveBrandLockup iconSrc={xDriveBrandIcon} variant="titlebar" className="desktop-titlebar-brand" />
        <div className="desktop-titlebar-actions">{titlebarActions}</div>
        <div className="desktop-window-controls">
          <IconButton
            className="desktop-window-control"
            aria-label="最小化"
            title="最小化"
            disableRipple
            onClick={() => windowHost.minimize()}
          >
            <RemoveRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton
            className="desktop-window-control"
            aria-label={maximized ? '还原' : '最大化'}
            title={maximized ? '还原' : '最大化'}
            disableRipple
            onClick={() => windowHost.toggleMaximize()}
          >
            {maximized ? <FilterNoneRoundedIcon fontSize="small" /> : <CropSquareRoundedIcon fontSize="small" />}
          </IconButton>
          <IconButton
            className="desktop-window-control desktop-window-close"
            aria-label="关闭"
            title="关闭"
            disableRipple
            onClick={() => windowHost.close()}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </div>
      </header>
      <div className="desktop-body">{children}</div>
    </div>
  )
}

