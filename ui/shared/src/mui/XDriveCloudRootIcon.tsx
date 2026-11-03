import SvgIcon from '@mui/material/SvgIcon'
import type { SvgIconProps } from '@mui/material/SvgIcon'

/** Visual root identity; never mutate the underlying server Node name or ID. */
export const XDRIVE_CLOUD_ROOT_LABEL = 'xDrive 云端'

/** Rounded external-drive glyph inspired by native iOS Files locations. */
export function XDriveCloudRootIcon(props: SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props} data-xdrive-cloud-root-icon>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2"
        stroke="currentColor" strokeWidth="1.7" fill="none" />
      <path d="M3.9 10.2h16.2M7.1 15.2h5.4"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="17.1" cy="15.2" r="1.15" fill="currentColor" />
    </SvgIcon>
  )
}
