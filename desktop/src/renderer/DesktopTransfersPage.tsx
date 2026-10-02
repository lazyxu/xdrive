import { Box, Divider, Stack, Typography } from '@mui/material'
import { XDriveFileOperationCenter, XDriveTransferCenter, XDriveWorkspaceSurface } from '@xdrive/ui/mui'

export function DesktopTransfersPage({
  transfers,
  operations,
  retryingID,
  retryDisabled,
  operationCancellingID,
  operationRetryingID,
  operationDisabled,
  onRetry,
  onCancelOperation,
  onRetryOperation,
}: {
  transfers: AgentTransfer[]
  operations: AgentCloudFileOperation[]
  retryingID: string
  retryDisabled: boolean
  operationCancellingID: string
  operationRetryingID: string
  operationDisabled: boolean
  onRetry: (id: string) => void
  onCancelOperation: (id: string) => void
  onRetryOperation: (id: string) => void
}) {
  return (
    <XDriveWorkspaceSurface
      presentation="page"
      title="任务中心"
      subtitle="统一查看文件操作、上传、下载、本地可用性与历史状态。"
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
            retryingID={retryingID}
            retryDisabled={retryDisabled}
            onRetry={onRetry}
          />
        </Box>
      </Stack>
    </XDriveWorkspaceSurface>
  )
}
