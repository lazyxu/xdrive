import { XDriveTaskCenterPage } from '@xdrive/ui/mui'
import type { XDriveFileOperationConflictResolution } from '@xdrive/shared'

export function DesktopTransfersPage({
  transfers,
  operations,
  retryingID,
  retryDisabled,
  operationCancellingID,
  operationRetryingID,
  operationResolvingID,
  operationResolvingPolicy,
  operationDisabled,
  clearHistoryDisabled,
  clearHistoryLoading,
  onRetry,
  onCancelOperation,
  onRetryOperation,
  onResolveOperationConflict,
  onClearHistory,
}: {
  transfers: AgentTransfer[]
  operations: AgentCloudFileOperation[]
  retryingID: string
  retryDisabled: boolean
  operationCancellingID: string
  operationRetryingID: string
  operationResolvingID: string
  operationResolvingPolicy: XDriveFileOperationConflictResolution | ''
  operationDisabled: boolean
  clearHistoryDisabled: boolean
  clearHistoryLoading: boolean
  onRetry: (id: string) => void
  onCancelOperation: (id: string) => void
  onRetryOperation: (id: string) => void
  onResolveOperationConflict?: (id: string, policy: XDriveFileOperationConflictResolution) => void
  onClearHistory: () => void
}) {
  return (
    <XDriveTaskCenterPage
      transfers={transfers}
      operations={operations}
      subtitle="统一查看文件操作、上传、下载、本地可用性与历史状态。"
      clearHistory={{
        disabled: clearHistoryDisabled,
        loading: clearHistoryLoading,
        onClear: onClearHistory,
      }}
      transferRetryingID={retryingID}
      transferRetryDisabled={retryDisabled}
      operationCancellingID={operationCancellingID}
      operationRetryingID={operationRetryingID}
      operationResolvingID={operationResolvingID}
      operationResolvingPolicy={operationResolvingPolicy}
      operationDisabled={operationDisabled}
      onRetryTransfer={onRetry}
      onCancelOperation={onCancelOperation}
      onRetryOperation={onRetryOperation}
      onResolveOperationConflict={onResolveOperationConflict}
    />
  )
}
