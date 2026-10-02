import { XDriveTaskCenterPage } from '@xdrive/ui/mui'

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
    <XDriveTaskCenterPage
      transfers={transfers}
      operations={operations}
      subtitle="统一查看文件操作、上传、下载、本地可用性与历史状态。"
      transferRetryingID={retryingID}
      transferRetryDisabled={retryDisabled}
      operationCancellingID={operationCancellingID}
      operationRetryingID={operationRetryingID}
      operationDisabled={operationDisabled}
      onRetryTransfer={onRetry}
      onCancelOperation={onCancelOperation}
      onRetryOperation={onRetryOperation}
    />
  )
}
