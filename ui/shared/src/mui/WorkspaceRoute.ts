import type { XDriveWorkspaceContentPresentation } from './WorkspaceContent'

export const XDRIVE_CORE_WORKSPACE_KEYS = [
  'files',
  'gallery',
  'sources',
  'transfers',
  'local-storage',
  'cloud-storage',
] as const

export type XDriveCoreWorkspaceKey = typeof XDRIVE_CORE_WORKSPACE_KEYS[number]
export type XDriveRemoteWorkspaceKey = Exclude<XDriveCoreWorkspaceKey, 'local-storage'>

export type XDriveWorkspaceViewKey<TExtension extends string = never> =
  | XDriveCoreWorkspaceKey
  | TExtension

export type XDriveRemoteWorkspaceViewKey<TExtension extends string = never> =
  | XDriveRemoteWorkspaceKey
  | TExtension

export function xDriveWorkspacePresentation(
  view: string,
): XDriveWorkspaceContentPresentation {
  return view === 'files' ? 'files' : 'page'
}
