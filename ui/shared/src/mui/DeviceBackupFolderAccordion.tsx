import type { ReactNode } from 'react'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { Accordion, AccordionDetails, AccordionSummary, Stack } from '@mui/material'
import type { XDriveDeviceBackupFolder } from '../device-backups'
import { XDriveDeviceBackupFolderSummary } from './DeviceBackupFolderSummary'

type FolderHeading = Pick<XDriveDeviceBackupFolder, 'name' | 'sync_mode'> &
  Partial<Pick<XDriveDeviceBackupFolder, 'target_path' | 'latest_run'>>

/**
 * Canonical Desktop/DSM backup folder card. Only platform adapters select
 * genuinely owned Sources and actions; no DSM-only Accordion markup.
 */
export function XDriveDeviceBackupFolderAccordion({
  folder, expanded, onExpandedChange, targetUnavailableLabel,
  historyUnavailableLabel, children,
}: {
  folder: FolderHeading
  expanded: boolean
  onExpandedChange: (next: boolean) => void
  targetUnavailableLabel?: string
  historyUnavailableLabel?: string
  children: ReactNode
}) {
  return (
    <Accordion disableGutters elevation={0}
      expanded={expanded}
      onChange={(_event, isOpen) => onExpandedChange(isOpen)}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1,
        mb: 1, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
        <XDriveDeviceBackupFolderSummary
          folder={folder}
          targetUnavailableLabel={targetUnavailableLabel}
          historyUnavailableLabel={historyUnavailableLabel}
        />
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  )
}
