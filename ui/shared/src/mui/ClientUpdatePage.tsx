import type { ReactNode } from 'react'
import { Stack } from '@mui/material'
import type { BuildInfo } from '../models'
import { XDriveBuildInfoCard } from './BuildInfoCard'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export function XDriveClientUpdatePage({
  clientUpdateContent,
  buildInfo,
}: {
  clientUpdateContent: ReactNode
  buildInfo?: BuildInfo | null
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
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
