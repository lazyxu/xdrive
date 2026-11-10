import type { ReactNode } from 'react'
import { Stack } from '@mui/material'
import type { BuildInfo } from '../models'
import { XDriveBuildInfoCard } from './BuildInfoCard'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'
import { XDriveReleaseBundleCard } from './ReleaseBundleCard'
import type { XDriveReleaseBundlePort } from '../release-bundles'

export function XDriveClientUpdatePage({
  clientUpdateContent,
  buildInfo,
  releaseBundlePort,
}: {
  clientUpdateContent: ReactNode
  buildInfo?: BuildInfo | null
  releaseBundlePort?: XDriveReleaseBundlePort
}) {
  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="客户端更新"
      subtitle="仅更新当前设备上的 Desktop 与本机 Agent，不升级远端 Server。"
    >
      <Stack spacing={2.5} data-xdrive-client-update>
        <XDriveBuildInfoCard title="Desktop 构建信息" info={buildInfo} />
        {clientUpdateContent}
        <XDriveReleaseBundleCard port={releaseBundlePort} />
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
