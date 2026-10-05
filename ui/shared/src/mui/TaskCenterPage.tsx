import type { ReactNode } from 'react'
import { Box, Divider, Stack, Typography } from '@mui/material'
import type {
  XDriveFileOperation,
  XDriveFileOperationConflictResolution,
  XDriveTransferTask,
} from '..'
import { XDriveActionButton } from './ActionButton'
import { XDriveFileOperationCenter } from './FileOperationCenter'
import { XDriveTransferCenter } from './TransferCenter'
import { XDriveWorkspaceSurface } from './WorkspaceSurface'

export interface XDriveTaskCenterClearHistory {
  disabled?: boolean
  loading?: boolean
  onClear: () => void
}

export interface XDriveTaskCenterPageProps {
  transfers: XDriveTransferTask[]
  operations: XDriveFileOperation[]
  subtitle?: ReactNode
  pageActions?: ReactNode
  clearHistory?: XDriveTaskCenterClearHistory
  transferRetryingID?: string
  transferRetryDisabled?: boolean
  operationCancellingID?: string
  operationRetryingID?: string
  operationUndoingID?: string
  operationResolvingID?: string
  operationResolvingPolicy?: XDriveFileOperationConflictResolution | ''
  operationDisabled?: boolean
  onRetryTransfer?: (id: string) => void
  onCancelOperation?: (id: string) => void
  onRetryOperation?: (id: string) => void
  onUndoOperation?: (id: string) => void
  onResolveOperationConflict?: (id: string, policy: XDriveFileOperationConflictResolution) => void
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
  operationUndoingID = '',
  operationResolvingID = '',
  operationResolvingPolicy = '',
  operationDisabled = false,
  onRetryTransfer,
  onCancelOperation,
  onRetryOperation,
  onUndoOperation,
  onResolveOperationConflict,
}: XDriveTaskCenterPageProps) {
  const actions = pageActions ?? (clearHistory ? (
    <XDriveActionButton
      disabled={clearHistory.disabled || clearHistory.loading}
      loading={clearHistory.loading}
      loadingLabel="正在清空…"
      onClick={clearHistory.onClear}
    >
      清空历史
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
            undoingID={operationUndoingID}
            resolvingID={operationResolvingID}
            resolvingPolicy={operationResolvingPolicy}
            disabled={operationDisabled}
            onCancel={onCancelOperation}
            onRetry={onRetryOperation}
            onUndo={onUndoOperation}
            onResolveConflict={onResolveOperationConflict}
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
