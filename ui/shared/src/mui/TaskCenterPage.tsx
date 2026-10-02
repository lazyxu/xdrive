import type { ReactNode } from 'react'
import { Box, Divider, Stack, Typography } from '@mui/material'
import type { XDriveFileOperation, XDriveTransferTask } from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveFileOperationCenter } from './FileOperationCenter'
import { XDriveTransferCenter } from './TransferCenter'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export interface XDriveTaskCenterClearHistory {
  disabled?: boolean
  onClear: () => void
}

export function XDriveTaskCenterPage({
  transfers,
  operations,
  subtitle = '统一查看文件操作、上传和下载的实时进度与历史状态。',
  pageActions,
  clearHistory,
  transferRetryingID = '',
  transferRetryDisabled = false,
  operationCancellingID = '',
  operationRetryingID = '',
  operationDisabled = false,
  onRetryTransfer,
  onCancelOperation,
  onRetryOperation,
}: {
  transfers: XDriveTransferTask[]
  operations: XDriveFileOperation[]
  subtitle?: ReactNode
  pageActions?: ReactNode
  clearHistory?: XDriveTaskCenterClearHistory
  transferRetryingID?: string
  transferRetryDisabled?: boolean
  operationCancellingID?: string
  operationRetryingID?: string
  operationDisabled?: boolean
  onRetryTransfer?: (id: string) => void
  onCancelOperation?: (id: string) => void
  onRetryOperation?: (id: string) => void
}) {
  const actions = pageActions ?? (clearHistory ? (
    <XDriveActionButton disabled={clearHistory.disabled} onClick={clearHistory.onClear}>
      清空传输历史
    </XDriveActionButton>
  ) : undefined)

  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="任务中心"
      subtitle={subtitle}
      pageActions={actions}
    >
      <Stack spacing={3}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>文件操作</Typography>
          <XDriveFileOperationCenter
            operations={operations}
            cancellingID={operationCancellingID}
            retryingID={operationRetryingID}
            disabled={operationDisabled}
            onCancel={onCancelOperation}
            onRetry={onRetryOperation}
          />
        </Box>
        <Divider />
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>上传与下载</Typography>
          <XDriveTransferCenter
            transfers={transfers}
            retryingID={transferRetryingID}
            retryDisabled={transferRetryDisabled}
            onRetry={onRetryTransfer}
          />
        </Box>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
