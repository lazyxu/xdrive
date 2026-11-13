import type { ReactNode } from 'react'
import { Accordion, AccordionDetails, AccordionSummary, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
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
      <Stack spacing={2} data-xdrive-client-update>
        {clientUpdateContent}
        <XDriveReleaseBundleCard port={releaseBundlePort} />
        <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" fontWeight={600}>Desktop 构建信息与诊断</Typography>
          </AccordionSummary>
          <AccordionDetails><XDriveBuildInfoCard title="Desktop 构建信息" info={buildInfo} /></AccordionDetails>
        </Accordion>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
